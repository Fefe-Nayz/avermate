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
import { reserveDurableRateLimit } from "../lib/rate-limit";
import {
  managedBetaControlPlane,
  managedEntitlements,
  managedPricing,
  managedUsage,
} from "../managed/services";
import {
  issueManagedBetaInviteSchema,
  managedIncidentSchema,
  managedOperationalEvidenceSchema,
  managedQuotaPolicySchema,
  redeemManagedBetaInviteSchema,
  updateManagedBetaConsentSchema,
} from "../managed/beta-control-plane";
import { SecurityAuditWriter } from "../observability/audit";
import { managedReadiness } from "../operations/readiness";
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
    priceMappings,
    readiness,
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
    db.$client.execute(`SELECT provider, externalPriceRef, planRevision,
      currency, active, createdAt FROM managed_billing_price_mappings
      ORDER BY provider, planRevision`),
    managedReadiness(db.$client),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    shadowMode: env.MANAGED_ACCOUNTING_MODE === "shadow",
    adaptersEnabled: env.MANAGED_ADAPTERS_ENABLED,
    betaEnforcementEnabled: env.MANAGED_BETA_ENFORCEMENT_ENABLED,
    pools: pools.rows,
    reservations: reservationSummary.rows,
    deletionBacklog: deletionSummary.rows,
    billingInbox: billingSummary.rows,
    storage: storageSummary.rows,
    circuitBreakers: breakerRows.rows,
    priceMappings: priceMappings.rows,
    readiness,
    launchReady: false,
  };
}

export const managedRouter = {
  mode: protectedProcedure.handler(() => ({
    accounting: env.MANAGED_ACCOUNTING_MODE,
    adaptersEnabled: env.MANAGED_ADAPTERS_ENABLED,
    betaEnforcementEnabled: env.MANAGED_BETA_ENFORCEMENT_ENABLED,
    region: env.MANAGED_REGION,
    termsRevision: env.MANAGED_TERMS_REVISION,
    privacyRevision: env.MANAGED_PRIVACY_REVISION,
    checkoutEnabled: false,
    billingEnabled: false,
    launchReady: false,
  })),

  beta: {
    status: protectedProcedure.handler(async ({ context }) => {
      const accountId = context.session.user.id;
      const [
        account,
        waitlist,
        incidents,
        usage,
        privacyOperations,
        pools,
        billing,
      ] = await Promise.all([
        managedBetaControlPlane().getAccount(accountId),
        managedBetaControlPlane().getWaitlist(accountId),
        managedBetaControlPlane().listPublicIncidents(),
        Promise.all(
          MANAGED_CAPABILITIES.map(async (capability) => ({
            capability,
            totals: await managedUsage().totals(accountId, capability),
            entitlement: (
              await managedEntitlements().resolve(accountId, capability)
            ).entitlement,
          })),
        ),
        managedBetaControlPlane().listPrivacyOperations(accountId),
        db.$client.execute({
          sql: `SELECT pool, region, capability, providerId, status,
              safeErrorCode, observedAt FROM managed_worker_pools
              WHERE region = ? ORDER BY capability, pool`,
          args: [env.MANAGED_REGION],
        }),
        db.$client.execute({
          sql: `SELECT provider, status, currentPeriodEndsAt, observedAt
              FROM billing_subscriptions WHERE accountId = ?
              ORDER BY observedAt DESC LIMIT 1`,
          args: [accountId],
        }),
      ]);
      const executionControl = await db.$client.execute({
        sql: `SELECT paidExecutionDisabled, revision, updatedAt
          FROM account_execution_controls WHERE accountId = ? LIMIT 1`,
        args: [accountId],
      });
      return {
        mode: {
          accounting: env.MANAGED_ACCOUNTING_MODE,
          adaptersEnabled: env.MANAGED_ADAPTERS_ENABLED,
          betaEnforcementEnabled: env.MANAGED_BETA_ENFORCEMENT_ENABLED,
          checkoutEnabled: false,
          billingEnabled: false,
          launchReady: false,
        },
        disclosure: {
          region: env.MANAGED_REGION,
          termsRevision: env.MANAGED_TERMS_REVISION,
          privacyRevision: env.MANAGED_PRIVACY_REVISION,
          dataCategories: [
            "files",
            "conversations",
            "retrieval",
            "inference",
            "sandbox-artifacts",
          ],
          freePaths: [
            "academic-core",
            "export",
            "delete",
            "byok",
            "node",
            "self-host",
          ],
        },
        account,
        waitlist,
        incidents,
        usage,
        privacyOperations,
        providers: pools.rows,
        paidExecutionDisabled:
          Number(executionControl.rows[0]?.paidExecutionDisabled ?? 0) === 1,
        billing: billing.rows[0]
          ? {
              provider: String(billing.rows[0].provider),
              status: String(billing.rows[0].status),
              currentPeriodEndsAt: billing.rows[0].currentPeriodEndsAt,
              observedAt: billing.rows[0].observedAt,
            }
          : null,
      };
    }),

    joinWaitlist: protectedProcedure
      .input(
        z.strictObject({ preferredRegion: z.string().trim().min(1).max(64) }),
      )
      .handler(async ({ context, input }) => {
        await reserveDurableRateLimit({
          subject: context.session.user.id,
          action: "managed-beta.waitlist",
          limit: 10,
          windowMs: 60 * 60 * 1_000,
        });
        return managedBetaControlPlane().joinWaitlist(
          context.session.user.id,
          input.preferredRegion,
        );
      }),

    withdrawWaitlist: protectedProcedure.handler(({ context }) =>
      managedBetaControlPlane().withdrawWaitlist(context.session.user.id),
    ),

    redeemInvite: protectedProcedure
      .input(redeemManagedBetaInviteSchema)
      .handler(async ({ context, input }) => {
        await reserveDurableRateLimit({
          subject: context.session.user.id,
          action: "managed-beta.invite-redeem",
          limit: 10,
          windowMs: 15 * 60 * 1_000,
        });
        return managedBetaControlPlane().redeemInvite({
          ...input,
          accountId: context.session.user.id,
          email: context.session.user.email,
          correlationId: correlation(context.headers),
        });
      }),

    updateConsent: protectedProcedure
      .input(updateManagedBetaConsentSchema)
      .handler(async ({ context, input }) => {
        const result = await managedBetaControlPlane().updateConsent({
          accountId: context.session.user.id,
          actorId: context.session.user.id,
          enabled: input.enabled,
          categories: input.categories,
          correlationId: correlation(context.headers),
        });
        if (!input.enabled) {
          await managedUsage().emergencyDisable({
            accountId: context.session.user.id,
            actorId: context.session.user.id,
            actorKind: "user",
            justification: "Managed processing consent revoked",
            correlationId: correlation(context.headers),
          });
        }
        return result;
      }),
  },

  privacy: {
    previewDeletion: protectedProcedure.handler(async ({ context }) => {
      const accountId = context.session.user.id;
      const [storage, reservations, account] = await Promise.all([
        db.$client.execute({
          sql: `SELECT category, COUNT(*) AS objects,
            COALESCE(SUM(CAST(byteSize AS INTEGER)), 0) AS bytes
            FROM managed_storage_objects WHERE accountId = ? AND deletedAt IS NULL
            GROUP BY category`,
          args: [accountId],
        }),
        db.$client.execute({
          sql: `SELECT COUNT(*) AS count FROM usage_reservations
            WHERE accountId = ? AND status = 'reserved'`,
          args: [accountId],
        }),
        managedBetaControlPlane().getAccount(accountId),
      ]);
      return {
        account,
        storage: storage.rows,
        activeReservations: Number(reservations.rows[0]?.count ?? 0),
        immediateEffects: [
          "managed-dispatch-disabled",
          "managed-consent-revoked",
          "core-access-tombstoned-for-managed-resources",
        ],
        retainedUntilReceipt: [
          "managed-objects",
          "conversation-content",
          "corpus-derivatives",
          "workspace-snapshots",
        ],
        academicCoreUnaffected: true,
      };
    }),

    exportManagedMetadata: protectedProcedure.handler(({ context }) =>
      managedBetaControlPlane().exportManagedMetadata({
        accountId: context.session.user.id,
        actorId: context.session.user.id,
        correlationId: correlation(context.headers),
      }),
    ),

    requestManagedDeletion: protectedProcedure
      .input(z.strictObject({ confirmation: z.literal("DELETE MANAGED DATA") }))
      .handler(({ context }) =>
        managedBetaControlPlane().requestManagedDeletion({
          accountId: context.session.user.id,
          actorId: context.session.user.id,
          correlationId: correlation(context.headers),
        }),
      ),
  },

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

    beta: {
      overview: adminProcedure.handler(async () => ({
        ...(await operationalOverview()),
        controlPlane: await managedBetaControlPlane().adminOverview(),
        commercial: {
          checkoutEnabled: false,
          billingEnabled: false,
          launchReady: false,
          note: "Production checkout has no activation route before Phase-D evidence and explicit maintainer authorization.",
        },
      })),

      issueInvite: adminProcedure
        .input(issueManagedBetaInviteSchema)
        .handler(async ({ context, input }) => {
          await reserveDurableRateLimit({
            subject: context.session.user.id,
            action: "managed-beta.invite-issue",
            limit: 100,
            windowMs: 60 * 60 * 1_000,
          });
          return managedBetaControlPlane().issueInvite(input, {
            actorId: context.session.user.id,
            correlationId: correlation(context.headers),
          });
        }),

      revokeInvite: adminProcedure
        .input(
          z.strictObject({
            inviteId: boundedId,
            justification: z.string().trim().min(1).max(1_000),
          }),
        )
        .handler(({ context, input }) =>
          managedBetaControlPlane().revokeInvite({
            ...input,
            actorId: context.session.user.id,
            correlationId: correlation(context.headers),
          }),
        ),

      setAccountPolicy: adminProcedure
        .input(
          z.strictObject({
            accountId: boundedId,
            state: z.enum(["active", "suspended", "left"]),
            capabilities: z.array(managedCapabilitySchema).min(1).max(20),
            policyRevision: z.string().trim().min(1).max(128),
            justification: z.string().trim().min(1).max(1_000),
          }),
        )
        .handler(({ context, input }) =>
          managedBetaControlPlane().setAccountPolicy({
            ...input,
            actorId: context.session.user.id,
            correlationId: correlation(context.headers),
          }),
        ),

      upsertQuotaPolicy: adminProcedure
        .input(managedQuotaPolicySchema)
        .handler(({ context, input }) =>
          managedBetaControlPlane().upsertQuotaPolicy(input, {
            actorId: context.session.user.id,
            correlationId: correlation(context.headers),
          }),
        ),
    },

    operations: {
      recordEvidence: adminProcedure
        .input(managedOperationalEvidenceSchema)
        .handler(({ context, input }) =>
          managedBetaControlPlane().createEvidence(input, {
            actorId: context.session.user.id,
            correlationId: correlation(context.headers),
          }),
        ),

      setLaunchGate: adminProcedure
        .input(
          z.strictObject({
            key: boundedId,
            phase: z.enum(["A", "B", "C", "D", "E"]),
            status: z.enum(["blocked", "pending", "passed"]),
            evidenceId: boundedId.optional(),
            justification: z.string().trim().min(1).max(1_000),
          }),
        )
        .handler(({ context, input }) =>
          managedBetaControlPlane().setLaunchGate({
            ...input,
            actorId: context.session.user.id,
            correlationId: correlation(context.headers),
          }),
        ),

      createIncident: adminProcedure
        .input(managedIncidentSchema)
        .handler(({ context, input }) =>
          managedBetaControlPlane().createIncident(input, {
            actorId: context.session.user.id,
            correlationId: correlation(context.headers),
          }),
        ),

      correlate: adminProcedure
        .input(z.strictObject({ operationId: boundedId }))
        .handler(async ({ input }) => {
          const [reservations, usageEvents, auditEvents] = await Promise.all([
            db.$client.execute({
              sql: `SELECT id, accountId, capability, status, runId, jobId,
                provider, model, expiresAt, createdAt, settledAt
                FROM usage_reservations WHERE id = ? OR runId = ? OR jobId = ?
                ORDER BY createdAt DESC LIMIT 100`,
              args: [input.operationId, input.operationId, input.operationId],
            }),
            db.$client.execute({
              sql: `SELECT id, accountId, capability, direction, quantity, unit,
                reservationId, runId, jobId, provider, model, authoritative,
                occurredAt FROM usage_events
                WHERE reservationId = ? OR runId = ? OR jobId = ?
                ORDER BY occurredAt LIMIT 250`,
              args: [input.operationId, input.operationId, input.operationId],
            }),
            db.$client.execute({
              sql: `SELECT id, accountId, actorKind, action, resourceKind,
                resourceId, correlationId, policyVersion, occurredAt
                FROM security_audit_events
                WHERE correlationId = ? OR resourceId = ?
                ORDER BY occurredAt LIMIT 250`,
              args: [input.operationId, input.operationId],
            }),
          ]);
          return {
            operationId: input.operationId,
            reservations: reservations.rows,
            usageEvents: usageEvents.rows,
            auditEvents: auditEvents.rows,
            contentIncluded: false,
          };
        }),
    },

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
