import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";
import type { OpenConnection } from "./provider";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-provider-cas-"));
const databasePath = join(testDirectory, "cas.db").replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "provider-cas-test-secret-that-is-at-least-32-characters";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";

const { db, schema } = await import("../db");
const { open, seal } = await import("../lib/crypto");
const { persistEcoleDirecteCredentials } = await import("./ecoledirecte");
const { persistPronoteCredentials } = await import("./pronote");
const { persistSkolengoCredentials } = await import("./skolengo");

const userId = "provider-cas-user";
const yearId = "provider-cas-year";
const now = new Date("2026-08-21T12:00:00.000Z");
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

beforeAll(async () => {
  registerSharedTestDatabaseLifecycle(db.$client, {
    directories: [testDirectory],
  });
  const migrationDirectory = join(import.meta.dir, "../../drizzle");
  const migration = readdirSync(migrationDirectory)
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
    .join("\n");
  const migrated = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await db.$client.executeMultiple(migration);
  }
  await db.insert(schema.users).values({
    id: userId,
    name: "Provider CAS",
    email: "provider-cas@example.com",
    emailVerified: true,
    role: "user",
    banned: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.years).values({
    id: yearId,
    name: "2026–2027",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId,
  });
}, databaseHookTimeout);

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}, databaseHookTimeout);

describe("rotating provider credential CAS", () => {
  for (const [provider, persist] of [
    ["ecoledirecte", persistEcoleDirecteCredentials],
    ["pronote", persistPronoteCredentials],
    ["skolengo", persistSkolengoCredentials],
  ] as const) {
    test(`${provider} lets exactly one concurrent token rotation win`, async () => {
      const connectionId = `cas-${provider}`;
      const initialPlaintext = JSON.stringify({ token: "initial" });
      const initialRevision = seal(initialPlaintext);
      await db.insert(schema.syncConnections).values({
        id: connectionId,
        provider,
        label: provider,
        baseUrl: "https://school.example",
        sealedCredentials: initialRevision,
        capabilities: [],
        status: "active",
        yearId,
        userId,
      });
      const connection = (): OpenConnection => ({
        id: connectionId,
        userId,
        yearId,
        baseUrl: "https://school.example",
        credentials: initialPlaintext,
        credentialRevision: initialRevision,
        caCertPem: null,
      });
      const nextValues = [
        JSON.stringify({ token: "rotated-a" }),
        JSON.stringify({ token: "rotated-b" }),
      ];
      const results = await Promise.allSettled([
        persist(connection(), nextValues[0]!),
        persist(connection(), nextValues[1]!),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const [stored] = await db
        .select({ sealedCredentials: schema.syncConnections.sealedCredentials })
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId));
      expect(nextValues).toContain(open(stored!.sealedCredentials!));
    });
  }
});
