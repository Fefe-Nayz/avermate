import { createClient, type Client } from "@libsql/client";
import { readFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const paths = new WeakMap<Client, string>();
const deferredCleanup = new Set<string>();
process.once("exit", () => {
  for (const path of deferredCleanup) {
    try {
      rmSync(path, { force: true });
    } catch {
      // OS temporary storage is the final fallback after process teardown.
    }
  }
});

/** Minimal isolated database for Plan 034 contract/property tests. */
export async function createManagedTestDatabase(
  userIds: readonly string[] = ["account-a", "account-b"],
): Promise<Client> {
  // libsql transactions may use another connection, so a plain `:memory:` DB
  // would lose its schema at the transaction boundary.
  const path = join(tmpdir(), `avermate-managed-${randomUUID()}.db`);
  const client = createClient({ url: `file:${path}` });
  paths.set(client, path);
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("CREATE TABLE users (id text PRIMARY KEY NOT NULL)");
  await client.execute(`CREATE TABLE user_service_keys (
    id text PRIMARY KEY NOT NULL,
    kind text NOT NULL,
    sealedKey text NOT NULL,
    hint text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    createdAt integer NOT NULL,
    updatedAt integer NOT NULL
  )`);
  const migration = await readFile(
    `${import.meta.dir}/../../drizzle/0060_wild_thanos.sql`,
    "utf8",
  );
  await client.executeMultiple(
    migration.replaceAll("--> statement-breakpoint", ""),
  );
  // Plan 039 tables are appended here until the repository-wide combined
  // Drizzle migration is generated. Tests must exercise the real SQL service,
  // not a mocked control plane.
  await client.executeMultiple(`
    CREATE TABLE managed_beta_invites (
      id text PRIMARY KEY NOT NULL,
      tokenDigest text NOT NULL UNIQUE,
      emailDigest text,
      cohort text NOT NULL,
      region text NOT NULL,
      capabilitiesJson text NOT NULL,
      termsRevision text NOT NULL,
      privacyRevision text NOT NULL,
      status text DEFAULT 'issued' NOT NULL,
      expiresAt integer NOT NULL,
      createdByUserId text NOT NULL REFERENCES users(id),
      redeemedByAccountId text REFERENCES users(id) ON DELETE SET NULL,
      redeemedAt integer,
      createdAt integer NOT NULL
    );
    CREATE TABLE managed_beta_waitlist (
      id text PRIMARY KEY NOT NULL,
      accountId text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      preferredRegion text NOT NULL,
      status text DEFAULT 'waiting' NOT NULL,
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL
    );
    CREATE TABLE managed_beta_accounts (
      accountId text PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      inviteId text REFERENCES managed_beta_invites(id) ON DELETE SET NULL,
      cohort text NOT NULL,
      region text NOT NULL,
      state text DEFAULT 'active' NOT NULL,
      acceptedTermsRevision text NOT NULL,
      acceptedPrivacyRevision text NOT NULL,
      managedDataConsent integer DEFAULT 0 NOT NULL,
      consentedCategoriesJson text NOT NULL,
      capabilitiesJson text NOT NULL,
      policyRevision text NOT NULL,
      activatedAt integer NOT NULL,
      updatedAt integer NOT NULL
    );
    CREATE TABLE managed_quota_policies (
      id text PRIMARY KEY NOT NULL,
      scope text NOT NULL,
      scopeId text NOT NULL,
      capability text DEFAULT '*' NOT NULL,
      period text NOT NULL,
      hardLimit text NOT NULL,
      concurrency integer NOT NULL,
      enabled integer DEFAULT 1 NOT NULL,
      revision text NOT NULL,
      justification text NOT NULL,
      updatedByUserId text NOT NULL REFERENCES users(id),
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL,
      UNIQUE(scope, scopeId, capability, period)
    );
    CREATE TABLE managed_operational_evidence (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      environment text NOT NULL,
      region text,
      provider text,
      releaseRevision text NOT NULL,
      status text NOT NULL,
      source text NOT NULL,
      safeSummary text NOT NULL,
      metricsJson text NOT NULL,
      artifactDigest text,
      reference text,
      observedAt integer NOT NULL,
      expiresAt integer,
      createdByUserId text NOT NULL REFERENCES users(id),
      createdAt integer NOT NULL
    );
    CREATE TABLE managed_incidents (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL,
      safeSummary text NOT NULL,
      severity text NOT NULL,
      status text NOT NULL,
      affectedCapabilitiesJson text NOT NULL,
      provider text,
      publiclyVisible integer DEFAULT 0 NOT NULL,
      startedAt integer NOT NULL,
      resolvedAt integer,
      updatedByUserId text NOT NULL REFERENCES users(id),
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL
    );
    CREATE TABLE managed_launch_gates (
      key text PRIMARY KEY NOT NULL,
      phase text NOT NULL,
      status text NOT NULL,
      evidenceId text REFERENCES managed_operational_evidence(id) ON DELETE SET NULL,
      justification text NOT NULL,
      updatedByUserId text NOT NULL REFERENCES users(id),
      updatedAt integer NOT NULL
    );
    CREATE TABLE managed_billing_price_mappings (
      provider text NOT NULL,
      externalPriceRef text NOT NULL,
      planRevision text NOT NULL,
      currency text NOT NULL,
      entitlementTemplateJson text NOT NULL,
      active integer DEFAULT 0 NOT NULL,
      createdByUserId text NOT NULL REFERENCES users(id),
      createdAt integer NOT NULL,
      PRIMARY KEY(provider, externalPriceRef),
      UNIQUE(provider, planRevision)
    );
  `);
  for (const id of userIds) {
    await client.execute({
      sql: "INSERT INTO users (id) VALUES (?)",
      args: [id],
    });
  }
  return client;
}

export async function closeManagedTestDatabase(client: Client) {
  const path = paths.get(client);
  client.close();
  if (!path) return;
  // The native libsql worker releases Windows file handles asynchronously;
  // attempting immediate removal can block the test runner for many seconds.
  if (process.platform === "win32") {
    deferredCleanup.add(path);
    return;
  }
  try {
    await rm(path, { force: true });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "EBUSY"
    ) {
      throw error;
    }
    deferredCleanup.add(path);
  }
}
