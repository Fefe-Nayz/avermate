import type {
  CapabilityErrorCode,
  CapabilityKind,
  CapabilityOffering,
  CapabilityPolicyConstraints,
  CapabilityUsage,
  FrozenCapabilityRoutePlan,
} from "@avermate/agent-contracts";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";

const timestamp = () =>
  integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const digestCheck = (name: string, column: { getSQL(): unknown }) =>
  check(
    name,
    sql`length(${column}) = 71 and substr(${column}, 1, 7) = 'sha256:' and substr(${column}, 8) not glob '*[^0-9a-f]*'`,
  );

const nullableDigestCheck = (name: string, column: { getSQL(): unknown }) =>
  check(
    name,
    sql`${column} is null or (length(${column}) = 71 and substr(${column}, 1, 7) = 'sha256:' and substr(${column}, 8) not glob '*[^0-9a-f]*')`,
  );

export const capabilityProviderConnections = sqliteTable(
  "capability_provider_connections",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("cconn")),
    ownerKind: text({ enum: ["instance", "user", "node"] }).notNull(),
    ownerId: text().notNull(),
    pluginId: text().notNull(),
    pluginVersion: text().notNull(),
    displayName: text().notNull(),
    placementKind: text({
      enum: ["core", "managed", "direct-byok", "node", "full-self-host"],
    }).notNull(),
    placementRef: text().notNull(),
    placementJson: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    configVersion: integer().notNull(),
    configJson: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    configDigest: text().notNull(),
    status: text({
      enum: [
        "draft",
        "validating",
        "ready",
        "degraded",
        "disabled",
        "invalid",
        "deleted",
      ],
    })
      .notNull()
      .default("draft"),
    revision: integer().notNull().default(1),
    lastValidatedAt: integer({ mode: "timestamp" }),
    deletedAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    index("capability_connections_owner_status_idx").on(
      table.ownerKind,
      table.ownerId,
      table.status,
    ),
    index("capability_connections_plugin_idx").on(
      table.pluginId,
      table.pluginVersion,
    ),
    check("capability_connections_revision_check", sql`${table.revision} >= 1`),
    check(
      "capability_connections_config_version_check",
      sql`${table.configVersion} >= 1`,
    ),
    digestCheck("capability_connections_config_digest_check", table.configDigest),
  ],
);

export const capabilityConnectionSecrets = sqliteTable(
  "capability_connection_secrets",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("csec")),
    connectionId: text()
      .notNull()
      .references(() => capabilityProviderConnections.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    slot: text().notNull(),
    custody: text({
      enum: ["core-encrypted", "operator-env", "node-local"],
    }).notNull(),
    sealedValue: text(),
    nodeSecretRef: text(),
    hint: text().notNull().default(""),
    keyVersion: integer().notNull().default(1),
    scopesJson: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    status: text({ enum: ["active", "invalid", "revoked"] })
      .notNull()
      .default("active"),
    lastValidatedAt: integer({ mode: "timestamp" }),
    revokedAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("capability_connection_secrets_slot_unique").on(
      table.connectionId,
      table.slot,
    ),
    index("capability_connection_secrets_status_idx").on(
      table.connectionId,
      table.status,
    ),
    check(
      "capability_connection_secrets_custody_check",
      sql`(
        (${table.custody} = 'core-encrypted' and ${table.sealedValue} is not null and ${table.nodeSecretRef} is null)
        or (${table.custody} = 'operator-env' and ${table.sealedValue} is null and ${table.nodeSecretRef} is null)
        or (${table.custody} = 'node-local' and ${table.sealedValue} is null and ${table.nodeSecretRef} is not null)
      )`,
    ),
    check(
      "capability_connection_secrets_version_check",
      sql`${table.keyVersion} >= 1`,
    ),
  ],
);

export const capabilityOfferings = sqliteTable(
  "capability_offerings",
  {
    id: text().primaryKey(),
    connectionId: text()
      .notNull()
      .references(() => capabilityProviderConnections.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    capabilityKind: text().$type<CapabilityKind>().notNull(),
    descriptorVersion: integer().notNull().default(1),
    descriptorJson: text({ mode: "json" }).$type<CapabilityOffering>().notNull(),
    descriptorDigest: text().notNull(),
    provider: text().notNull(),
    modelId: text().notNull(),
    modelRevision: text().notNull(),
    adapterRevision: text().notNull(),
    compatibilityKey: text(),
    status: text({
      enum: ["discovered", "ready", "unavailable", "retired"],
    })
      .notNull()
      .default("discovered"),
    discoveredAt: timestamp(),
    expiresAt: integer({ mode: "timestamp" }),
    lastHealthyAt: integer({ mode: "timestamp" }),
    retiredAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
  },
  (table) => [
    uniqueIndex("capability_offerings_descriptor_digest_unique").on(
      table.connectionId,
      table.descriptorDigest,
    ),
    index("capability_offerings_connection_status_idx").on(
      table.connectionId,
      table.status,
    ),
    index("capability_offerings_kind_status_idx").on(
      table.capabilityKind,
      table.status,
    ),
    check(
      "capability_offerings_descriptor_version_check",
      sql`${table.descriptorVersion} = 1`,
    ),
    digestCheck("capability_offerings_descriptor_digest_check", table.descriptorDigest),
  ],
);

export const capabilityPolicies = sqliteTable(
  "capability_policies",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("cpol")),
    ownerId: text().notNull(),
    scopeKind: text({
      enum: ["instance", "managed-plan", "user", "project", "workflow"],
    }).notNull(),
    scopeId: text().notNull(),
    capabilityKind: text().$type<CapabilityKind>().notNull(),
    purposePattern: text().notNull(),
    mode: text({ enum: ["disabled", "automatic", "pinned", "ordered"] })
      .notNull(),
    primaryOfferingId: text().references(() => capabilityOfferings.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    fallbackOfferingIdsJson: text({ mode: "json" }).$type<string[]>().notNull(),
    constraintsJson: text({ mode: "json" })
      .$type<CapabilityPolicyConstraints>()
      .notNull(),
    revision: integer().notNull().default(1),
    deletedAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("capability_policies_active_scope_unique")
      .on(
        table.ownerId,
        table.scopeKind,
        table.scopeId,
        table.capabilityKind,
        table.purposePattern,
      )
      .where(sql`${table.deletedAt} is null`),
    index("capability_policies_owner_kind_idx").on(
      table.ownerId,
      table.capabilityKind,
      table.deletedAt,
    ),
    check("capability_policies_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const capabilityConsents = sqliteTable(
  "capability_consents",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("ccons")),
    ownerId: text().notNull(),
    connectionId: text()
      .notNull()
      .references(() => capabilityProviderConnections.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    capabilityKind: text().$type<CapabilityKind>().notNull(),
    disclosureRevision: text().notNull(),
    status: text({ enum: ["granted", "revoked"] })
      .notNull()
      .default("granted"),
    revision: integer().notNull().default(1),
    grantedAt: timestamp(),
    revokedAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("capability_consents_identity_unique").on(
      table.ownerId,
      table.connectionId,
      table.capabilityKind,
      table.disclosureRevision,
    ),
    index("capability_consents_owner_status_idx").on(
      table.ownerId,
      table.status,
    ),
    check("capability_consents_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const capabilityOperations = sqliteTable(
  "capability_operations",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("cop")),
    ownerId: text().notNull(),
    capabilityKind: text().$type<CapabilityKind>().notNull(),
    purpose: text().notNull(),
    inputDigest: text().notNull(),
    idempotencyKey: text().notNull(),
    policySnapshotJson: text({ mode: "json" }).$type<unknown>().notNull(),
    policySnapshotDigest: text().notNull(),
    routePlanJson: text({ mode: "json" }).$type<FrozenCapabilityRoutePlan>(),
    routePlanDigest: text(),
    state: text({
      enum: [
        "reserved",
        "routing",
        "ready",
        "dispatching",
        "acknowledged",
        "waiting-provider",
        "completed",
        "failed",
        "cancelled",
        "inspect-required",
      ],
    })
      .notNull()
      .default("reserved"),
    resultRefJson: text({ mode: "json" }).$type<unknown>(),
    resultDigest: text(),
    safeErrorCode: text().$type<CapabilityErrorCode>(),
    retryable: integer({ mode: "boolean" }).notNull().default(false),
    ambiguous: integer({ mode: "boolean" }).notNull().default(false),
    revision: integer().notNull().default(1),
    createdAt: timestamp(),
    updatedAt: timestamp(),
    completedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("capability_operations_owner_idempotency_unique").on(
      table.ownerId,
      table.capabilityKind,
      table.idempotencyKey,
    ),
    index("capability_operations_owner_state_idx").on(
      table.ownerId,
      table.state,
      table.createdAt,
    ),
    digestCheck("capability_operations_input_digest_check", table.inputDigest),
    digestCheck(
      "capability_operations_policy_digest_check",
      table.policySnapshotDigest,
    ),
    check("capability_operations_revision_check", sql`${table.revision} >= 1`),
    check(
      "capability_operations_route_pair_check",
      sql`(${table.routePlanJson} is null) = (${table.routePlanDigest} is null)`,
    ),
    check(
      "capability_operations_result_pair_check",
      sql`(${table.resultRefJson} is null) = (${table.resultDigest} is null)`,
    ),
    nullableDigestCheck(
      "capability_operations_route_digest_check",
      table.routePlanDigest,
    ),
    nullableDigestCheck(
      "capability_operations_result_digest_check",
      table.resultDigest,
    ),
  ],
);

export const capabilityAttempts = sqliteTable(
  "capability_attempts",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("catt")),
    operationId: text()
      .notNull()
      .references(() => capabilityOperations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    ordinal: integer().notNull(),
    offeringId: text()
      .notNull()
      .references(() => capabilityOfferings.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    requestDigest: text().notNull(),
    state: text({
      enum: [
        "reserved",
        "dispatching",
        "acknowledged",
        "waiting-provider",
        "completed",
        "failed",
        "cancelled",
        "inspect-required",
      ],
    })
      .notNull()
      .default("reserved"),
    providerRequestId: text(),
    credentialVersion: integer(),
    consentRevision: integer(),
    errorClass: text().$type<CapabilityErrorCode>(),
    retryable: integer({ mode: "boolean" }).notNull().default(false),
    ambiguous: integer({ mode: "boolean" }).notNull().default(false),
    safeDiagnosticJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    startedAt: timestamp(),
    providerDispatchedAt: integer({ mode: "timestamp" }),
    acknowledgedAt: integer({ mode: "timestamp" }),
    completedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("capability_attempts_operation_ordinal_unique").on(
      table.operationId,
      table.ordinal,
    ),
    index("capability_attempts_offering_state_idx").on(
      table.offeringId,
      table.state,
      table.startedAt,
    ),
    digestCheck("capability_attempts_request_digest_check", table.requestDigest),
    check("capability_attempts_ordinal_check", sql`${table.ordinal} >= 0`),
  ],
);

export const capabilityUsage = sqliteTable(
  "capability_usage",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("cuse")),
    operationId: text()
      .notNull()
      .references(() => capabilityOperations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    attemptId: text()
      .notNull()
      .references(() => capabilityAttempts.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    usageDigest: text().notNull(),
    usageJson: text({ mode: "json" }).$type<CapabilityUsage>().notNull(),
    createdAt: timestamp(),
  },
  (table) => [
    index("capability_usage_operation_idx").on(
      table.operationId,
      table.createdAt,
    ),
    uniqueIndex("capability_usage_attempt_unique").on(table.attemptId),
    uniqueIndex("capability_usage_operation_attempt_unique").on(
      table.operationId,
      table.attemptId,
    ),
    digestCheck("capability_usage_digest_check", table.usageDigest),
  ],
);

export const capabilityOfferingHealth = sqliteTable(
  "capability_offering_health",
  {
    offeringId: text()
      .primaryKey()
      .references(() => capabilityOfferings.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    state: text({
      enum: [
        "unknown",
        "validating",
        "healthy",
        "degraded",
        "offline",
        "unauthorized",
        "disabled",
      ],
    })
      .notNull()
      .default("unknown"),
    lastSuccessAt: integer({ mode: "timestamp" }),
    lastFailureAt: integer({ mode: "timestamp" }),
    consecutiveFailures: integer().notNull().default(0),
    latencyP50Ms: integer(),
    latencyP95Ms: integer(),
    safeErrorCode: text().$type<CapabilityErrorCode>(),
    revision: integer().notNull().default(1),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    updatedAt: timestamp(),
  },
  (table) => [
    index("capability_offering_health_state_expiry_idx").on(
      table.state,
      table.expiresAt,
    ),
    check(
      "capability_offering_health_failures_check",
      sql`${table.consecutiveFailures} >= 0`,
    ),
    check(
      "capability_offering_health_revision_check",
      sql`${table.revision} >= 1`,
    ),
  ],
);
