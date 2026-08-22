import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type { SandboxRuntimeCheckpointRefV1 } from "@avermate/agent-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreNodeRuntimeCheckpointRepository } from "./sql-runtime-checkpoint-repository";

let client: Client;
let databaseRoot = "";
let databasePath = "";
async function removeDatabaseRoot() {
  let busy: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(databaseRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException;
      if (candidate.code !== "EBUSY") throw error;
      busy = candidate;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10 * 2 ** attempt, 100)),
      );
    }
  }
  // Bun's libSQL worker can keep the SQLite file handle alive until process
  // teardown on Windows even after Client.close(). We still bound and retry
  // that one recoverable condition; every other filesystem error remains a
  // hard test failure.
  if (process.platform === "win32" && busy?.code === "EBUSY") return;
  throw busy ?? new Error("TEST_DATABASE_CLEANUP_FAILED");
}
const capturedAt = "2026-08-22T11:59:00.000Z";
const expiresAt = "2026-08-22T12:05:00.000Z";
const workspace = {
  provider: "opensandbox" as const,
  digest: `sha256:${"a".repeat(64)}` as const,
  format: "tar.zstd/v1",
};

function checkpoint(opaqueRef = "provider-checkpoint-1") {
  return {
    version: 1,
    checkpoint: {
      provider: "opensandbox",
      opaqueRef,
      portable: false,
    },
    compatibility: {
      provider: "opensandbox",
      region: "local",
      architecture: "amd64",
      runtimeKind: "containerd",
      runtimeVersion: "2.0.0",
      imageDigest: `sha256:${"b".repeat(64)}`,
      profileId: "opencode",
      profileVersion: "profile-1",
    },
    sourceWorkspaceSnapshot: workspace,
    captureState: "captured",
    adoptedObjectRefs: [],
    capturedAt,
    expiresAt,
  } satisfies SandboxRuntimeCheckpointRefV1;
}

beforeEach(async () => {
  databaseRoot = await mkdtemp(join(tmpdir(), "avermate-runtime-checkpoint-"));
  databasePath = join(databaseRoot, "repository.db");
  client = createClient({ url: `file:${databasePath}` });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    INSERT INTO users (id) VALUES ('owner-1'), ('owner-2');
    CREATE TABLE avermate_nodes (
      id text PRIMARY KEY NOT NULL, state text NOT NULL
    );
    INSERT INTO avermate_nodes (id, state) VALUES ('node-1', 'active');
    CREATE TABLE node_account_bindings (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL,
      userId text NOT NULL, state text NOT NULL
    );
    INSERT INTO node_account_bindings (id, nodeId, userId, state)
      VALUES ('binding-1', 'node-1', 'owner-1', 'active');
    CREATE TABLE workspace_snapshots (
      id text PRIMARY KEY NOT NULL, userId text NOT NULL, state text NOT NULL,
      workspaceSnapshotRefJson text, imageDigest text NOT NULL,
      executionProfileId text NOT NULL, executionProfileVersion text NOT NULL,
      sandboxRuntimeCheckpointRefJson text
    );
    INSERT INTO workspace_snapshots
      (id, userId, state, workspaceSnapshotRefJson, imageDigest,
       executionProfileId, executionProfileVersion)
      VALUES ('workspace-1', 'owner-1', 'committed', '${JSON.stringify(workspace)}',
        'sha256:${"b".repeat(64)}', 'opencode', 'profile-1');
    CREATE TABLE node_runtime_checkpoints (
      id text PRIMARY KEY NOT NULL, userId text NOT NULL, nodeId text NOT NULL,
      workspaceSnapshotId text NOT NULL, checkpointRefJson text NOT NULL,
      provider text NOT NULL, opaqueProviderRef text NOT NULL,
      region text NOT NULL, architecture text NOT NULL, runtimeKind text NOT NULL,
      runtimeVersion text NOT NULL, imageDigest text NOT NULL,
      profileId text NOT NULL, profileVersion text NOT NULL,
      sourceWorkspaceSnapshotJson text NOT NULL, captureState text NOT NULL,
      adoptedObjectRefsJson text NOT NULL, capturedAt integer NOT NULL,
      expiresAt integer NOT NULL, deletedAt integer, safeErrorCode text,
      createdAt integer NOT NULL, updatedAt integer NOT NULL,
      UNIQUE(provider, opaqueProviderRef)
    );
  `);
});

afterEach(async () => {
  client.close();
  await removeDatabaseRoot();
}, 30_000);

describe("CoreNodeRuntimeCheckpointRepository", () => {
  test("recovers a captured checkpoint after restart, adopts it, then expires and deletes it", async () => {
    const firstProcess = new CoreNodeRuntimeCheckpointRepository(
      client,
      () => new Date("2026-08-22T12:00:00.000Z"),
    );
    await firstProcess.recordCaptured({
      id: "runtime-1",
      ownerId: "owner-1",
      nodeId: "node-1",
      workspaceSnapshotId: "workspace-1",
      checkpoint: checkpoint(),
    });

    const afterRestart = new CoreNodeRuntimeCheckpointRepository(
      client,
      () => new Date("2026-08-22T12:06:00.000Z"),
    );
    expect((await afterRestart.captured()).map((item) => item.id)).toEqual([
      "runtime-1",
    ]);
    await expect(
      afterRestart.loadOwned({ id: "runtime-1", ownerId: "owner-2" }),
    ).rejects.toThrow("OWNER_MISMATCH");
    const adopted = await afterRestart.markAdopted({
      id: "runtime-1",
      ownerId: "owner-1",
      nodeId: "node-1",
      adoptedObjectRefs: ["object:file-1"],
    });
    expect(adopted).toMatchObject({
      state: "adopted",
      checkpoint: {
        captureState: "adopted",
        adoptedObjectRefs: ["object:file-1"],
      },
    });
    expect((await afterRestart.expired()).map((item) => item.id)).toEqual([
      "runtime-1",
    ]);
    const deleted = await afterRestart.markDeleted({
      id: "runtime-1",
      ownerId: "owner-1",
      nodeId: "node-1",
    });
    expect(deleted.state).toBe("deleted");
    expect(deleted.deletedAt).toBe("2026-08-22T12:06:00.000Z");
    expect(await afterRestart.expired()).toEqual([]);
  });

  test("requires an active owner/node binding and exact committed logical workspace", async () => {
    const repository = new CoreNodeRuntimeCheckpointRepository(client);
    await expect(
      repository.recordCaptured({
        id: "runtime-wrong-owner",
        ownerId: "owner-2",
        nodeId: "node-1",
        workspaceSnapshotId: "workspace-1",
        checkpoint: checkpoint("wrong-owner"),
      }),
    ).rejects.toThrow("NODE_BINDING_NOT_ACTIVE");
    await expect(
      repository.recordCaptured({
        id: "runtime-wrong-workspace",
        ownerId: "owner-1",
        nodeId: "node-1",
        workspaceSnapshotId: "workspace-1",
        checkpoint: {
          ...checkpoint("wrong-workspace"),
          compatibility: {
            ...checkpoint().compatibility,
            imageDigest: `sha256:${"c".repeat(64)}`,
          },
        },
      }),
    ).rejects.toThrow("WORKSPACE_MISMATCH");
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) AS count FROM node_runtime_checkpoints",
        )
      ).rows[0]?.count,
    ).toBe(0);
  });
});
