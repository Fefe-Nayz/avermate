import type { ManagedCapability } from "@avermate/agent-contracts";
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
import { newId } from "../../lib/id";
import { users } from "./auth";

const timestamp = () =>
  integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

/** One-time, hashed admission credential for the managed beta. */
export const managedBetaInvites = sqliteTable(
  "managed_beta_invites",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("mbi")),
    tokenDigest: text().notNull(),
    emailDigest: text(),
    cohort: text().notNull(),
    region: text().notNull(),
    capabilitiesJson: text({ mode: "json" })
      .$type<ManagedCapability[]>()
      .notNull(),
    termsRevision: text().notNull(),
    privacyRevision: text().notNull(),
    status: text({ enum: ["issued", "redeemed", "revoked", "expired"] })
      .notNull()
      .default("issued"),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    redeemedByAccountId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    redeemedAt: integer({ mode: "timestamp" }),
    createdAt: timestamp(),
  },
  (table) => [
    uniqueIndex("managed_beta_invites_token_unique").on(table.tokenDigest),
    index("managed_beta_invites_status_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
  ],
);

export const managedBetaWaitlist = sqliteTable(
  "managed_beta_waitlist",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("mbw")),
    accountId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    preferredRegion: text().notNull(),
    status: text({ enum: ["waiting", "invited", "withdrawn"] })
      .notNull()
      .default("waiting"),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("managed_beta_waitlist_account_unique").on(table.accountId),
    index("managed_beta_waitlist_status_idx").on(table.status, table.createdAt),
  ],
);

/** Eligibility is independent from billing and from the entitlement ledger. */
export const managedBetaAccounts = sqliteTable(
  "managed_beta_accounts",
  {
    accountId: text()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    inviteId: text().references(() => managedBetaInvites.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    cohort: text().notNull(),
    region: text().notNull(),
    state: text({ enum: ["active", "suspended", "left"] })
      .notNull()
      .default("active"),
    acceptedTermsRevision: text().notNull(),
    acceptedPrivacyRevision: text().notNull(),
    managedDataConsent: integer({ mode: "boolean" }).notNull().default(false),
    consentedCategoriesJson: text({ mode: "json" }).$type<string[]>().notNull(),
    capabilitiesJson: text({ mode: "json" })
      .$type<ManagedCapability[]>()
      .notNull(),
    policyRevision: text().notNull(),
    activatedAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    index("managed_beta_accounts_state_cohort_idx").on(
      table.state,
      table.cohort,
    ),
  ],
);

/** Additional daily/monthly beta caps; entitlements remain the primary ledger. */
export const managedQuotaPolicies = sqliteTable(
  "managed_quota_policies",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("mqp")),
    scope: text({
      enum: ["global", "account", "cohort", "provider", "capability"],
    }).notNull(),
    scopeId: text().notNull(),
    capability: text().notNull().default("*"),
    period: text({ enum: ["daily", "monthly"] }).notNull(),
    hardLimit: text().notNull(),
    concurrency: integer().notNull(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    revision: text().notNull(),
    justification: text().notNull(),
    updatedByUserId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("managed_quota_policies_identity_unique").on(
      table.scope,
      table.scopeId,
      table.capability,
      table.period,
    ),
    index("managed_quota_policies_enabled_idx").on(
      table.enabled,
      table.scope,
      table.scopeId,
    ),
    check(
      "managed_quota_policies_limit_check",
      sql`${table.hardLimit} glob '[0-9]*' and ${table.hardLimit} <> '' and ${table.concurrency} >= 0`,
    ),
  ],
);

/** Redacted operational evidence; repository fixtures cannot masquerade as live drills. */
export const managedOperationalEvidence = sqliteTable(
  "managed_operational_evidence",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("moe")),
    kind: text({
      enum: [
        "provider",
        "isolation",
        "backup",
        "restore",
        "load",
        "privacy",
        "alert",
        "billing-test",
        "airgap",
      ],
    }).notNull(),
    environment: text().notNull(),
    region: text(),
    provider: text(),
    releaseRevision: text().notNull(),
    status: text({
      enum: ["unverified", "blocked", "running", "passed", "failed", "stale"],
    }).notNull(),
    source: text({
      enum: [
        "repository-fixture",
        "deployed-drill",
        "external-attestation",
        "operator-observation",
      ],
    }).notNull(),
    safeSummary: text().notNull(),
    metricsJson: text({ mode: "json" })
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    artifactDigest: text(),
    reference: text(),
    observedAt: integer({ mode: "timestamp" }).notNull(),
    expiresAt: integer({ mode: "timestamp" }),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: timestamp(),
  },
  (table) => [
    index("managed_operational_evidence_kind_status_idx").on(
      table.kind,
      table.status,
      table.observedAt,
    ),
  ],
);

export const managedIncidents = sqliteTable(
  "managed_incidents",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("minc")),
    title: text().notNull(),
    safeSummary: text().notNull(),
    severity: text({ enum: ["minor", "major", "critical"] }).notNull(),
    status: text({
      enum: ["investigating", "identified", "monitoring", "resolved"],
    }).notNull(),
    affectedCapabilitiesJson: text({ mode: "json" })
      .$type<ManagedCapability[]>()
      .notNull(),
    provider: text(),
    publiclyVisible: integer({ mode: "boolean" }).notNull().default(false),
    startedAt: integer({ mode: "timestamp" }).notNull(),
    resolvedAt: integer({ mode: "timestamp" }),
    updatedByUserId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  (table) => [
    index("managed_incidents_public_status_idx").on(
      table.publiclyVisible,
      table.status,
      table.startedAt,
    ),
  ],
);

/** Commercial gates are evidence pointers, never self-asserted booleans. */
export const managedLaunchGates = sqliteTable(
  "managed_launch_gates",
  {
    key: text().primaryKey(),
    phase: text({ enum: ["A", "B", "C", "D", "E"] }).notNull(),
    status: text({ enum: ["blocked", "pending", "passed"] }).notNull(),
    evidenceId: text().references(() => managedOperationalEvidence.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    justification: text().notNull(),
    updatedByUserId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    updatedAt: timestamp(),
  },
  (table) => [
    index("managed_launch_gates_phase_status_idx").on(
      table.phase,
      table.status,
    ),
  ],
);

/** Immutable external price mapping; no mapping grants an entitlement by itself. */
export const managedBillingPriceMappings = sqliteTable(
  "managed_billing_price_mappings",
  {
    provider: text().notNull(),
    externalPriceRef: text().notNull(),
    planRevision: text().notNull(),
    currency: text().notNull(),
    entitlementTemplateJson: text({ mode: "json" }).$type<unknown>().notNull(),
    active: integer({ mode: "boolean" }).notNull().default(false),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: timestamp(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.externalPriceRef] }),
    uniqueIndex("managed_billing_price_plan_revision_unique").on(
      table.provider,
      table.planRevision,
    ),
  ],
);
