import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDatabase = join(
  tmpdir(),
  `avermate-placement-migration-${process.pid}-${crypto.randomUUID()}.db`,
).replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${testDatabase}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "placement-test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.STORAGE_DRIVER = "local";

let database: typeof import("../db").db;
let migrations: typeof import("./placement-migration");

const ownerA = "placement-owner-a";
const ownerB = "placement-owner-b";
const source = { kind: "core" as const, providerId: "core-storage-v1" };
const destination = {
  kind: "core" as const,
  providerId: "core-storage-v2",
};

beforeAll(async () => {
  ({ db: database } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client, {
    files: [testDatabase],
  });
  await database.$client.executeMultiple(`
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    INSERT INTO users (id) VALUES ('${ownerA}'), ('${ownerB}');
    CREATE TABLE placement_migrations (
      id text PRIMARY KEY NOT NULL, accountId text NOT NULL,
      resourceKind text NOT NULL, resourceId text NOT NULL,
      sourcePlacementJson text NOT NULL, destinationPlacementJson text NOT NULL,
      state text NOT NULL DEFAULT 'planned', sourceDigest text,
      destinationDigest text, copiedBytes text NOT NULL DEFAULT '0',
      idempotencyKey text NOT NULL, safeErrorCode text,
      createdAt integer NOT NULL, updatedAt integer NOT NULL
    );
    CREATE UNIQUE INDEX placement_migrations_idempotency_unique
      ON placement_migrations(accountId, idempotencyKey);
    CREATE TABLE node_capability_placement_revisions (
      id text PRIMARY KEY NOT NULL, userId text NOT NULL,
      capability text NOT NULL, revision integer NOT NULL,
      placementKind text NOT NULL, nodeId text, providerId text NOT NULL,
      durableData integer NOT NULL, consequencesJson text NOT NULL,
      migrationState text NOT NULL, createdAt integer NOT NULL,
      UNIQUE(userId, capability, revision)
    );
    CREATE TABLE node_lifecycle_events (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL, userId text,
      eventType text NOT NULL, safeMetadataJson text NOT NULL,
      occurredAt integer NOT NULL
    );
    CREATE TABLE files (
      id text PRIMARY KEY NOT NULL, provider text NOT NULL,
      storageKey text NOT NULL, mimeType text NOT NULL, byteSize integer NOT NULL,
      purpose text NOT NULL, userId text NOT NULL, status text NOT NULL,
      updatedAt integer NOT NULL
    );
  `);
  migrations = await import("./placement-migration");
});

async function fixture(label: string) {
  const placementId = `placement-${label}`;
  const now = Math.floor(Date.now() / 1_000);
  await database.$client.execute({
    sql: `INSERT INTO node_capability_placement_revisions
      (id, userId, capability, revision, placementKind, nodeId, providerId,
       durableData, consequencesJson, migrationState, createdAt)
      VALUES (?, ?, 'storage', 1, 'core', NULL, ?, 1, ?, 'planned', ?)`,
    args: [
      placementId,
      ownerA,
      destination.providerId,
      JSON.stringify({ migrationRequired: true }),
      now,
    ],
  });
  return migrations.planPlacementMigration({
    ownerId: ownerA,
    capability: "storage",
    placementRevisionId: placementId,
    source,
    destination,
    idempotencyKey: `migration-${label}`,
  });
}

async function forceState(id: string, state: string) {
  await database.$client.execute({
    sql: "UPDATE placement_migrations SET state = ?, updatedAt = ? WHERE id = ?",
    args: [state, Math.floor(Date.now() / 1_000), id],
  });
}

async function placementRows() {
  const result = await database.$client.execute({
    sql: `SELECT * FROM node_capability_placement_revisions
      WHERE userId = ? AND capability = 'storage' ORDER BY revision`,
    args: [ownerA],
  });
  return result.rows;
}

describe("durable placement migration state machine", () => {
  test("replays a completed switch without duplicating the placement ledger", async () => {
    const migration = await fixture(`replay-${crypto.randomUUID()}`);

    const first = await migrations.runPlacementMigration(ownerA, migration.id);
    expect(first.state).toBe("source-retained");
    expect((await placementRows()).length).toBe(3);

    const replay = await migrations.runPlacementMigration(ownerA, migration.id);
    expect(replay.state).toBe("source-retained");
    const rows = await placementRows();
    expect(rows.length).toBe(3);
    expect(rows.at(-1)?.providerId).toBe(destination.providerId);
    expect(rows.at(-1)?.migrationState).toBe("verified");
  });

  test("recovers deterministically from ready-to-switch and switched", async () => {
    for (const state of ["ready-to-switch", "switched"] as const) {
      await database.$client.execute(
        "DELETE FROM node_capability_placement_revisions WHERE userId = ?",
        [ownerA],
      );
      const migration = await fixture(`${state}-${crypto.randomUUID()}`);
      await forceState(migration.id, state);

      const recovered = await migrations.runPlacementMigration(
        ownerA,
        migration.id,
      );
      expect(recovered.state).toBe("source-retained");
      const rows = await placementRows();
      expect(rows.length).toBe(2);
      expect(rows.at(-1)?.migrationState).toBe("verified");
    }
  });

  test("serializes concurrent switch recovery into one verified revision", async () => {
    await database.$client.execute(
      "DELETE FROM node_capability_placement_revisions WHERE userId = ?",
      [ownerA],
    );
    const migration = await fixture(`race-${crypto.randomUUID()}`);
    await forceState(migration.id, "ready-to-switch");

    const [left, right] = await Promise.all([
      migrations.runPlacementMigration(ownerA, migration.id),
      migrations.runPlacementMigration(ownerA, migration.id),
    ]);
    expect(left.state).toBe("source-retained");
    expect(right.state).toBe("source-retained");
    expect((await placementRows()).length).toBe(2);
  });

  test("never overwrites a newer user placement", async () => {
    await database.$client.execute(
      "DELETE FROM node_capability_placement_revisions WHERE userId = ?",
      [ownerA],
    );
    const migration = await fixture(`superseded-${crypto.randomUUID()}`);
    await database.$client.execute({
      sql: `INSERT INTO node_capability_placement_revisions
        (id, userId, capability, revision, placementKind, nodeId, providerId,
         durableData, consequencesJson, migrationState, createdAt)
        VALUES (?, ?, 'storage', 2, 'core', NULL, 'user-new-choice', 1, '{}',
                'verified', ?)`,
      args: [
        `new-choice-${crypto.randomUUID()}`,
        ownerA,
        Math.floor(Date.now() / 1_000),
      ],
    });

    await expect(
      migrations.runPlacementMigration(ownerA, migration.id),
    ).rejects.toThrow("PLACEMENT_MIGRATION_PLACEMENT_SUPERSEDED");
    const rows = await placementRows();
    expect(rows.at(-1)?.providerId).toBe("user-new-choice");
    const failed = await migrations.requirePlacementMigration(
      ownerA,
      migration.id,
    );
    expect(failed.state).toBe("failed");
  });

  test("fences pause and cancellation once the switch is ready", async () => {
    await database.$client.execute(
      "DELETE FROM node_capability_placement_revisions WHERE userId = ?",
      [ownerA],
    );
    const migration = await fixture(`fence-${crypto.randomUUID()}`);
    await forceState(migration.id, "ready-to-switch");

    await expect(
      migrations.pausePlacementMigration(ownerA, migration.id),
    ).rejects.toThrow("PLACEMENT_MIGRATION_NOT_PAUSABLE");
    await expect(
      migrations.cancelPlacementMigration(ownerA, migration.id),
    ).rejects.toThrow("PLACEMENT_MIGRATION_ALREADY_SWITCHED");
    expect(
      (await migrations.runPlacementMigration(ownerA, migration.id)).state,
    ).toBe("source-retained");
  });

  test("honors owner scope and a pre-aborted worker signal", async () => {
    await database.$client.execute(
      "DELETE FROM node_capability_placement_revisions WHERE userId = ?",
      [ownerA],
    );
    const migration = await fixture(`abort-${crypto.randomUUID()}`);
    await expect(
      migrations.requirePlacementMigration(ownerB, migration.id),
    ).rejects.toThrow("PLACEMENT_MIGRATION_NOT_FOUND");

    const controller = new AbortController();
    controller.abort();
    await expect(
      migrations.runPlacementMigration(ownerA, migration.id, {
        signal: controller.signal,
      }),
    ).rejects.toThrow("PLACEMENT_MIGRATION_ABORTED");
    expect(
      (await migrations.requirePlacementMigration(ownerA, migration.id)).state,
    ).toBe("planned");
  });
});
