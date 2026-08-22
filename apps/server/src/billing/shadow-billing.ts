import { createHash } from "node:crypto";
import type { BillingAdapter } from "@avermate/agent-contracts";
import type {
  EntitlementSqlClient,
  EntitlementSqlTarget,
} from "../entitlements/service";
import { safeOperationalMetadata } from "../observability/redaction";

export class BillingDisabledError extends Error {
  constructor() {
    super("BILLING_DISABLED_SHADOW_MODE");
    this.name = "BillingDisabledError";
  }
}

/** Checkout and portals intentionally stay unavailable during shadow mode. */
export class DisabledBillingAdapter implements BillingAdapter {
  async createCheckout(): Promise<never> {
    throw new BillingDisabledError();
  }
  async createPortal(): Promise<never> {
    throw new BillingDisabledError();
  }
  async verifyWebhook(): Promise<never> {
    throw new BillingDisabledError();
  }
  async getSubscription(): Promise<never> {
    throw new BillingDisabledError();
  }
}

export function billingStatusToEntitlementStatus(status: string) {
  switch (status) {
    case "trialing":
    case "active":
      return "active" as const;
    case "past_due":
    case "paused":
      return "grace" as const;
    case "refunded":
    case "disputed":
      return "restricted" as const;
    case "cancelled":
    case "canceled":
      return "cancelled" as const;
    default:
      return "restricted" as const;
  }
}

/**
 * Shadow-only projection for operator visibility. It never grants capability;
 * only the versioned entitlement service can authorize execution. Older or
 * out-of-order observations cannot overwrite newer subscription state.
 */
export async function projectShadowSubscription(
  target: EntitlementSqlTarget,
  input: {
    accountId: string;
    provider: string;
    externalSubscriptionRef: string;
    externalCustomerRef?: string;
    status: string;
    currentPeriodEndsAt?: Date;
    observedAt: Date;
  },
) {
  const id = `bsub_${createHash("sha256")
    .update(`${input.provider}\0${input.externalSubscriptionRef}`)
    .digest("hex")
    .slice(0, 24)}`;
  const observedAt = Math.floor(input.observedAt.getTime() / 1_000);
  await target.execute({
    sql: `INSERT INTO billing_subscriptions
      (id, accountId, provider, externalCustomerRef,
       externalSubscriptionRef, status, currentPeriodEndsAt, observedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, externalSubscriptionRef) DO UPDATE SET
        accountId = excluded.accountId,
        externalCustomerRef = excluded.externalCustomerRef,
        status = excluded.status,
        currentPeriodEndsAt = excluded.currentPeriodEndsAt,
        observedAt = excluded.observedAt
      WHERE excluded.observedAt >= billing_subscriptions.observedAt`,
    args: [
      id,
      input.accountId,
      input.provider,
      input.externalCustomerRef ?? null,
      input.externalSubscriptionRef,
      input.status,
      input.currentPeriodEndsAt
        ? Math.floor(input.currentPeriodEndsAt.getTime() / 1_000)
        : null,
      observedAt,
    ],
  });
  const rows = await target.execute({
    sql: `SELECT status, observedAt FROM billing_subscriptions
      WHERE provider = ? AND externalSubscriptionRef = ? LIMIT 1`,
    args: [input.provider, input.externalSubscriptionRef],
  });
  return {
    id,
    status: String(rows.rows[0]?.status),
    observedAt: Number(rows.rows[0]?.observedAt),
  };
}

/**
 * Idempotent webhook inbox boundary. Processing remains asynchronous and the
 * existence of a subscription row never authorizes execution.
 */
export class ShadowBillingInbox {
  constructor(
    private readonly client: EntitlementSqlClient,
    private readonly provider: string,
    private readonly adapter: BillingAdapter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async receive(raw: Uint8Array, headers: Headers) {
    const verified = await this.adapter.verifyWebhook(raw, headers);
    const payloadDigest = createHash("sha256").update(raw).digest("hex");
    const sanitized = safeOperationalMetadata(verified.payload);
    const id = `bwh_${createHash("sha256")
      .update(`${this.provider}\0${verified.externalId}`)
      .digest("hex")
      .slice(0, 24)}`;
    const inserted = await this.client.execute({
      sql: `INSERT INTO billing_webhook_inbox
        (id, provider, externalEventId, eventType, payloadDigest, payloadJson,
         status, receivedAt)
        VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
        ON CONFLICT(provider, externalEventId) DO NOTHING`,
      args: [
        id,
        this.provider,
        verified.externalId,
        verified.type,
        payloadDigest,
        JSON.stringify(sanitized),
        Math.floor(this.clock().getTime() / 1_000),
      ],
    });
    const row = await this.client.execute({
      sql: `SELECT id, payloadDigest, status FROM billing_webhook_inbox
        WHERE provider = ? AND externalEventId = ? LIMIT 1`,
      args: [this.provider, verified.externalId],
    });
    if (String(row.rows[0]?.payloadDigest) !== payloadDigest) {
      throw new Error("BILLING_EVENT_ID_PAYLOAD_CONFLICT");
    }
    return {
      id: String(row.rows[0]?.id),
      status: String(row.rows[0]?.status),
      replayed: Number(inserted.rowsAffected) === 0,
    };
  }

  async process<T>(input: {
    inboxId: string;
    handler: (
      event: {
        provider: string;
        externalEventId: string;
        type: string;
        payload: unknown;
      },
      transaction: Awaited<ReturnType<EntitlementSqlClient["transaction"]>>,
    ) => Promise<T>;
  }): Promise<{ result?: T; replayed: boolean }> {
    const transaction = await this.client.transaction("write");
    try {
      const rows = await transaction.execute({
        sql: "SELECT * FROM billing_webhook_inbox WHERE id = ? LIMIT 1",
        args: [input.inboxId],
      });
      const row = rows.rows[0];
      if (!row) throw new Error("BILLING_EVENT_NOT_FOUND");
      if (row.status === "processed") {
        await transaction.commit();
        return { replayed: true };
      }
      const result = await input.handler(
        {
          provider: String(row.provider),
          externalEventId: String(row.externalEventId),
          type: String(row.eventType),
          payload:
            typeof row.payloadJson === "string"
              ? JSON.parse(row.payloadJson)
              : row.payloadJson,
        },
        transaction,
      );
      await transaction.execute({
        sql: `UPDATE billing_webhook_inbox SET status = 'processed',
          processedAt = ?, safeErrorCode = NULL
          WHERE id = ? AND status <> 'processed'`,
        args: [Math.floor(this.clock().getTime() / 1_000), input.inboxId],
      });
      await transaction.commit();
      return { result, replayed: false };
    } catch (error) {
      await transaction.rollback();
      await this.client.execute({
        sql: `UPDATE billing_webhook_inbox SET status = 'failed',
          safeErrorCode = 'PROCESSING_FAILED' WHERE id = ?`,
        args: [input.inboxId],
      });
      throw error;
    }
  }
}
