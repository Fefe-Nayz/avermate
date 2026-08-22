import {
  capabilityEntitlementSchema,
  entitlementSnapshotV1Schema,
  managedCapabilitySchema,
  pricingSnapshotV1Schema,
  usageQuantitySchema,
  usageUnitSchema,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { MANAGED_CAPABILITIES } from "../entitlements/capabilities";
import { env } from "../lib/env";
import { adminProcedure, protectedProcedure } from "../lib/orpc";
import {
  managedEntitlements,
  managedPricing,
  managedUsage,
} from "../managed/services";
import { SecurityAuditWriter } from "../observability/audit";
import {
  managedModelPolicyInputSchema,
  publishManagedModelPolicy,
} from "../managed/model-catalogue";

const boundedId = z.string().trim().min(1).max(256);

function correlation(headers: Headers) {
  return headers.get("x-request-id") ?? crypto.randomUUID();
}

async function operationalOverview() {
  const [
    pools,
    reservationSummary,
    deletionSummary,
    billingSummary,
    storageSummary,
    breakerRows,
  ] = await Promise.all([
    db.$client.execute(`SELECT pool, region, capability, providerId, status,
      concurrencyLimit, active, queued, configRevision, safeErrorCode, observedAt
      FROM managed_worker_pools ORDER BY pool, region, capability`),
    db.$client.execute(`SELECT status, count(*) AS count,
      min(expiresAt) AS oldestExpiry FROM usage_reservations GROUP BY status`),
    db.$client.execute(`SELECT state, count(*) AS count,
      min(updatedAt) AS oldestUpdate FROM privacy_operation_targets GROUP BY state`),
    db.$client.execute(`SELECT status, count(*) AS count,
      min(receivedAt) AS oldestReceived FROM billing_webhook_inbox GROUP BY status`),
    db.$client.execute(`SELECT category, count(*) AS objects,
      sum(cast(byteSize AS integer)) AS bytes FROM managed_storage_objects
      WHERE deletedAt IS NULL GROUP BY category`),
    db.$client.execute(`SELECT scope, scopeId, state, reasonCode, expiresAt,
      updatedAt FROM managed_circuit_breakers ORDER BY scope, scopeId`),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    shadowMode: env.MANAGED_ACCOUNTING_MODE === "shadow",
    adaptersEnabled: env.MANAGED_ADAPTERS_ENABLED,
    pools: pools.rows,
    reservations: reservationSummary.rows,
    deletionBacklog: deletionSummary.rows,
    billingInbox: billingSummary.rows,
    storage: storageSummary.rows,
    circuitBreakers: breakerRows.rows,
    launchReady: false,
  };
}

export const managedRouter = {
  mode: protectedProcedure.handler(() => ({
    accounting: env.MANAGED_ACCOUNTING_MODE,
    adaptersEnabled: env.MANAGED_ADAPTERS_ENABLED,
    checkoutEnabled: false,
    billingEnabled: false,
    launchReady: false,
  })),

  usage: {
    summary: protectedProcedure.handler(async ({ context }) => {
      const accountId = context.session.user.id;
      return Promise.all(
        MANAGED_CAPABILITIES.map((capability) =>
          managedUsage().totals(accountId, capability),
        ),
      );
    }),
    run: protectedProcedure
      .input(z.strictObject({ runId: boundedId }))
      .handler(({ context, input }) =>
        managedPricing().summarizeRun(context.session.user.id, input.runId),
      ),
    reservations: protectedProcedure
      .input(
        z.strictObject({
          limit: z.number().int().min(1).max(250).default(50),
        }),
      )
      .handler(async ({ context, input }) => {
        const rows = await db.$client.execute({
          sql: `SELECT id, capability, unit, reservedQuantity,
            consumedQuantity, releasedQuantity, status, runId, jobId,
            placementJson, expiresAt, createdAt, settledAt
            FROM usage_reservations WHERE accountId = ?
            ORDER BY createdAt DESC LIMIT ?`,
          args: [context.session.user.id, input.limit],
        });
        return rows.rows.map((row) => ({
          ...row,
          placement:
            typeof row.placementJson === "string"
              ? JSON.parse(row.placementJson)
              : row.placementJson,
          placementJson: undefined,
        }));
      }),
  },

  controls: {
    setPaidExecutionDisabled: protectedProcedure
      .input(
        z.strictObject({
          disabled: z.boolean(),
          justification: z.string().trim().min(1).max(512),
        }),
      )
      .handler(async ({ context, input }) => {
        if (input.disabled) {
          return managedUsage().emergencyDisable({
            accountId: context.session.user.id,
            actorId: context.session.user.id,
            actorKind: "user",
            justification: input.justification,
            correlationId: correlation(context.headers),
          });
        }
        await managedEntitlements().setEmergencyDisabled({
          accountId: context.session.user.id,
          disabled: false,
          actorId: context.session.user.id,
          actorKind: "user",
          justification: input.justification,
          correlationId: correlation(context.headers),
        });
        return { cancelledReservations: 0 };
      }),
  },

  admin: {
    overview: adminProcedure.handler(operationalOverview),

    grant: adminProcedure
      .input(
        z.strictObject({
          accountId: boundedId,
          capability: managedCapabilitySchema,
          entitlement: capabilityEntitlementSchema,
          expiresAt: z.coerce.date(),
          reason: z.string().trim().min(1).max(512),
        }),
      )
      .handler(({ context, input }) =>
        managedEntitlements().grant({
          ...input,
          actorId: context.session.user.id,
          correlationId: correlation(context.headers),
        }),
      ),

    publishEntitlement: adminProcedure
      .input(entitlementSnapshotV1Schema)
      .handler(({ context, input }) =>
        managedEntitlements().publishSnapshot(input, {
          actorId: context.session.user.id,
          justification: "Typed operator entitlement publication",
          correlationId: correlation(context.headers),
        }),
      ),

    publishPricing: adminProcedure
      .input(pricingSnapshotV1Schema.omit({ version: true }))
      .handler(({ input }) => managedPricing().publish(input)),

    publishModelPolicy: adminProcedure
      .input(
        z.strictObject({
          policy: managedModelPolicyInputSchema,
          justification: z.string().trim().min(1).max(512),
        }),
      )
      .handler(({ context, input }) =>
        publishManagedModelPolicy({
          client: db.$client,
          policy: input.policy,
          actorId: context.session.user.id,
          justification: input.justification,
          correlationId: correlation(context.headers),
        }),
      ),

    reconcileExpiredReservations: adminProcedure
      .input(
        z.strictObject({
          limit: z.number().int().min(1).max(1_000).default(250),
          justification: z.string().trim().min(1).max(512),
        }),
      )
      .handler(async ({ context, input }) => {
        const settled = await managedUsage().reconcileExpired(input.limit);
        await new SecurityAuditWriter(db.$client).append({
          accountId: null,
          actorId: context.session.user.id,
          actorKind: "admin",
          action: "usage.expired-reservations-reconciled",
          resourceKind: "usage-reservation-batch",
          justification: input.justification,
          correlationId: correlation(context.headers),
          policyVersion: "managed-usage/1",
          metadata: { count: settled.length },
        });
        return { settled };
      }),

    adjustUsage: adminProcedure
      .input(
        z.strictObject({
          accountId: boundedId,
          capability: managedCapabilitySchema,
          unit: usageUnitSchema,
          signedQuantity: z.string().regex(/^-?(?:0|[1-9]\d*)$/u),
          idempotencyKey: boundedId,
          actorReason: z.string().trim().min(1).max(512),
          evidenceRef: z.string().trim().min(1).max(1024).optional(),
        }),
      )
      .handler(({ context, input }) =>
        managedUsage().adjust({
          accountId: input.accountId,
          capability: input.capability,
          unit: input.unit,
          signedQuantity: input.signedQuantity,
          idempotencyKey: input.idempotencyKey,
          placement: { kind: "managed", providerId: "operator-adjustment" },
          actorId: context.session.user.id,
          reason: input.actorReason,
          evidenceRef: input.evidenceRef,
          correlationId: correlation(context.headers),
        }),
      ),

    circuitBreaker: adminProcedure
      .input(
        z.strictObject({
          scope: z.enum(["global", "account", "provider", "capability"]),
          scopeId: boundedId,
          state: z.enum(["open", "closed", "half-open"]),
          reasonCode: z.string().trim().min(1).max(128),
          expiresAt: z.coerce.date().nullable().default(null),
          justification: z.string().trim().min(1).max(512),
        }),
      )
      .handler(async ({ context, input }) => {
        const id = `mcbr_${crypto.randomUUID()}`;
        await db.$client.execute({
          sql: `INSERT INTO managed_circuit_breakers
            (id, scope, scopeId, state, reasonCode, actorId, expiresAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, scopeId) DO UPDATE SET state = excluded.state,
              reasonCode = excluded.reasonCode, actorId = excluded.actorId,
              expiresAt = excluded.expiresAt, updatedAt = excluded.updatedAt`,
          args: [
            id,
            input.scope,
            input.scopeId,
            input.state,
            input.reasonCode,
            context.session.user.id,
            input.expiresAt
              ? Math.floor(input.expiresAt.getTime() / 1_000)
              : null,
            Math.floor(Date.now() / 1_000),
          ],
        });
        await new SecurityAuditWriter(db.$client).append({
          accountId: input.scope === "account" ? input.scopeId : null,
          actorId: context.session.user.id,
          actorKind: "admin",
          action: "managed.circuit-breaker-updated",
          resourceKind: "circuit-breaker",
          resourceId: `${input.scope}:${input.scopeId}`,
          justification: input.justification,
          correlationId: correlation(context.headers),
          policyVersion: "managed-cost-controls/1",
          metadata: {
            state: input.state,
            reasonCode: input.reasonCode,
            expiresAt: input.expiresAt,
          },
        });
        return { ok: true };
      }),
  },
};
