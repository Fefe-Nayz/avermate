import { createHmac, randomBytes } from "node:crypto";
import type { InValue } from "@libsql/client";
import {
  managedCapabilitySchema,
  type ManagedCapability,
} from "@avermate/agent-contracts";
import { z } from "zod";
import type {
  EntitlementSqlClient,
  EntitlementSqlTarget,
} from "../entitlements/service";
import { MANAGED_CAPABILITIES } from "../entitlements/capabilities";
import { newId } from "../lib/id";
import { SecurityAuditWriter } from "../observability/audit";
import { safeOperationalMetadata } from "../observability/redaction";

type Row = Record<string, InValue>;

const boundedId = z.string().trim().min(1).max(256);
const revision = z.string().trim().min(1).max(128);
const region = z.string().trim().min(1).max(64);
const managedDataCategorySchema = z.enum([
  "files",
  "conversations",
  "retrieval",
  "inference",
  "sandbox-artifacts",
]);
const managedDataCategoriesSchema = z
  .array(managedDataCategorySchema)
  .max(5)
  .transform((values) => [...new Set(values)].sort());
const capabilityList = z
  .array(managedCapabilitySchema)
  .min(1)
  .max(MANAGED_CAPABILITIES.length)
  .transform((values) => [...new Set(values)].sort() as ManagedCapability[]);

export const issueManagedBetaInviteSchema = z.strictObject({
  email: z.email().max(320).optional(),
  cohort: z.string().trim().min(1).max(128),
  region,
  capabilities: capabilityList,
  termsRevision: revision,
  privacyRevision: revision,
  expiresAt: z.coerce.date(),
});

export const redeemManagedBetaInviteSchema = z.strictObject({
  token: z.string().trim().min(20).max(512),
  termsRevision: revision,
  privacyRevision: revision,
  consentedCategories: z
    .array(managedDataCategorySchema)
    .min(1)
    .max(5)
    .transform((values) => [...new Set(values)].sort()),
});

export const updateManagedBetaConsentSchema = z
  .strictObject({
    enabled: z.boolean(),
    categories: managedDataCategoriesSchema,
  })
  .refine(({ enabled, categories }) => !enabled || categories.length > 0, {
    path: ["categories"],
    message:
      "At least one managed data category is required when consent is enabled",
  });

export const managedQuotaPolicySchema = z.strictObject({
  scope: z.enum(["global", "account", "cohort", "provider", "capability"]),
  scopeId: boundedId,
  capability: z.union([z.literal("*"), managedCapabilitySchema]),
  period: z.enum(["daily", "monthly"]),
  hardLimit: z.string().regex(/^(?:0|[1-9]\d*)$/u),
  concurrency: z.number().int().min(0).max(100_000),
  enabled: z.boolean(),
  revision,
  justification: z.string().trim().min(1).max(1_000),
});

export const managedOperationalEvidenceSchema = z.strictObject({
  kind: z.enum([
    "provider",
    "isolation",
    "backup",
    "restore",
    "load",
    "privacy",
    "alert",
    "billing-test",
    "airgap",
  ]),
  environment: z.string().trim().min(1).max(128),
  region: region.optional(),
  provider: z.string().trim().min(1).max(128).optional(),
  releaseRevision: revision,
  status: z.enum([
    "unverified",
    "blocked",
    "running",
    "passed",
    "failed",
    "stale",
  ]),
  source: z.enum([
    "repository-fixture",
    "deployed-drill",
    "external-attestation",
    "operator-observation",
  ]),
  safeSummary: z.string().trim().min(1).max(2_000),
  metrics: z.record(
    z.string().min(1).max(128),
    z.union([z.string().max(512), z.number().finite(), z.boolean(), z.null()]),
  ),
  artifactDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .optional(),
  reference: z.string().trim().min(1).max(1_024).optional(),
  observedAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
});

export const managedIncidentSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  safeSummary: z.string().trim().min(1).max(2_000),
  severity: z.enum(["minor", "major", "critical"]),
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  affectedCapabilities: z
    .array(managedCapabilitySchema)
    .max(MANAGED_CAPABILITIES.length),
  provider: z.string().trim().min(1).max(128).optional(),
  publiclyVisible: z.boolean(),
  startedAt: z.coerce.date(),
});

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function iso(value: InValue | undefined | null) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return new Date(
    numeric < 10_000_000_000 ? numeric * 1_000 : numeric,
  ).toISOString();
}

function parseJson<T>(value: InValue | undefined | null, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } catch {
    return fallback;
  }
}

function invitationView(row: Row) {
  return {
    id: String(row.id),
    emailRestricted: row.emailDigest !== null,
    cohort: String(row.cohort),
    region: String(row.region),
    capabilities: capabilityList.parse(parseJson(row.capabilitiesJson, [])),
    termsRevision: String(row.termsRevision),
    privacyRevision: String(row.privacyRevision),
    status: String(row.status),
    expiresAt: iso(row.expiresAt),
    redeemedByAccountId:
      row.redeemedByAccountId === null ? null : String(row.redeemedByAccountId),
    redeemedAt: iso(row.redeemedAt),
    createdAt: iso(row.createdAt),
  };
}

function accountView(row: Row) {
  return {
    accountId: String(row.accountId),
    inviteId: row.inviteId === null ? null : String(row.inviteId),
    cohort: String(row.cohort),
    region: String(row.region),
    state: String(row.state),
    acceptedTermsRevision: String(row.acceptedTermsRevision),
    acceptedPrivacyRevision: String(row.acceptedPrivacyRevision),
    managedDataConsent: Number(row.managedDataConsent) === 1,
    consentedCategories: parseJson<string[]>(row.consentedCategoriesJson, []),
    capabilities: capabilityList.parse(parseJson(row.capabilitiesJson, [])),
    policyRevision: String(row.policyRevision),
    activatedAt: iso(row.activatedAt),
    updatedAt: iso(row.updatedAt),
  };
}

export class ManagedBetaError extends Error {
  constructor(
    readonly code:
      | "invite-not-found"
      | "invite-expired"
      | "invite-used"
      | "invite-account-mismatch"
      | "terms-mismatch"
      | "already-enrolled"
      | "not-enrolled"
      | "evidence-required"
      | "invalid-evidence",
    message: string,
  ) {
    super(message);
    this.name = "ManagedBetaError";
  }
}

export class ManagedBetaControlPlane {
  readonly #client: EntitlementSqlClient;
  readonly #key: string;
  readonly #clock: () => Date;
  readonly #audit: SecurityAuditWriter;

  constructor(input: {
    client: EntitlementSqlClient;
    secret: string;
    clock?: () => Date;
  }) {
    this.#client = input.client;
    this.#key = input.secret;
    this.#clock = input.clock ?? (() => new Date());
    this.#audit = new SecurityAuditWriter(input.client, this.#clock);
  }

  #digest(namespace: string, value: string) {
    return createHmac("sha256", this.#key)
      .update(`${namespace}\0${value}`)
      .digest("hex");
  }

  async issueInvite(
    raw: z.input<typeof issueManagedBetaInviteSchema>,
    actor: { actorId: string; correlationId: string },
  ) {
    const input = issueManagedBetaInviteSchema.parse(raw);
    if (input.expiresAt <= this.#clock()) {
      throw new ManagedBetaError(
        "invite-expired",
        "Invite expiry must be in the future",
      );
    }
    const token = `avermate_beta_${randomBytes(32).toString("base64url")}`;
    const id = newId("mbi");
    await this.#client.execute({
      sql: `INSERT INTO managed_beta_invites
        (id, tokenDigest, emailDigest, cohort, region, capabilitiesJson,
         termsRevision, privacyRevision, status, expiresAt, createdByUserId,
         createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
      args: [
        id,
        this.#digest("invite", token),
        input.email
          ? this.#digest("email", input.email.trim().toLowerCase())
          : null,
        input.cohort,
        input.region,
        JSON.stringify(input.capabilities),
        input.termsRevision,
        input.privacyRevision,
        seconds(input.expiresAt),
        actor.actorId,
        seconds(this.#clock()),
      ],
    });
    await this.#audit.append({
      accountId: null,
      actorId: actor.actorId,
      actorKind: "admin",
      action: "managed-beta.invite-issued",
      resourceKind: "managed-beta-invite",
      resourceId: id,
      justification: `Invite-only beta cohort ${input.cohort}`,
      correlationId: actor.correlationId,
      policyVersion: "managed-beta/1",
      metadata: {
        cohort: input.cohort,
        region: input.region,
        capabilities: input.capabilities,
        emailRestricted: Boolean(input.email),
        expiresAt: input.expiresAt,
      },
    });
    return { id, token, ...input };
  }

  async revokeInvite(input: {
    inviteId: string;
    actorId: string;
    correlationId: string;
    justification: string;
  }) {
    const result = await this.#client.execute({
      sql: `UPDATE managed_beta_invites SET status = 'revoked'
        WHERE id = ? AND status = 'issued'`,
      args: [input.inviteId],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new ManagedBetaError("invite-not-found", "Active invite not found");
    }
    await this.#audit.append({
      accountId: null,
      actorId: input.actorId,
      actorKind: "admin",
      action: "managed-beta.invite-revoked",
      resourceKind: "managed-beta-invite",
      resourceId: input.inviteId,
      justification: input.justification,
      correlationId: input.correlationId,
      policyVersion: "managed-beta/1",
    });
    return { ok: true };
  }

  async joinWaitlist(accountId: string, preferredRegion: string) {
    const normalizedRegion = region.parse(preferredRegion);
    const now = seconds(this.#clock());
    await this.#client.execute({
      sql: `INSERT INTO managed_beta_waitlist
        (id, accountId, preferredRegion, status, createdAt, updatedAt)
        VALUES (?, ?, ?, 'waiting', ?, ?)
        ON CONFLICT(accountId) DO UPDATE SET preferredRegion = excluded.preferredRegion,
          status = 'waiting', updatedAt = excluded.updatedAt`,
      args: [newId("mbw"), accountId, normalizedRegion, now, now],
    });
    return this.getWaitlist(accountId);
  }

  async withdrawWaitlist(accountId: string) {
    await this.#client.execute({
      sql: `UPDATE managed_beta_waitlist SET status = 'withdrawn', updatedAt = ?
        WHERE accountId = ?`,
      args: [seconds(this.#clock()), accountId],
    });
    return this.getWaitlist(accountId);
  }

  async getWaitlist(accountId: string) {
    const rows = await this.#client.execute({
      sql: `SELECT preferredRegion, status, createdAt, updatedAt
        FROM managed_beta_waitlist WHERE accountId = ? LIMIT 1`,
      args: [accountId],
    });
    const row = rows.rows[0] as Row | undefined;
    return row
      ? {
          preferredRegion: String(row.preferredRegion),
          status: String(row.status),
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        }
      : null;
  }

  async redeemInvite(input: {
    accountId: string;
    email: string;
    token: string;
    termsRevision: string;
    privacyRevision: string;
    consentedCategories: string[];
    correlationId: string;
  }) {
    const parsed = redeemManagedBetaInviteSchema.parse({
      token: input.token,
      termsRevision: input.termsRevision,
      privacyRevision: input.privacyRevision,
      consentedCategories: input.consentedCategories,
    });
    const transaction = await this.#client.transaction("write");
    try {
      const existing = await transaction.execute({
        sql: "SELECT accountId FROM managed_beta_accounts WHERE accountId = ? LIMIT 1",
        args: [input.accountId],
      });
      if (existing.rows[0]) {
        throw new ManagedBetaError(
          "already-enrolled",
          "Account is already enrolled",
        );
      }
      const rows = await transaction.execute({
        sql: "SELECT * FROM managed_beta_invites WHERE tokenDigest = ? LIMIT 1",
        args: [this.#digest("invite", parsed.token)],
      });
      const invite = rows.rows[0] as Row | undefined;
      if (!invite)
        throw new ManagedBetaError("invite-not-found", "Invite not found");
      if (String(invite.status) !== "issued") {
        throw new ManagedBetaError("invite-used", "Invite is no longer active");
      }
      if (Number(invite.expiresAt) <= seconds(this.#clock())) {
        await transaction.execute({
          sql: "UPDATE managed_beta_invites SET status = 'expired' WHERE id = ?",
          args: [invite.id],
        });
        throw new ManagedBetaError("invite-expired", "Invite has expired");
      }
      if (
        invite.emailDigest !== null &&
        String(invite.emailDigest) !==
          this.#digest("email", input.email.trim().toLowerCase())
      ) {
        throw new ManagedBetaError(
          "invite-account-mismatch",
          "Invite belongs to another account",
        );
      }
      if (
        parsed.termsRevision !== String(invite.termsRevision) ||
        parsed.privacyRevision !== String(invite.privacyRevision)
      ) {
        throw new ManagedBetaError(
          "terms-mismatch",
          "The current terms and privacy revisions must be accepted",
        );
      }
      const now = seconds(this.#clock());
      const claimed = await transaction.execute({
        sql: `UPDATE managed_beta_invites SET status = 'redeemed',
          redeemedByAccountId = ?, redeemedAt = ?
          WHERE id = ? AND status = 'issued'`,
        args: [input.accountId, now, invite.id],
      });
      if (Number(claimed.rowsAffected) !== 1) {
        throw new ManagedBetaError(
          "invite-used",
          "Invite was redeemed concurrently",
        );
      }
      await transaction.execute({
        sql: `INSERT INTO managed_beta_accounts
          (accountId, inviteId, cohort, region, state, acceptedTermsRevision,
           acceptedPrivacyRevision, managedDataConsent, consentedCategoriesJson,
           capabilitiesJson, policyRevision, activatedAt, updatedAt)
          VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, ?, ?)`,
        args: [
          input.accountId,
          invite.id,
          invite.cohort,
          invite.region,
          parsed.termsRevision,
          parsed.privacyRevision,
          JSON.stringify(parsed.consentedCategories),
          JSON.stringify(parseJson(invite.capabilitiesJson, [])),
          `invite:${String(invite.id)}`,
          now,
          now,
        ],
      });
      await transaction.execute({
        sql: `UPDATE managed_beta_waitlist SET status = 'invited', updatedAt = ?
          WHERE accountId = ?`,
        args: [now, input.accountId],
      });
      await this.#audit.append(
        {
          accountId: input.accountId,
          actorId: input.accountId,
          actorKind: "user",
          action: "managed-beta.invite-redeemed",
          resourceKind: "managed-beta-account",
          resourceId: input.accountId,
          justification: "Explicit managed beta activation and data consent",
          correlationId: input.correlationId,
          policyVersion: "managed-beta/1",
          metadata: {
            inviteId: String(invite.id),
            cohort: String(invite.cohort),
            region: String(invite.region),
            consentedCategories: parsed.consentedCategories,
          },
        },
        transaction,
      );
      await transaction.commit();
      return this.getAccount(input.accountId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getAccount(accountId: string) {
    const rows = await this.#client.execute({
      sql: "SELECT * FROM managed_beta_accounts WHERE accountId = ? LIMIT 1",
      args: [accountId],
    });
    const row = rows.rows[0] as Row | undefined;
    return row ? accountView(row) : null;
  }

  async updateConsent(input: {
    accountId: string;
    enabled: boolean;
    categories: string[];
    actorId: string;
    correlationId: string;
  }) {
    const { categories } = updateManagedBetaConsentSchema.parse({
      enabled: input.enabled,
      categories: input.categories,
    });
    const result = await this.#client.execute({
      sql: `UPDATE managed_beta_accounts SET managedDataConsent = ?,
        consentedCategoriesJson = ?, updatedAt = ? WHERE accountId = ?`,
      args: [
        input.enabled ? 1 : 0,
        JSON.stringify(input.enabled ? categories : []),
        seconds(this.#clock()),
        input.accountId,
      ],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new ManagedBetaError(
        "not-enrolled",
        "Managed beta account not found",
      );
    }
    await this.#audit.append({
      accountId: input.accountId,
      actorId: input.actorId,
      actorKind: "user",
      action: input.enabled
        ? "managed-beta.consent-granted"
        : "managed-beta.consent-revoked",
      resourceKind: "managed-beta-account",
      resourceId: input.accountId,
      justification: input.enabled
        ? "Explicit managed processing consent"
        : "User revoked managed processing consent",
      correlationId: input.correlationId,
      policyVersion: "managed-beta/1",
      metadata: { categories: input.enabled ? categories : [] },
    });
    return this.getAccount(input.accountId);
  }

  async setAccountPolicy(input: {
    accountId: string;
    state: "active" | "suspended" | "left";
    capabilities: ManagedCapability[];
    policyRevision: string;
    actorId: string;
    correlationId: string;
    justification: string;
  }) {
    const capabilities = capabilityList.parse(input.capabilities);
    const result = await this.#client.execute({
      sql: `UPDATE managed_beta_accounts SET state = ?, capabilitiesJson = ?,
        policyRevision = ?, updatedAt = ? WHERE accountId = ?`,
      args: [
        input.state,
        JSON.stringify(capabilities),
        revision.parse(input.policyRevision),
        seconds(this.#clock()),
        input.accountId,
      ],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new ManagedBetaError(
        "not-enrolled",
        "Managed beta account not found",
      );
    }
    await this.#audit.append({
      accountId: input.accountId,
      actorId: input.actorId,
      actorKind: "admin",
      action: "managed-beta.account-policy-updated",
      resourceKind: "managed-beta-account",
      resourceId: input.accountId,
      justification: input.justification,
      correlationId: input.correlationId,
      policyVersion: "managed-beta/1",
      metadata: {
        state: input.state,
        capabilities,
        revision: input.policyRevision,
      },
    });
    return this.getAccount(input.accountId);
  }

  async upsertQuotaPolicy(
    raw: z.input<typeof managedQuotaPolicySchema>,
    actor: { actorId: string; correlationId: string },
  ) {
    const input = managedQuotaPolicySchema.parse(raw);
    const id = newId("mqp");
    const now = seconds(this.#clock());
    await this.#client.execute({
      sql: `INSERT INTO managed_quota_policies
        (id, scope, scopeId, capability, period, hardLimit, concurrency,
         enabled, revision, justification, updatedByUserId, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope, scopeId, capability, period) DO UPDATE SET
          hardLimit = excluded.hardLimit, concurrency = excluded.concurrency,
          enabled = excluded.enabled, revision = excluded.revision,
          justification = excluded.justification,
          updatedByUserId = excluded.updatedByUserId,
          updatedAt = excluded.updatedAt`,
      args: [
        id,
        input.scope,
        input.scopeId,
        input.capability,
        input.period,
        input.hardLimit,
        input.concurrency,
        input.enabled ? 1 : 0,
        input.revision,
        input.justification,
        actor.actorId,
        now,
        now,
      ],
    });
    await this.#audit.append({
      accountId: input.scope === "account" ? input.scopeId : null,
      actorId: actor.actorId,
      actorKind: "admin",
      action: "managed-beta.quota-policy-updated",
      resourceKind: "managed-quota-policy",
      resourceId: `${input.scope}:${input.scopeId}:${input.capability}:${input.period}`,
      justification: input.justification,
      correlationId: actor.correlationId,
      policyVersion: input.revision,
      metadata: input,
    });
    return { ...input };
  }

  async createEvidence(
    raw: z.input<typeof managedOperationalEvidenceSchema>,
    actor: { actorId: string; correlationId: string },
  ) {
    const input = managedOperationalEvidenceSchema.parse(raw);
    if (input.expiresAt && input.expiresAt <= input.observedAt) {
      throw new ManagedBetaError(
        "invalid-evidence",
        "Evidence expiry must follow observation",
      );
    }
    const id = newId("moe");
    const safeMetrics = safeOperationalMetadata(input.metrics);
    await this.#client.execute({
      sql: `INSERT INTO managed_operational_evidence
        (id, kind, environment, region, provider, releaseRevision, status,
         source, safeSummary, metricsJson, artifactDigest, reference,
         observedAt, expiresAt, createdByUserId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.kind,
        input.environment,
        input.region ?? null,
        input.provider ?? null,
        input.releaseRevision,
        input.status,
        input.source,
        input.safeSummary,
        JSON.stringify(safeMetrics),
        input.artifactDigest ?? null,
        input.reference ?? null,
        seconds(input.observedAt),
        input.expiresAt ? seconds(input.expiresAt) : null,
        actor.actorId,
        seconds(this.#clock()),
      ],
    });
    await this.#audit.append({
      accountId: null,
      actorId: actor.actorId,
      actorKind: "admin",
      action: "managed-operations.evidence-recorded",
      resourceKind: "managed-operational-evidence",
      resourceId: id,
      justification: input.safeSummary,
      correlationId: actor.correlationId,
      policyVersion: "managed-operations/1",
      metadata: {
        kind: input.kind,
        status: input.status,
        source: input.source,
        releaseRevision: input.releaseRevision,
      },
    });
    return { id, ...input, metrics: safeMetrics };
  }

  async setLaunchGate(input: {
    key: string;
    phase: "A" | "B" | "C" | "D" | "E";
    status: "blocked" | "pending" | "passed";
    evidenceId?: string;
    justification: string;
    actorId: string;
    correlationId: string;
  }) {
    const key = boundedId.parse(input.key);
    if (input.status === "passed") {
      if (!input.evidenceId) {
        throw new ManagedBetaError(
          "evidence-required",
          "Passing a gate requires evidence",
        );
      }
      const evidence = await this.#client.execute({
        sql: `SELECT status, source, expiresAt FROM managed_operational_evidence
          WHERE id = ? LIMIT 1`,
        args: [input.evidenceId],
      });
      const row = evidence.rows[0] as Row | undefined;
      if (
        !row ||
        String(row.status) !== "passed" ||
        !["deployed-drill", "external-attestation"].includes(
          String(row.source),
        ) ||
        (row.expiresAt !== null &&
          Number(row.expiresAt) <= seconds(this.#clock()))
      ) {
        throw new ManagedBetaError(
          "invalid-evidence",
          "Only current deployed or externally attested passing evidence can close a gate",
        );
      }
    }
    await this.#client.execute({
      sql: `INSERT INTO managed_launch_gates
        (key, phase, status, evidenceId, justification, updatedByUserId, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET phase = excluded.phase,
          status = excluded.status, evidenceId = excluded.evidenceId,
          justification = excluded.justification,
          updatedByUserId = excluded.updatedByUserId,
          updatedAt = excluded.updatedAt`,
      args: [
        key,
        input.phase,
        input.status,
        input.evidenceId ?? null,
        z.string().trim().min(1).max(1_000).parse(input.justification),
        input.actorId,
        seconds(this.#clock()),
      ],
    });
    await this.#audit.append({
      accountId: null,
      actorId: input.actorId,
      actorKind: "admin",
      action: "managed-launch.gate-updated",
      resourceKind: "managed-launch-gate",
      resourceId: key,
      justification: input.justification,
      correlationId: input.correlationId,
      policyVersion: "managed-launch/1",
      metadata: {
        phase: input.phase,
        status: input.status,
        evidenceId: input.evidenceId ?? null,
      },
    });
    return { ...input, key };
  }

  async createIncident(
    raw: z.input<typeof managedIncidentSchema>,
    actor: { actorId: string; correlationId: string },
  ) {
    const input = managedIncidentSchema.parse(raw);
    const id = newId("minc");
    const now = seconds(this.#clock());
    await this.#client.execute({
      sql: `INSERT INTO managed_incidents
        (id, title, safeSummary, severity, status, affectedCapabilitiesJson,
         provider, publiclyVisible, startedAt, resolvedAt, updatedByUserId,
         createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.title,
        input.safeSummary,
        input.severity,
        input.status,
        JSON.stringify(input.affectedCapabilities),
        input.provider ?? null,
        input.publiclyVisible ? 1 : 0,
        seconds(input.startedAt),
        input.status === "resolved" ? now : null,
        actor.actorId,
        now,
        now,
      ],
    });
    await this.#audit.append({
      accountId: null,
      actorId: actor.actorId,
      actorKind: "admin",
      action: "managed-operations.incident-created",
      resourceKind: "managed-incident",
      resourceId: id,
      justification: input.safeSummary,
      correlationId: actor.correlationId,
      policyVersion: "managed-incidents/1",
      metadata: {
        severity: input.severity,
        status: input.status,
        affectedCapabilities: input.affectedCapabilities,
        publiclyVisible: input.publiclyVisible,
      },
    });
    return { id, ...input };
  }

  async listPublicIncidents() {
    const rows = await this.#client.execute(`SELECT id, title, safeSummary,
      severity, status, affectedCapabilitiesJson, provider, startedAt, resolvedAt,
      updatedAt FROM managed_incidents WHERE publiclyVisible = 1
      ORDER BY startedAt DESC LIMIT 50`);
    return (rows.rows as Row[]).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      safeSummary: String(row.safeSummary),
      severity: String(row.severity),
      status: String(row.status),
      affectedCapabilities: parseJson<ManagedCapability[]>(
        row.affectedCapabilitiesJson,
        [],
      ),
      provider: row.provider === null ? null : String(row.provider),
      startedAt: iso(row.startedAt),
      resolvedAt: iso(row.resolvedAt),
      updatedAt: iso(row.updatedAt),
    }));
  }

  async exportManagedMetadata(input: {
    accountId: string;
    actorId: string;
    correlationId: string;
  }) {
    const [account, waitlist, usage, reservations, operations] =
      await Promise.all([
        this.getAccount(input.accountId),
        this.getWaitlist(input.accountId),
        this.#client.execute({
          sql: `SELECT capability, unit, direction, quantity, authoritative,
          occurredAt FROM usage_events WHERE accountId = ? ORDER BY occurredAt`,
          args: [input.accountId],
        }),
        this.#client.execute({
          sql: `SELECT id, capability, unit, reservedQuantity, consumedQuantity,
          releasedQuantity, status, expiresAt, createdAt, settledAt
          FROM usage_reservations WHERE accountId = ? ORDER BY createdAt`,
          args: [input.accountId],
        }),
        this.#client.execute({
          sql: `SELECT id, kind, scopeKind, scopeId, state, manifestDigest,
          requestedAt, completedAt, safeErrorCode
          FROM privacy_operation_requests WHERE accountId = ? ORDER BY requestedAt`,
          args: [input.accountId],
        }),
      ]);
    const requestId = newId("priv");
    const manifest = {
      version: 1,
      kind: "managed-metadata-export",
      requestId,
      accountId: input.accountId,
      exportedAt: this.#clock().toISOString(),
      beta: account,
      waitlist,
      usageEvents: usage.rows,
      reservations: reservations.rows,
      privacyOperations: operations.rows,
      notice:
        "Core academic data is exported by the account export. This archive contains managed-plane metadata only.",
    };
    const digest = this.#digest("export", JSON.stringify(manifest));
    await this.#client.execute({
      sql: `INSERT INTO privacy_operation_requests
        (id, accountId, kind, scopeKind, scopeId, state, manifestDigest,
         requestedAt, completedAt)
        VALUES (?, ?, 'export', 'account', ?, 'completed', ?, ?, ?)`,
      args: [
        requestId,
        input.accountId,
        input.accountId,
        `sha256:${digest}`,
        seconds(this.#clock()),
        seconds(this.#clock()),
      ],
    });
    await this.#audit.append({
      accountId: input.accountId,
      actorId: input.actorId,
      actorKind: "user",
      action: "managed-beta.metadata-exported",
      resourceKind: "privacy-operation",
      resourceId: requestId,
      correlationId: input.correlationId,
      policyVersion: "managed-privacy/1",
      metadata: { digest: `sha256:${digest}` },
    });
    return { manifest, digest: `sha256:${digest}` };
  }

  async requestManagedDeletion(input: {
    accountId: string;
    actorId: string;
    correlationId: string;
  }) {
    const transaction = await this.#client.transaction("write");
    try {
      const account = await transaction.execute({
        sql: "SELECT region FROM managed_beta_accounts WHERE accountId = ? LIMIT 1",
        args: [input.accountId],
      });
      if (!account.rows[0]) {
        throw new ManagedBetaError(
          "not-enrolled",
          "Managed beta account not found",
        );
      }
      const requestId = newId("priv");
      const now = seconds(this.#clock());
      const placement = {
        kind: "managed",
        providerId: `managed-${String(account.rows[0].region)}`,
      };
      const manifestDigest = `sha256:${this.#digest(
        "delete",
        `${requestId}\0${input.accountId}\0${JSON.stringify(placement)}`,
      )}`;
      await transaction.execute({
        sql: `UPDATE managed_beta_accounts SET state = 'left',
          managedDataConsent = 0, consentedCategoriesJson = '[]', updatedAt = ?
          WHERE accountId = ?`,
        args: [now, input.accountId],
      });
      await transaction.execute({
        sql: `INSERT INTO account_execution_controls
          (accountId, paidExecutionDisabled, revision, updatedAt)
          VALUES (?, 1, 1, ?)
          ON CONFLICT(accountId) DO UPDATE SET paidExecutionDisabled = 1,
            revision = account_execution_controls.revision + 1,
            updatedAt = excluded.updatedAt`,
        args: [input.accountId, now],
      });
      await transaction.execute({
        sql: `INSERT INTO privacy_operation_requests
          (id, accountId, kind, scopeKind, scopeId, state, manifestDigest,
           requestedAt, tombstoneAt)
          VALUES (?, ?, 'delete-now', 'account', ?, 'running', ?, ?, ?)`,
        args: [
          requestId,
          input.accountId,
          input.accountId,
          manifestDigest,
          now,
          now,
        ],
      });
      await transaction.execute({
        sql: `INSERT INTO privacy_operation_targets
          (requestId, placementKey, placementJson, state, nonce,
           manifestDigest, objectClassesJson, attempts, safeErrorCode, updatedAt)
          VALUES (?, ?, ?, 'pending_remote_deletion', ?, ?, ?, 0,
            'MANAGED_DELETION_WORKER_REQUIRED', ?)`,
        args: [
          requestId,
          `managed:${placement.providerId}`,
          JSON.stringify(placement),
          `delete_${randomBytes(24).toString("base64url")}`,
          manifestDigest,
          JSON.stringify([
            "managed-storage",
            "conversations",
            "corpus-derivatives",
            "workspace-snapshots",
          ]),
          now,
        ],
      });
      await this.#audit.append(
        {
          accountId: input.accountId,
          actorId: input.actorId,
          actorKind: "user",
          action: "managed-beta.deletion-requested",
          resourceKind: "privacy-operation",
          resourceId: requestId,
          justification: "User requested managed-plane deletion",
          correlationId: input.correlationId,
          policyVersion: "managed-privacy/1",
          metadata: {
            state: "pending_remote_deletion",
            placement: placement.providerId,
          },
        },
        transaction,
      );
      await transaction.commit();
      return {
        requestId,
        state: "running" as const,
        targetState: "pending_remote_deletion" as const,
        safeErrorCode: "MANAGED_DELETION_WORKER_REQUIRED" as const,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async listPrivacyOperations(accountId: string) {
    const requests = await this.#client.execute({
      sql: `SELECT id, kind, scopeKind, scopeId, state, manifestDigest,
        requestedAt, completedAt, safeErrorCode FROM privacy_operation_requests
        WHERE accountId = ? ORDER BY requestedAt DESC LIMIT 50`,
      args: [accountId],
    });
    const result = [];
    for (const request of requests.rows as Row[]) {
      const targets = await this.#client.execute({
        sql: `SELECT placementKey, state, attempts, safeErrorCode, updatedAt
          FROM privacy_operation_targets WHERE requestId = ? ORDER BY placementKey`,
        args: [request.id],
      });
      result.push({
        id: String(request.id),
        kind: String(request.kind),
        scope: { kind: String(request.scopeKind), id: String(request.scopeId) },
        state: String(request.state),
        manifestDigest:
          request.manifestDigest === null
            ? null
            : String(request.manifestDigest),
        requestedAt: iso(request.requestedAt),
        completedAt: iso(request.completedAt),
        safeErrorCode:
          request.safeErrorCode === null ? null : String(request.safeErrorCode),
        targets: (targets.rows as Row[]).map((target) => ({
          placementKey: String(target.placementKey),
          state: String(target.state),
          attempts: Number(target.attempts),
          safeErrorCode:
            target.safeErrorCode === null ? null : String(target.safeErrorCode),
          updatedAt: iso(target.updatedAt),
        })),
      });
    }
    return result;
  }

  async adminOverview() {
    const [invites, accounts, waitlist, quotas, evidence, gates, incidents] =
      await Promise.all([
        this.#client.execute(`SELECT * FROM managed_beta_invites
          ORDER BY createdAt DESC LIMIT 200`),
        this.#client.execute(`SELECT * FROM managed_beta_accounts
          ORDER BY activatedAt DESC LIMIT 500`),
        this.#client.execute(`SELECT accountId, preferredRegion, status,
          createdAt, updatedAt FROM managed_beta_waitlist
          ORDER BY createdAt DESC LIMIT 500`),
        this.#client.execute(`SELECT * FROM managed_quota_policies
          ORDER BY scope, scopeId, capability, period`),
        this.#client.execute(`SELECT * FROM managed_operational_evidence
          ORDER BY observedAt DESC LIMIT 250`),
        this.#client.execute(`SELECT * FROM managed_launch_gates
          ORDER BY phase, key`),
        this.#client.execute(`SELECT * FROM managed_incidents
          ORDER BY startedAt DESC LIMIT 100`),
      ]);
    return {
      invites: (invites.rows as Row[]).map(invitationView),
      accounts: (accounts.rows as Row[]).map(accountView),
      waitlist: waitlist.rows,
      quotas: quotas.rows,
      evidence: (evidence.rows as Row[]).map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        environment: String(row.environment),
        region: row.region === null ? null : String(row.region),
        provider: row.provider === null ? null : String(row.provider),
        releaseRevision: String(row.releaseRevision),
        status: String(row.status),
        source: String(row.source),
        safeSummary: String(row.safeSummary),
        metrics: parseJson<Record<string, string | number | boolean | null>>(
          row.metricsJson,
          {},
        ),
        artifactDigest:
          row.artifactDigest === null ? null : String(row.artifactDigest),
        reference: row.reference === null ? null : String(row.reference),
        observedAt: iso(row.observedAt),
        expiresAt: iso(row.expiresAt),
        createdAt: iso(row.createdAt),
      })),
      gates: gates.rows,
      incidents: (incidents.rows as Row[]).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        safeSummary: String(row.safeSummary),
        severity: String(row.severity),
        status: String(row.status),
        affectedCapabilities: parseJson<ManagedCapability[]>(
          row.affectedCapabilitiesJson,
          [],
        ),
        provider: row.provider === null ? null : String(row.provider),
        publiclyVisible: Number(row.publiclyVisible) === 1,
        startedAt: iso(row.startedAt),
        resolvedAt: iso(row.resolvedAt),
        updatedAt: iso(row.updatedAt),
      })),
    };
  }
}

export async function managedBetaAccountForDispatch(
  target: EntitlementSqlTarget,
  accountId: string,
) {
  const rows = await target.execute({
    sql: `SELECT cohort, region, state, managedDataConsent, capabilitiesJson
      FROM managed_beta_accounts WHERE accountId = ? LIMIT 1`,
    args: [accountId],
  });
  const row = rows.rows[0] as Row | undefined;
  return row
    ? {
        cohort: String(row.cohort),
        region: String(row.region),
        state: String(row.state),
        managedDataConsent: Number(row.managedDataConsent) === 1,
        capabilities: parseJson<ManagedCapability[]>(row.capabilitiesJson, []),
      }
    : null;
}
