import { afterEach, describe, expect, test } from "bun:test";
import { runConversationStoreConformance } from "@avermate/agent-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemConversationStore } from "./conversation-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FilesystemConversationStore", () => {
  test("passes the shared durable Node conversation conformance suite", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-conversations-"));
    roots.push(root);
    const store = new FilesystemConversationStore({
      path: join(root, "conversations.json"),
      maximumBytes: 10 * 1024 * 1024,
    });
    await store.initialize();
    const report = await runConversationStoreConformance({
      store,
      placement: { kind: "node", nodeId: "node-1" },
      provisionRun: async (input) => {
        await store.provisionRun(input);
      },
    });
    expect(report.passed).toContain("terminal-fencing");
    expect(report.passed).toContain("owner-isolation");
  });

  test("survives restart and deletes only the requested owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-conversations-"));
    roots.push(root);
    const path = join(root, "conversations.json");
    const first = new FilesystemConversationStore({
      path,
      maximumBytes: 10 * 1024 * 1024,
    });
    await first.provisionRun({
      ownerId: "owner-1",
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      placement: { kind: "node", nodeId: "node-1" },
    });
    const second = new FilesystemConversationStore({
      path,
      maximumBytes: 10 * 1024 * 1024,
    });
    expect(
      await second.getRun({
        ownerId: "owner-1",
        threadId: "thread-1",
        branchId: "branch-1",
        runId: "run-1",
      }),
    ).not.toBeNull();
    expect(await second.deleteOwner("owner-other")).toEqual({
      deletedRuns: 0,
      deletedEvents: 0,
    });
    expect(await second.deleteOwner("owner-1")).toEqual({
      deletedRuns: 1,
      deletedEvents: 0,
    });
  });
});
