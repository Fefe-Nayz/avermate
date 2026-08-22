import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  CapabilityEntitlement,
  CapabilityPlacement,
  DeletionReceiptV1,
  ManagedCapability,
  PlacementDeletionState,
  UsageUnit,
} from "@avermate/agent-contracts";
import { newId } from "../../lib/id";
import { users } from "./auth";

const accountId = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

const timestamp = () =>
  integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const entitlementSnapshots = sqliteTable(
  "entitlement_snapshots",
  {
    id: text().primaryKey().$defaultFn(() => newId("ents")),
    accountId: accountId(),
    revision: text().notNull(),
    plan: text().notNull(),
    status: text({
      enum: ["active", "grace", "restricted", "cancelled"],
    }).notNull(),
    periodStartsAt: integer({ mode: "timestamp" }).notNull(),
    periodEndsAt: integer({ mode: "timestamp" }).notNull(),
    capabilitiesJson: text({ mode: "json" })
      .$type<Record<ManagedCapability, CapabilityEntitlement>>()
      .notNull(),
    source: text({
      enum: ["free", "operator", "billing-provider", "self-host"],
    }).notNull(),
    issuedAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: timestamp(),
  },
  (table) => [
    uniqueIndex("entitlement_snapshots_account_revision_unique").on(
      table.accountId,
      table.revision,
    ),
    index("entitlement_snapshots_current_idx").on(
      table.accountId,
      table.periodStartsAt,
      table.periodEndsAt,
      table.issuedAt,
    ),
    check(
      "entitlement_snapshots_period_check",
      sql`${table.periodEndsAt} > ${table.periodStartsAt}`,
    ),
  ],
);

export const entitlementGrants = sqliteTable(
  "entitlement_grants",
  {
    id: text().primaryKey().$defaultFn(() => newId("entg")),
    accountId: accountId(),
    capability: text().$type<ManagedCapability>().notNull(),
    entitlementJson: text({ mode: "json" })
      .$type<CapabilityEntitlement>()
      .notNull(),
    reason: text().notNull(),
    actorId: text().notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    revokedAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
  },
  (table) => [
    index("entitlement_grants_active_idx").on(
      table.accountId,
      table.capability,
      table.expiresAt,
      table.revokedAt,
    ),
  ],
);

export const accountExecutionControls = sqliteTable(
  "account_execution_controls",
  {
    accountId: accountId().primaryKey(),
    paidExecutionDisabled: integer({ mode: "boolean" })
      .notNull()
      .default(false),
    revision: integer().notNull().default(1),
    updatedAt: timestamp(),
  },
  (table) => [
    check(
      "account_execution_controls_revision_check",
      sql`${table.revision} > 0`,
    ),
  ],
);

export const entitlementDecisions = sqliteTable(
  "entitlement_decisions",
  {
    id: text().primaryKey().$defaultFn(() => newId("entd")),
    accountId: accountId(),
    snapshotId: text().notNull(),
    snapshotRevision: text().notNull(),
    capability: text().$type<ManagedCapability>().notNull(),
    quantity: text().notNull(),
    unit: text().$type<UsageUnit>().notNull(),
    mode: text({ enum: ["shadow", "enforce"] }).notNull(),
    allowed: integer({ mode: "boolean" }).notNull(),
    wouldBlock: integer({ mode: "boolean" }).notNull(),
    reason: text({
      enum: [
        "allowed",
        "capability-disabled",
        "hard-limit-exceeded",
        "emergency-disabled",
        "entitlement-restricted",
      ],
    }).notNull(),
    aggregateBefore: text().notNull(),
    decidedAt: timestamp(),
  },
  (table) => [
    index("entitlement_decisions_account_time_idx").on(
      table.accountId,
      table.decidedAt,
    ),
    index("entitlement_decisions_shadow_idx").on(
      table.mode,
      table.wouldBlock,
      table.decidedAt,
    ),
  ],
);

export const usageReservations = sqliteTable(
  "usage_reservations",
  {
    id: text().primaryKey().$defaultFn(() => newId("ures")),
    accountId: accountId(),
    userId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    capability: text().$type<ManagedCapability>().notNull(),
    unit: text().$type<UsageUnit>().notNull(),
    reservedQuantity: text().notNull(),
    consumedQuantity: text().notNull().default("0"),
    releasedQuantity: text().notNull().default("0"),
    status: text({
      enum: ["reserved", "settled", "cancelled", "expired"],
    })
      .notNull()
      .default("reserved"),
    idempotencyKey: text().notNull(),
    decisionId: text()
      .notNull()
      .references(() => entitlementDecisions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    entitlementSnapshotId: text().notNull(),
    placementJson: text({ mode: "json" })
      .$type<CapabilityPlacement>()
      .notNull(),
    runId: text(),
    jobId: text(),
    provider: text(),
    model: text(),
    pricingSnapshotId: text(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: timestamp(),
    settledAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("usage_reservations_idempotency_unique").on(
      table.accountId,
      table.capability,
      table.idempotencyKey,
    ),
    index("usage_reservations_active_idx").on(
      table.accountId,
      table.capability,
      table.status,
      table.expiresAt,
    ),
    index("usage_reservations_run_idx").on(table.accountId, table.runId),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text().primaryKey().$defaultFn(() => newId("uevt")),
    accountId: accountId(),
    userId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    capability: text().$type<ManagedCapability>().notNull(),
    quantity: text().notNull(),
    unit: text().$type<UsageUnit>().notNull(),
    direction: text({
      enum: ["reserve", "consume", "release", "adjust"],
    }).notNull(),
    idempotencyKey: text().notNull(),
    reservationId: text().references(() => usageReservations.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    runId: text(),
    jobId: text(),
    provider: text(),
    model: text(),
    placementJson: text({ mode: "json" })
      .$type<CapabilityPlacement>()
      .notNull(),
    pricingSnapshotId: text(),
    authoritative: integer({ mode: "boolean" }).notNull().default(false),
    estimatorVersion: text(),
    adjustmentActorId: text(),
    adjustmentReason: text(),
    adjustmentEvidenceRef: text(),
    occurredAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: timestamp(),
  },
  (table) => [
    uniqueIndex("usage_events_idempotency_unique").on(
      table.accountId,
      table.idempotencyKey,
    ),
    index("usage_events_period_idx").on(
      table.accountId,
      table.capability,
      table.occurredAt,
    ),
    index("usage_events_reservation_idx").on(table.reservationId),
    check(
      "usage_events_adjustment_metadata_check",
      sql`${table.direction} <> 'adjust' or (${table.adjustmentActorId} is not null and ${table.adjustmentReason} is not null)`,
    ),
  ],
);

export const usagePeriodAggregates = sqliteTable(
  "usage_period_aggregates",
  {
    accountId: accountId(),
    capability: text().$type<ManagedCapability>().notNull(),
    unit: text().$type<UsageUnit>().notNull(),
    periodStartsAt: integer({ mode: "timestamp" }).notNull(),
    periodEndsAt: integer({ mode: "timestamp" }).notNull(),
    consumedQuantity: text().notNull().default("0"),
    adjustedQuantity: text().notNull().default("0"),
    finalEventOccurredAt: integer({ mode: "timestamp" }),
    updatedAt: timestamp(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.accountId,
        table.capability,
        table.periodStartsAt,
        table.periodEndsAt,
      ],
    }),
  ],
);

export const pricingSnapshots = sqliteTable(
  "pricing_snapshots",
  {
    id: text().primaryKey().$defaultFn(() => newId("price")),
    provider: text().notNull(),
    model: text(),
    capability: text().$type<ManagedCapability>().notNull(),
    unit: text().$type<UsageUnit>().notNull(),
    currency: text().notNull(),
    rateMinor: text().notNull(),
    quantityScale: text().notNull(),
    effectiveAt: integer({ mode: "timestamp" }).notNull(),
    retiredAt: integer({ mode: "timestamp" }),
    source: text({ enum: ["operator", "provider"] }).notNull(),
    createdAt: timestamp(),
  },
  (table) => [
    index("pricing_snapshots_lookup_idx").on(
      table.provider,
      table.model,
      table.capability,
      table.effectiveAt,
    ),
  ],
);

/** Shadow-only provider state. It cannot authorize a capability. */
export const billingSubscriptions = sqliteTable(
  "billing_subscriptions",
  {
    id: text().primaryKey().$defaultFn(() => newId("bsub")),
    accountId: accountId(),
    provider: text().notNull(),
    externalCustomerRef: text(),
    externalSubscriptionRef: text().notNull(),
    status: text().notNull(),
    currentPeriodEndsAt: integer({ mode: "timestamp" }),
    observedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("billing_subscriptions_external_unique").on(
      table.provider,
      table.externalSubscriptionRef,
    ),
    index("billing_subscriptions_account_idx").on(table.accountId),
  ],
);

export const billingWebhookInbox = sqliteTable(
  "billing_webhook_inbox",
  {
    id: text().primaryKey().$defaultFn(() => newId("bwh")),
    provider: text().notNull(),
    externalEventId: text().notNull(),
    eventType: text().notNull(),
    payloadDigest: text().notNull(),
    payloadJson: text({ mode: "json" }).$type<unknown>().notNull(),
    status: text({ enum: ["received", "processed", "failed"] })
      .notNull()
      .default("received"),
    safeErrorCode: text(),
    receivedAt: timestamp(),
    processedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("billing_webhook_inbox_external_unique").on(
      table.provider,
      table.externalEventId,
    ),
    index("billing_webhook_inbox_status_idx").on(
      table.status,
      table.receivedAt,
    ),
  ],
);

export const managedWorkerPools = sqliteTable(
  "managed_worker_pools",
  {
    id: text().primaryKey().$defaultFn(() => newId("mpool")),
    pool: text().notNull(),
    region: text().notNull(),
    capability: text().notNull(),
    providerId: text().notNull(),
    status: text({ enum: ["disabled", "healthy", "degraded", "offline"] })
      .notNull()
      .default("disabled"),
    concurrencyLimit: integer().notNull().default(0),
    active: integer().notNull().default(0),
    queued: integer().notNull().default(0),
    configRevision: text().notNull(),
    safeErrorCode: text(),
    observedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("managed_worker_pools_identity_unique").on(
      table.pool,
      table.region,
      table.capability,
    ),
  ],
);

export const managedModelCatalogue = sqliteTable(
  "managed_model_catalogue",
  {
    provider: text().notNull(),
    model: text().notNull(),
    revision: text().notNull(),
    enabled: integer({ mode: "boolean" }).notNull().default(false),
    modalitiesJson: text({ mode: "json" }).$type<string[]>().notNull(),
    contextTokens: text().notNull(),
    supportsTools: integer({ mode: "boolean" }).notNull(),
    supportsStructuredOutput: integer({ mode: "boolean" }).notNull(),
    regionsJson: text({ mode: "json" }).$type<string[]>().notNull(),
    retentionPolicy: text().notNull(),
    zeroRetention: integer({ mode: "boolean" }).notNull().default(false),
    trainingOptInRequired: integer({ mode: "boolean" })
      .notNull()
      .default(false),
    pricingSnapshotId: text().references(() => pricingSnapshots.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedAt: timestamp(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.model, table.revision] }),
    index("managed_model_catalogue_enabled_idx").on(
      table.enabled,
      table.provider,
      table.model,
    ),
  ],
);

export const placementMigrations = sqliteTable(
  "placement_migrations",
  {
    id: text().primaryKey().$defaultFn(() => newId("pmig")),
    accountId: accountId(),
    resourceKind: text().notNull(),
    resourceId: text().notNull(),
    sourcePlacementJson: text({ mode: "json" })
      .$type<CapabilityPlacement>()
      .notNull(),
    destinationPlacementJson: text({ mode: "json" })
      .$type<CapabilityPlacement>()
      .notNull(),
    state: text({
      enum: [
        "planned",
        "copying",
        "verifying",
        "ready-to-switch",
        "switched",
        "source-retained",
        "completed",
        "failed",
      ],
    })
      .notNull()
      .default("planned"),
    sourceDigest: text(),
    destinationDigest: text(),
    copiedBytes: text().notNull().default("0"),
    idempotencyKey: text().notNull(),
    safeErrorCode: text(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("placement_migrations_idempotency_unique").on(
      table.accountId,
      table.idempotencyKey,
    ),
    index("placement_migrations_resource_idx").on(
      table.accountId,
      table.resourceKind,
      table.resourceId,
    ),
  ],
);

export const managedCircuitBreakers = sqliteTable(
  "managed_circuit_breakers",
  {
    id: text().primaryKey().$defaultFn(() => newId("mcbr")),
    scope: text({ enum: ["global", "account", "provider", "capability"] })
      .notNull(),
    scopeId: text().notNull(),
    state: text({ enum: ["open", "closed", "half-open"] }).notNull(),
    reasonCode: text().notNull(),
    actorId: text().notNull(),
    expiresAt: integer({ mode: "timestamp" }),
    updatedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("managed_circuit_breakers_scope_unique").on(
      table.scope,
      table.scopeId,
    ),
  ],
);

export const managedStorageObjects = sqliteTable(
  "managed_storage_objects",
  {
    accountId: accountId(),
    namespace: text().notNull(),
    logicalKey: text().notNull(),
    physicalKey: text().notNull(),
    digest: text().notNull(),
    byteSize: text().notNull(),
    mimeType: text().notNull(),
    category: text({
      enum: ["committed", "trash", "pending", "scratch", "reserved"],
    })
      .notNull()
      .default("committed"),
    placementJson: text({ mode: "json" })
      .$type<CapabilityPlacement>()
      .notNull(),
    reservationId: text().references(() => usageReservations.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    committedAt: integer({ mode: "timestamp" }).notNull(),
    deletedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.namespace, table.logicalKey],
    }),
    uniqueIndex("managed_storage_objects_physical_unique").on(
      table.physicalKey,
    ),
    index("managed_storage_objects_category_idx").on(
      table.accountId,
      table.category,
    ),
  ],
);

export const securityAuditEvents = sqliteTable(
  "security_audit_events",
  {
    id: text().primaryKey().$defaultFn(() => newId("saud")),
    accountId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorId: text().notNull(),
    actorKind: text({ enum: ["user", "admin", "system", "provider"] })
      .notNull(),
    action: text().notNull(),
    resourceKind: text().notNull(),
    resourceId: text(),
    justification: text(),
    correlationId: text().notNull(),
    policyVersion: text().notNull(),
    redactedMetadataJson: text({ mode: "json" }).$type<unknown>().notNull(),
    occurredAt: timestamp(),
  },
  (table) => [
    index("security_audit_events_account_time_idx").on(
      table.accountId,
      table.occurredAt,
    ),
    index("security_audit_events_action_idx").on(
      table.action,
      table.occurredAt,
    ),
  ],
);

export const supportElevations = sqliteTable(
  "support_elevations",
  {
    id: text().primaryKey().$defaultFn(() => newId("selev")),
    accountId: accountId(),
    operatorId: text().notNull(),
    scopeJson: text({ mode: "json" }).$type<string[]>().notNull(),
    justification: text().notNull(),
    state: text({ enum: ["requested", "active", "expired", "revoked"] })
      .notNull()
      .default("requested"),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    activatedAt: integer({ mode: "timestamp" }),
    revokedAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
  },
  (table) => [
    index("support_elevations_active_idx").on(
      table.accountId,
      table.state,
      table.expiresAt,
    ),
  ],
);

export const privacyOperationRequests = sqliteTable(
  "privacy_operation_requests",
  {
    id: text().primaryKey().$defaultFn(() => newId("priv")),
    accountId: accountId(),
    kind: text({ enum: ["export", "trash", "delete-now"] }).notNull(),
    scopeKind: text({ enum: ["account", "project", "thread"] }).notNull(),
    scopeId: text().notNull(),
    state: text({ enum: ["pending", "running", "completed", "partial", "failed"] })
      .notNull()
      .default("pending"),
    manifestDigest: text(),
    exportObjectRefJson: text({ mode: "json" }).$type<unknown>(),
    requestedAt: timestamp(),
    completedAt: integer({ mode: "timestamp" }),
    tombstoneAt: integer({ mode: "timestamp" }),
    safeErrorCode: text(),
  },
  (table) => [
    index("privacy_operation_requests_account_idx").on(
      table.accountId,
      table.requestedAt,
    ),
  ],
);

export const privacyOperationTargets = sqliteTable(
  "privacy_operation_targets",
  {
    requestId: text()
      .notNull()
      .references(() => privacyOperationRequests.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    placementKey: text().notNull(),
    placementJson: text({ mode: "json" })
      .$type<CapabilityPlacement>()
      .notNull(),
    state: text().$type<PlacementDeletionState>().notNull(),
    nonce: text().notNull(),
    manifestDigest: text().notNull(),
    objectClassesJson: text({ mode: "json" }).$type<string[]>().notNull(),
    receiptJson: text({ mode: "json" }).$type<DeletionReceiptV1>(),
    attempts: integer().notNull().default(0),
    lastAttemptAt: integer({ mode: "timestamp" }),
    safeErrorCode: text(),
    updatedAt: timestamp(),
  },
  (table) => [
    primaryKey({ columns: [table.requestId, table.placementKey] }),
    index("privacy_operation_targets_backlog_idx").on(
      table.state,
      table.updatedAt,
    ),
  ],
);

export const managedAbuseDecisions = sqliteTable(
  "managed_abuse_decisions",
  {
    id: text().primaryKey().$defaultFn(() => newId("abus")),
    accountId: accountId(),
    capability: text().$type<ManagedCapability>(),
    reasonCode: text().notNull(),
    policyVersion: text().notNull(),
    state: text({ enum: ["allowed", "restricted", "quarantined", "blocked"] })
      .notNull(),
    appealState: text({ enum: ["none", "pending", "accepted", "rejected"] })
      .notNull()
      .default("none"),
    evidenceDigest: text(),
    expiresAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    index("managed_abuse_decisions_account_idx").on(
      table.accountId,
      table.createdAt,
    ),
  ],
);
