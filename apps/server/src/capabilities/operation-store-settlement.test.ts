import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import type { CapabilityUsage } from "@avermate/agent-contracts";
import { capabilityFailure } from "./errors";
import { CapabilityOperationStore } from "./operation-store";
import { CapabilityUsageService } from "./usage-service";
import { capabilityDigest } from "./values";

const migration = readFileSync(
  join(import.meta.dir, "../../drizzle/0069_capability_control_plane.sql"),
  "utf8",
);
const ownerId = "owner-usage-settlement";
const operationId = "cop-usage-settlement";
const attemptId = "catt-usage-settlement";
const now = 1_787_904_000;

const costOnlyUsage: CapabilityUsage = {
  version: 1,
  items: [],
  cost: {
    amountMinor: "17",
    currency: "EUR",
    authoritative: true,
    pricingSnapshotId: "price-2026-08",
  },
};

const measuredUsage: CapabilityUsage = {
  version: 1,
  items: [
    { unit: "character", quantity: "42", source: "measured" },
  ],
  cost: {
    amountMinor: "19",
    currency: "EUR",
    authoritative: false,
    pricingSnapshotId: "price-2026-08",
  },
};

let client: Client;
let databasePath: string;
let store: CapabilityOperationStore;

async function seedAcknowledgedAttempt() {
  const emptyDigest = capabilityDigest({});
  const requestDigest = capabilityDigest({ text: "settlement fixture" });
  await client.execute({
    sql: `INSERT INTO capability_provider_connections (
      id, ownerKind, ownerId, pluginId, pluginVersion, displayName,
      placementKind, placementRef, placementJson, configVersion, configJson,
      configDigest, status, revision, createdAt, updatedAt
    ) VALUES (?, 'user', ?, 'fixture.plugin', '1.0.0', 'Fixture',
      'direct-byok', 'fixture', '{}', 1, '{}', ?, 'validated', 1, ?, ?)`,
    args: ["cpc-usage-fixture", ownerId, emptyDigest, now, now],
  });
  await client.execute({
    sql: `INSERT INTO capability_offerings (
      id, connectionId, capabilityKind, descriptorVersion, descriptorJson,
      descriptorDigest, provider, modelId, modelRevision, adapterRevision,
      status, discoveredAt, createdAt
    ) VALUES (?, ?, 'speech.synthesize', 1, '{}', ?, 'fixture', 'fixture-model',
      '1', '1', 'ready', ?, ?)`,
    args: [
      "coff-usage-fixture",
      "cpc-usage-fixture",
      emptyDigest,
      now,
      now,
    ],
  });
  await client.execute({
    sql: `INSERT INTO capability_operations (
      id, ownerId, capabilityKind, purpose, inputDigest, idempotencyKey,
      policySnapshotJson, policySnapshotDigest, state, revision, createdAt,
      updatedAt
    ) VALUES (?, ?, 'speech.synthesize', 'media.podcast-narration', ?,
      'usage-settlement-fixture', '{}', ?, 'acknowledged', 1, ?, ?)`,
    args: [operationId, ownerId, requestDigest, emptyDigest, now, now],
  });
  await client.execute({
    sql: `INSERT INTO capability_attempts (
      id, operationId, ordinal, offeringId, requestDigest, state, retryable,
      ambiguous, startedAt, acknowledgedAt
    ) VALUES (?, ?, 0, ?, ?, 'acknowledged', 0, 0, ?, ?)`,
    args: [
      attemptId,
      operationId,
      "coff-usage-fixture",
      requestDigest,
      now,
      now,
    ],
  });
}

beforeEach(async () => {
  databasePath = join(
    tmpdir(),
    `avermate-capability-usage-${process.pid}-${crypto.randomUUID()}.db`,
  );
  client = createClient({ url: `file:${databasePath}` });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.executeMultiple(migration);
  await seedAcknowledgedAttempt();
  store = new CapabilityOperationStore(
    client,
    () => new Date(now * 1_000),
  );
});

afterEach(() => {
  client.close();
  if (existsSync(databasePath)) {
    try {
      unlinkSync(databasePath);
    } catch {
      // Windows can retain SQLite handles briefly after close.
    }
  }
});

describe("CapabilityOperationStore usage settlement", () => {
  test("a late retryable failure cannot revive a cancelled operation or attempt", async () => {
    await store.cancel({ ownerId, operationId, expectedRevision: 1 });
    const cancelled = await store.detail(ownerId, operationId);
    await store.failAttempt({
      ownerId,
      operationId,
      attemptId,
      error: capabilityFailure("RATE_LIMITED", "Provider throttled", { retryable: true }),
      terminal: false,
    });
    expect(await store.detail(ownerId, operationId)).toEqual(cancelled);
  });

  test("rolls attempt failure back when the operation transition fails", async () => {
    await client.execute(`CREATE TRIGGER fixture_abort_operation_failure
      BEFORE UPDATE OF state ON capability_operations
      WHEN NEW.state = 'failed'
      BEGIN SELECT RAISE(ABORT, 'fixture failure crash'); END`);
    const before = await store.detail(ownerId, operationId);
    await expect(store.failAttempt({
      ownerId,
      operationId,
      attemptId,
      error: capabilityFailure("CAPABILITY_UNAVAILABLE", "Unavailable"),
      terminal: true,
    })).rejects.toThrow("fixture failure crash");
    expect(await store.detail(ownerId, operationId)).toEqual(before);
  });

  test("recordUsage is idempotent and rejects a divergent envelope", async () => {
    expect(
      await store.recordUsage({
        ownerId,
        operationId,
        attemptId,
        usage: costOnlyUsage,
      }),
    ).toEqual({ digest: capabilityDigest(costOnlyUsage), replayed: false });

    expect(
      await store.recordUsage({
        ownerId,
        operationId,
        attemptId,
        usage: costOnlyUsage,
      }),
    ).toEqual({ digest: capabilityDigest(costOnlyUsage), replayed: true });

    await expect(
      store.recordUsage({
        ownerId,
        operationId,
        attemptId,
        usage: measuredUsage,
      }),
    ).rejects.toMatchObject({ code: "DIVERGENT_REPLAY" });
    expect(
      Number(
        (
          await client.execute(
            "SELECT COUNT(*) AS count FROM capability_usage",
          )
        ).rows[0]?.count ?? 0,
      ),
    ).toBe(1);
  });

  test("keeps cost-only usage visible when items is empty", async () => {
    await store.recordUsage({
      ownerId,
      operationId,
      attemptId,
      usage: costOnlyUsage,
    });

    expect(await new CapabilityUsageService(client).summary({ ownerId })).toMatchObject({
      byUnit: [],
      costByCurrency: [
        { currency: "EUR", amountMinor: "17", authoritative: true },
      ],
      byCapability: [
        {
          capability: "speech.synthesize",
          byUnit: [],
          costByCurrency: [
            { currency: "EUR", amountMinor: "17", authoritative: true },
          ],
        },
      ],
    });
  });

  test("completes result and usage atomically and permits an identical replay", async () => {
    const result = { artifact: "audio-1" };
    await expect(
      store.complete({
        ownerId,
        operationId,
        attemptId,
        result,
        usage: measuredUsage,
      }),
    ).resolves.toMatchObject({ state: "completed", hasResult: true });

    await expect(
      store.complete({
        ownerId,
        operationId,
        attemptId,
        result,
        usage: measuredUsage,
      }),
    ).resolves.toMatchObject({ state: "completed", hasResult: true });
    expect((await store.detail(ownerId, operationId))?.usage).toHaveLength(1);

    await expect(
      store.complete({
        ownerId,
        operationId,
        attemptId,
        result: { artifact: "audio-2" },
        usage: measuredUsage,
      }),
    ).rejects.toMatchObject({ code: "DIVERGENT_REPLAY" });
    await expect(
      store.complete({
        ownerId,
        operationId,
        attemptId,
        result,
        usage: costOnlyUsage,
      }),
    ).rejects.toMatchObject({ code: "DIVERGENT_REPLAY" });
  });

  test("rolls usage and attempt state back when completion crashes", async () => {
    await client.execute(`CREATE TRIGGER fixture_abort_operation_completion
      BEFORE UPDATE OF state ON capability_operations
      WHEN NEW.state = 'completed'
      BEGIN SELECT RAISE(ABORT, 'fixture completion crash'); END`);

    await expect(
      store.complete({
        ownerId,
        operationId,
        attemptId,
        result: { artifact: "audio-1" },
        usage: measuredUsage,
      }),
    ).rejects.toThrow("fixture completion crash");

    expect(
      (
        await client.execute(
          "SELECT state FROM capability_operations WHERE id = ?",
          [operationId],
        )
      ).rows[0]?.state,
    ).toBe("acknowledged");
    expect(
      (
        await client.execute(
          "SELECT state FROM capability_attempts WHERE id = ?",
          [attemptId],
        )
      ).rows[0]?.state,
    ).toBe("acknowledged");
    expect(
      Number(
        (
          await client.execute(
            "SELECT COUNT(*) AS count FROM capability_usage",
          )
        ).rows[0]?.count ?? 0,
      ),
    ).toBe(0);
  });
});
