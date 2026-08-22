import { describe, expect, test } from "bun:test";
import type { BillingAdapter } from "@avermate/agent-contracts";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import {
  billingStatusToEntitlementStatus,
  BillingDisabledError,
  DisabledBillingAdapter,
  projectShadowSubscription,
  ShadowBillingInbox,
} from "./shadow-billing";

describe.serial("shadow billing boundary", () => {
  test("keeps every money-moving operation disabled", async () => {
    const adapter = new DisabledBillingAdapter();
    await expect(adapter.createCheckout()).rejects.toBeInstanceOf(
      BillingDisabledError,
    );
    await expect(adapter.createPortal()).rejects.toBeInstanceOf(
      BillingDisabledError,
    );
    await expect(adapter.getSubscription()).rejects.toBeInstanceOf(
      BillingDisabledError,
    );
  });

  test("maps provider lifecycle fixtures without using customer ids as authority", () => {
    expect(
      [
        "trialing",
        "active",
        "past_due",
        "paused",
        "cancelled",
        "refunded",
        "disputed",
        "unknown",
      ].map(billingStatusToEntitlementStatus),
    ).toEqual([
      "active",
      "active",
      "grace",
      "grace",
      "cancelled",
      "restricted",
      "restricted",
      "restricted",
    ]);
  });

  test("verifies first, deduplicates callbacks and processes exactly once", async () => {
    const client = await createManagedTestDatabase();
    try {
      let verifies = 0;
      const adapter: BillingAdapter = {
        createCheckout: async () => ({ reference: "disabled", url: "https://invalid" }),
        createPortal: async () => ({ reference: "disabled", url: "https://invalid" }),
        getSubscription: async (reference) => ({ reference, status: "active" }),
        verifyWebhook: async () => {
          verifies += 1;
          return {
            externalId: "event-1",
            type: "subscription.updated",
            payload: {
              status: "active",
              authorization: "Bearer this-must-never-be-stored",
              prompt: "private school content",
            },
          };
        },
      };
      const inbox = new ShadowBillingInbox(client, "fixture", adapter);
      const raw = new TextEncoder().encode("signed-event-body");
      const first = await inbox.receive(raw, new Headers());
      const replay = await inbox.receive(raw, new Headers());
      expect(verifies).toBe(2);
      expect(first.replayed).toBe(false);
      expect(replay).toMatchObject({ id: first.id, replayed: true });
      let processed = 0;
      const handler = async () => {
        processed += 1;
        return "ok";
      };
      expect(await inbox.process({ inboxId: first.id, handler })).toEqual({
        result: "ok",
        replayed: false,
      });
      expect(await inbox.process({ inboxId: first.id, handler })).toEqual({
        replayed: true,
      });
      expect(processed).toBe(1);
      const row = await client.execute({
        sql: "SELECT payloadJson FROM billing_webhook_inbox WHERE id = ?",
        args: [first.id],
      });
      expect(String(row.rows[0]?.payloadJson)).not.toContain("Bearer");
      expect(String(row.rows[0]?.payloadJson)).not.toContain("private school");
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("does not let an out-of-order subscription event overwrite newer state", async () => {
    const client = await createManagedTestDatabase();
    try {
      const newer = await projectShadowSubscription(client, {
        accountId: "account-a",
        provider: "fixture",
        externalSubscriptionRef: "subscription-1",
        status: "cancelled",
        observedAt: new Date("2026-08-22T12:00:00.000Z"),
      });
      const stale = await projectShadowSubscription(client, {
        accountId: "account-a",
        provider: "fixture",
        externalSubscriptionRef: "subscription-1",
        status: "active",
        observedAt: new Date("2026-08-21T12:00:00.000Z"),
      });
      expect(stale).toEqual(newer);
      expect(stale.status).toBe("cancelled");
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
