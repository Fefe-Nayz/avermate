import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { Client, InStatement, Transaction } from "@libsql/client";
import type {
  NodeDeletionReceipt,
  NodeArtifactRef,
} from "@avermate/agent-contracts";
import { createCorpusTestDatabase } from "../search/test-helpers";
import {
  createSignedDeletionManifest,
  type RemoteDeletionRecord,
} from "./remote-deletion";
import { protocolDigest, signProtocolValue } from "./protocol-crypto";
import { CoreRemoteDeletionRepository } from "./sql-remote-deletion-repository";

let client: Client;
const databaseHookTimeout = 120_000;

function identity(keyId: string) {
  const pair = generateKeyPairSync("ed25519");
  return {
    signing: { keyId, privateKey: pair.privateKey },
    publicKeyDer: pair.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
  };
}

const core = identity("core-sql-deletion-key");
const node = identity("node-sql-deletion-key");

function artifact(
  ownerId: string,
  key: string,
  marker: string,
): NodeArtifactRef {
  return {
    object: { ownerId, namespace: "files", key },
    digest: `sha256:${marker.repeat(64)}`,
    byteSize: 42,
    mimeType: "application/pdf",
  };
}

function pendingRecord(input: {
  nodeId: string;
  userId: string;
  refs: NodeArtifactRef[];
  nonce: string;
}): RemoteDeletionRecord {
  return {
    manifest: createSignedDeletionManifest({
      ...input,
      issuer: core.signing,
      now: Date.parse("2026-08-22T08:00:00.000Z"),
    }),
    state: "pending_remote_deletion",
  };
}

function receiptFor(
  record: RemoteDeletionRecord,
  verifiedAt = "2026-08-22T08:00:01.000Z",
): NodeDeletionReceipt {
  const unsigned = {
    nodeId: record.manifest.nodeId,
    nonce: record.manifest.nonce,
    manifestDigest: record.manifest.digest,
    deletedCount: record.manifest.refs.length,
    verifiedAt,
  };
  return {
    ...unsigned,
    keyId: node.signing.keyId,
    signature: signProtocolValue(node.signing, unsigned),
  };
}

beforeAll(async () => {
  client = await createCorpusTestDatabase();
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

describe("CoreRemoteDeletionRepository", () => {
  test("commits the owned tombstone ledger atomically and replays creation idempotently", async () => {
    const record = pendingRecord({
      nodeId: "node-deletion-atomic",
      userId: "corpus-user-a",
      nonce: "delete_atomic",
      refs: [
        artifact("corpus-user-a", "atomic/a.pdf", "a"),
        artifact("corpus-user-a", "atomic/b.pdf", "b"),
      ],
    });
    const repository = new CoreRemoteDeletionRepository(client);
    await repository.createTombstone(record);

    // A process restart may retry after losing the successful response.
    const restarted = new CoreRemoteDeletionRepository(client);
    await restarted.createTombstone(record);
    expect(
      await restarted.loadByManifestDigest(record.manifest.digest),
    ).toEqual(record);
    expect(await restarted.isTombstoned(record.manifest.refs[0].object)).toBe(
      true,
    );
    expect(await restarted.loadByRef(record.manifest.refs[1].object)).toEqual(
      record,
    );
    expect(
      await restarted.isTombstoned({
        ...record.manifest.refs[0].object,
        ownerId: "corpus-user-b",
      }),
    ).toBe(false);

    const rows = await client.execute({
      sql: `SELECT
          (SELECT COUNT(*) FROM node_remote_deletions WHERE manifestDigest = ?) AS manifests,
          (SELECT COUNT(*) FROM node_remote_deletion_refs WHERE manifestDigest = ?) AS refs`,
      args: [record.manifest.digest, record.manifest.digest],
    });
    expect(Number(rows.rows[0]?.manifests)).toBe(1);
    expect(Number(rows.rows[0]?.refs)).toBe(2);

    await expect(
      restarted.createTombstone({
        ...record,
        manifest: { ...record.manifest, signature: "A".repeat(64) },
      }),
    ).rejects.toThrow("DELETION_MANIFEST_DIVERGENT_REPLAY");

    const mixedOwner = pendingRecord({
      nodeId: "node-deletion-owner",
      userId: "corpus-user-a",
      nonce: "delete_wrong_owner",
      refs: [artifact("corpus-user-b", "private/foreign.pdf", "c")],
    });
    await expect(restarted.createTombstone(mixedOwner)).rejects.toThrow(
      "DELETION_MANIFEST_OWNER_MISMATCH",
    );
    expect(
      await restarted.loadByManifestDigest(mixedOwner.manifest.digest),
    ).toBeNull();
  });

  test("rolls back a partial ref write and permits a clean crash retry", async () => {
    const record = pendingRecord({
      nodeId: "node-deletion-crash",
      userId: "corpus-user-a",
      nonce: "delete_crash",
      refs: [
        artifact("corpus-user-a", "crash/a.pdf", "d"),
        artifact("corpus-user-a", "crash/b.pdf", "e"),
      ],
    });
    const failingClient = {
      execute: client.execute.bind(client),
      async transaction(mode?: "write" | "read" | "deferred") {
        const transaction = await client.transaction(mode);
        let refWrites = 0;
        return new Proxy(transaction, {
          get(target, property) {
            if (property === "execute") {
              return async (statement: InStatement) => {
                if (
                  typeof statement !== "string" &&
                  statement.sql.includes(
                    "INSERT INTO node_remote_deletion_refs",
                  ) &&
                  ++refWrites === 2
                ) {
                  throw new Error("SIMULATED_PROCESS_FAILURE");
                }
                return target.execute(statement);
              };
            }
            const value = target[property as keyof Transaction] as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const interrupted = new CoreRemoteDeletionRepository(failingClient);
    await expect(interrupted.createTombstone(record)).rejects.toThrow(
      "SIMULATED_PROCESS_FAILURE",
    );
    const afterFailure = await client.execute({
      sql: `SELECT
          (SELECT COUNT(*) FROM node_remote_deletions WHERE manifestDigest = ?) AS manifests,
          (SELECT COUNT(*) FROM node_remote_deletion_refs WHERE manifestDigest = ?) AS refs`,
      args: [record.manifest.digest, record.manifest.digest],
    });
    expect(Number(afterFailure.rows[0]?.manifests)).toBe(0);
    expect(Number(afterFailure.rows[0]?.refs)).toBe(0);

    const restarted = new CoreRemoteDeletionRepository(client);
    await restarted.createTombstone(record);
    expect(
      await restarted.loadByManifestDigest(record.manifest.digest),
    ).toEqual(record);
  });

  test("lists only validated owner-bound deletion summaries", async () => {
    const repository = new CoreRemoteDeletionRepository(client);
    const rows = await repository.listForOwner({
      ownerId: "corpus-user-a",
      nodeId: "node-deletion-atomic",
      state: "pending_remote_deletion",
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.record).toMatchObject({
      state: "pending_remote_deletion",
      manifest: {
        userId: "corpus-user-a",
        nodeId: "node-deletion-atomic",
        refs: expect.arrayContaining([
          expect.objectContaining({
            object: expect.objectContaining({ ownerId: "corpus-user-a" }),
          }),
        ]),
      },
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
    expect(
      await repository.listForOwner({
        ownerId: "corpus-user-b",
        nodeId: "node-deletion-atomic",
      }),
    ).toEqual([]);
  });

  test("persists reconnect states and makes the first receipt terminal", async () => {
    const record = pendingRecord({
      nodeId: "node-deletion-reconnect",
      userId: "corpus-user-a",
      nonce: "delete_reconnect",
      refs: [artifact("corpus-user-a", "reconnect/copy.pdf", "f")],
    });
    const repository = new CoreRemoteDeletionRepository(client);
    await repository.createTombstone(record);
    await repository.markState(
      record.manifest.digest,
      "revoked_unreachable",
      "Reconnect the original node identity.",
    );

    const restarted = new CoreRemoteDeletionRepository(client);
    expect(
      await Array.fromAsync(
        restarted.pendingForNode("node-deletion-reconnect", 10),
      ),
    ).toEqual([
      {
        ...record,
        state: "revoked_unreachable",
        safeOperatorInstruction: "Reconnect the original node identity.",
      },
    ]);

    const receipt = receiptFor(record);
    const receiptDigest = protocolDigest(receipt);
    await restarted.markVerified(
      record.manifest.digest,
      receipt,
      receiptDigest,
    );
    // Lost acknowledgement: an exact durable replay is a no-op.
    await new CoreRemoteDeletionRepository(client).markVerified(
      record.manifest.digest,
      receipt,
      receiptDigest,
    );
    expect(
      await restarted.loadByManifestDigest(record.manifest.digest),
    ).toEqual({
      ...record,
      state: "verified_deleted",
      receipt,
      acceptedReceiptDigest: receiptDigest,
    });
    expect(
      await Array.fromAsync(
        restarted.pendingForNode("node-deletion-reconnect", 10),
      ),
    ).toEqual([]);
    expect(await restarted.isTombstoned(record.manifest.refs[0].object)).toBe(
      true,
    );

    const replacementReceipt = receiptFor(record, "2026-08-22T08:00:02.000Z");
    await expect(
      restarted.markVerified(
        record.manifest.digest,
        replacementReceipt,
        protocolDigest(replacementReceipt),
      ),
    ).rejects.toThrow("DELETION_RECEIPT_REPLAYED");
    await expect(
      restarted.markState(
        record.manifest.digest,
        "user_action_required",
        "Delete the object manually.",
      ),
    ).rejects.toThrow("DELETION_ALREADY_VERIFIED");
  });

  test("prefers a fresh command when an expired tombstone is superseded in the same second", async () => {
    const shared = artifact("corpus-user-a", "reconnect/superseded.pdf", "8");
    const expired = pendingRecord({
      nodeId: "node-deletion-superseded",
      userId: "corpus-user-a",
      nonce: "delete_superseded_old",
      refs: [shared],
    });
    const fresh = pendingRecord({
      nodeId: "node-deletion-superseded",
      userId: "corpus-user-a",
      nonce: "delete_superseded_fresh",
      refs: [shared],
    });
    const repository = new CoreRemoteDeletionRepository(
      client,
      () => new Date("2026-08-22T08:00:00.000Z"),
    );
    await repository.createTombstone(expired);
    await repository.markState(
      expired.manifest.digest,
      "user_action_required",
      "The expired command was superseded.",
    );
    await repository.createTombstone(fresh);

    expect(await repository.loadByRef(shared.object)).toEqual(fresh);
  });

  test("fails closed when a persisted tombstone ledger is incomplete", async () => {
    const record = pendingRecord({
      nodeId: "node-deletion-corrupt",
      userId: "corpus-user-a",
      nonce: "delete_corrupt",
      refs: [artifact("corpus-user-a", "corrupt/copy.pdf", "9")],
    });
    const repository = new CoreRemoteDeletionRepository(client);
    await repository.createTombstone(record);
    await client.execute({
      sql: "DELETE FROM node_remote_deletion_refs WHERE manifestDigest = ?",
      args: [record.manifest.digest],
    });
    await expect(
      repository.loadByManifestDigest(record.manifest.digest),
    ).rejects.toThrow("DELETION_TOMBSTONE_LEDGER_MISMATCH");
  });
});
