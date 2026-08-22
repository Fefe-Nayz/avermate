import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProductionRunControlStore,
  RunControlError,
} from "./run-control-store";

const clients: Client[] = [];
const testDirectory = mkdtempSync(join(tmpdir(), "avermate-runtime-control-"));
const hash = (character: string) => character.repeat(64);

async function fixture() {
  const client = createClient({
    url: `file:${join(testDirectory, `${crypto.randomUUID()}.db`)}`,
  });
  clients.push(client);
  await client.batch(
    [
      `CREATE TABLE assistant_runs (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, threadId TEXT NOT NULL,
        branchId TEXT NOT NULL, inputMessageId TEXT NOT NULL,
        reservedOutputMessageId TEXT NOT NULL, parentRunId TEXT,
        runtimeId TEXT NOT NULL, runtimeVersion TEXT NOT NULL,
        runtimeProtocolVersion INTEGER NOT NULL DEFAULT 1,
        graphSchemaVersion INTEGER NOT NULL DEFAULT 1,
        modelKey TEXT NOT NULL, modelRevision TEXT NOT NULL DEFAULT 'legacy/1',
        providerKey TEXT NOT NULL, providerRevision TEXT NOT NULL DEFAULT 'legacy/1',
        modelPlacementJson TEXT, policyRevision TEXT,
        toolCatalogRevision TEXT, contextManifestDigest TEXT,
        branchIdentityDigest TEXT, approvalMode TEXT NOT NULL DEFAULT 'read-only',
        status TEXT NOT NULL DEFAULT 'reserved', providerDispatchState TEXT NOT NULL DEFAULT 'pending',
        providerRequestKey TEXT, cancellationRequestedAt INTEGER,
        cancellationReason TEXT, terminalReason TEXT, createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )`,
      `CREATE TABLE assistant_run_leases (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, runId TEXT NOT NULL,
        workerId TEXT NOT NULL, fencingToken INTEGER NOT NULL, state TEXT NOT NULL,
        acquiredAt INTEGER NOT NULL, heartbeatAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL, releasedAt INTEGER
      )`,
      `CREATE UNIQUE INDEX assistant_run_leases_run_token_unique
        ON assistant_run_leases(runId, fencingToken)`,
      `CREATE UNIQUE INDEX assistant_run_leases_run_active_unique
        ON assistant_run_leases(runId) WHERE state = 'active'`,
      `CREATE TABLE assistant_provider_dispatch_claims (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, runId TEXT NOT NULL,
        dispatchKey TEXT NOT NULL, requestDigest TEXT NOT NULL,
        providerKey TEXT NOT NULL, providerRevision TEXT NOT NULL,
        modelKey TEXT NOT NULL, modelRevision TEXT NOT NULL,
        placementJson TEXT NOT NULL,
        providerSupportsStableRequestKey INTEGER NOT NULL,
        stableRequestKey TEXT, state TEXT NOT NULL, inspectReason TEXT,
        claimedAt INTEGER NOT NULL, dispatchStartedAt INTEGER,
        acknowledgedAt INTEGER, completedAt INTEGER, updatedAt INTEGER NOT NULL,
        UNIQUE(userId, runId, dispatchKey)
      )`,
    ],
    "write",
  );
  await client.execute({
    sql: `INSERT INTO assistant_runs
      (id,userId,threadId,branchId,inputMessageId,reservedOutputMessageId,
       runtimeId,runtimeVersion,modelKey,providerKey,status,createdAt,updatedAt)
      VALUES ('run-1','owner-1','thread-1','branch-1','input-1','output-1',
       'avermate-readonly','1','model-1','provider-1','reserved',1,1)`,
    args: [],
  });
  let clock = new Date("2026-08-22T12:00:00.000Z");
  return {
    client,
    store: new ProductionRunControlStore(client, () => clock),
    advance(milliseconds: number) {
      clock = new Date(clock.getTime() + milliseconds);
    },
  };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

afterAll(() => {
  try {
    rmSync(testDirectory, { recursive: true, force: true });
  } catch {
    // Windows may briefly retain a SQLite handle under the OS temp root.
  }
});

describe("production run-control store", () => {
  test("fences stale workers with monotonically increasing leases", async () => {
    const { store, advance } = await fixture();
    const first = await store.acquireLease({
      ownerId: "owner-1",
      runId: "run-1",
      workerId: "worker-1",
      ttlMs: 5_000,
    });
    await expect(
      store.acquireLease({
        ownerId: "owner-1",
        runId: "run-1",
        workerId: "worker-2",
      }),
    ).rejects.toMatchObject({ code: "lease-unavailable" });
    advance(6_000);
    const second = await store.acquireLease({
      ownerId: "owner-1",
      runId: "run-1",
      workerId: "worker-2",
    });
    expect(second.fencingToken).toBe(first.fencingToken + 1);
    await expect(store.renewLease(first)).rejects.toMatchObject({
      code: "stale-fence",
    });
    await expect(store.releaseLease(first)).rejects.toMatchObject({
      code: "stale-fence",
    });
  });

  test("releases an exact elapsed lease when no newer fence superseded it", async () => {
    const { store, advance } = await fixture();
    const lease = await store.acquireLease({
      ownerId: "owner-1",
      runId: "run-1",
      workerId: "worker-1",
      ttlMs: 5_000,
    });
    advance(6_000);

    await store.releaseLease(lease);

    const successor = await store.acquireLease({
      ownerId: "owner-1",
      runId: "run-1",
      workerId: "worker-2",
    });
    expect(successor.fencingToken).toBe(lease.fencingToken + 1);
  });

  test("claims an immutable provider request before state transitions", async () => {
    const { store } = await fixture();
    const lease = await store.acquireLease({
      ownerId: "owner-1",
      runId: "run-1",
      workerId: "worker-1",
    });
    const input = {
      ownerId: "owner-1",
      runId: "run-1",
      dispatchKey: "model-round:0",
      requestDigest: hash("a"),
      providerKey: "provider-1",
      providerRevision: "provider-1/1",
      modelKey: "model-1",
      modelRevision: "model-1/1",
      placement: { kind: "core" as const, instanceId: "core-1" },
      providerSupportsStableRequestKey: false,
      stableRequestKey: null,
    };
    const claim = await store.claimProviderDispatch(input, lease);
    expect((await store.claimProviderDispatch(input, lease)).id).toBe(claim.id);
    await expect(
      store.claimProviderDispatch(
        { ...input, requestDigest: hash("b") },
        lease,
      ),
    ).rejects.toMatchObject({ code: "divergent-replay" });
    await store.transitionProviderDispatch({
      ownerId: "owner-1",
      runId: "run-1",
      dispatchKey: input.dispatchKey,
      state: "dispatching",
      fence: lease,
    });
    await store.transitionProviderDispatch({
      ownerId: "owner-1",
      runId: "run-1",
      dispatchKey: input.dispatchKey,
      state: "acknowledged",
      fence: lease,
    });
    const completed = await store.transitionProviderDispatch({
      ownerId: "owner-1",
      runId: "run-1",
      dispatchKey: input.dispatchKey,
      state: "completed",
      fence: lease,
    });
    expect(completed.state).toBe("completed");
    await expect(
      store.transitionProviderDispatch({
        ownerId: "owner-1",
        runId: "run-1",
        dispatchKey: input.dispatchKey,
        state: "dispatching",
        fence: lease,
      }),
    ).rejects.toBeInstanceOf(RunControlError);
  });

  test("replays only stable unacknowledged dispatches after lease loss", async () => {
    const { client, store, advance } = await fixture();
    await client.execute({
      sql: `INSERT INTO assistant_runs
        (id,userId,threadId,branchId,inputMessageId,reservedOutputMessageId,
         runtimeId,runtimeVersion,modelKey,providerKey,status,createdAt,updatedAt)
        VALUES ('run-2','owner-1','thread-1','branch-2','input-2','output-2',
         'avermate-readonly','1','model-1','provider-1','running',1,1)`,
      args: [],
    });
    for (const [runId, stable] of [
      ["run-1", false],
      ["run-2", true],
    ] as const) {
      const lease = await store.acquireLease({
        ownerId: "owner-1",
        runId,
        workerId: `worker-${runId}`,
        ttlMs: 5_000,
      });
      await store.claimProviderDispatch(
        {
          ownerId: "owner-1",
          runId,
          dispatchKey: "model-round:0",
          requestDigest: hash(runId === "run-1" ? "a" : "b"),
          providerKey: "provider-1",
          providerRevision: "provider-1/1",
          modelKey: "model-1",
          modelRevision: "model-1/1",
          placement: { kind: "core", instanceId: "core-1" },
          providerSupportsStableRequestKey: stable,
          stableRequestKey: stable ? `stable:${runId}` : null,
        },
        lease,
      );
      await store.transitionProviderDispatch({
        ownerId: "owner-1",
        runId,
        dispatchKey: "model-round:0",
        state: "dispatching",
        fence: lease,
      });
    }
    advance(6_000);
    const reconciled = await store.reconcileOrphans();
    expect(reconciled.inspectRequired).toEqual(["run-1"]);
    expect(reconciled.replayableDispatches).toEqual(["run-2"]);
    const claims = await client.execute(
      `SELECT runId,state FROM assistant_provider_dispatch_claims ORDER BY runId`,
    );
    expect(claims.rows.map((row) => [row.runId, row.state])).toEqual([
      ["run-1", "inspect-required"],
      ["run-2", "claimed"],
    ]);
  });
});
