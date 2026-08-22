import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeOperationResultLedger } from "./operation-ledger";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("NodeOperationResultLedger", () => {
  test("retains ordered terminal results and rejects operation-id collisions", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-operation-ledger-"));
    const path = join(directory, "operations.json");
    const ledger = new NodeOperationResultLedger({
      path,
      maximumBytes: 1024 * 1024,
    });
    const digest = `sha256:${"a".repeat(64)}`;
    await ledger.offer({
      operationId: "operation-1",
      requestDigest: digest,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await ledger.append("operation-1", {
      sequence: 1,
      ok: true,
      payload: { delta: "hello" },
      retryable: false,
      terminal: false,
    });
    await ledger.append("operation-1", {
      sequence: 2,
      ok: true,
      retryable: false,
      terminal: true,
    });
    const reopened = new NodeOperationResultLedger({
      path,
      maximumBytes: 1024 * 1024,
    });
    expect((await reopened.get("operation-1"))?.results).toHaveLength(2);
    await expect(
      reopened.offer({
        operationId: "operation-1",
        requestDigest: `sha256:${"b".repeat(64)}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow("NODE_OPERATION_ID_REPLAY_MISMATCH");
  });

  test("turns interrupted operations into a typed reconnect outcome", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-operation-ledger-"));
    const path = join(directory, "operations.json");
    const ledger = new NodeOperationResultLedger({
      path,
      maximumBytes: 1024 * 1024,
    });
    await ledger.offer({
      operationId: "operation-running",
      requestDigest: `sha256:${"c".repeat(64)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(await ledger.recoverInterrupted()).toBe(1);
    expect((await ledger.get("operation-running"))?.results[0]).toMatchObject({
      ok: false,
      safeErrorCode: "NODE_OPERATION_RESTARTED_RESYNC_REQUIRED",
      terminal: true,
    });
  });
});
