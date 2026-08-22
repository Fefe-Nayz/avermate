import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";
import {
  IncompatibleGraphSchemaError,
  SqliteLangGraphCheckpointer,
} from "./langgraph-sqlite-checkpointer";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "avermate-lg-checkpoint-"));
  temporaryDirectories.push(directory);
  return join(directory, "checkpoints.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const metadata: CheckpointMetadata = {
  source: "loop",
  step: 1,
  parents: {},
};

const checkpoint: Checkpoint = {
  v: 4,
  id: "checkpoint-0001",
  ts: "2026-08-22T00:00:00.000Z",
  channel_values: { question: "What is a derivative?" },
  channel_versions: { question: 1 },
  versions_seen: { read_tool: { question: 1 } },
};

describe("SqliteLangGraphCheckpointer", () => {
  test("persists checkpoints and pending writes across close and reopen", async () => {
    const path = databasePath();
    const first = new SqliteLangGraphCheckpointer(path, {
      graphSchemaVersion: "spike-v1",
    });
    const storedConfig = await first.put(
      {
        configurable: {
          thread_id: "thread-1",
          graph_schema_version: "spike-v1",
        },
      },
      checkpoint,
      metadata,
      {},
    );
    await first.putWrites(
      storedConfig,
      [
        ["read_result", { content: "A rate of change" }],
        ["__interrupt__", { approved: false }],
      ],
      "task-1",
    );
    first.close();

    const reopened = new SqliteLangGraphCheckpointer(path, {
      graphSchemaVersion: "spike-v1",
    });
    const tuple = await reopened.getTuple({
      configurable: { thread_id: "thread-1" },
    });
    expect(tuple?.checkpoint).toEqual(checkpoint);
    expect(tuple?.metadata).toEqual(metadata);
    expect(tuple?.pendingWrites).toEqual([
      ["task-1", "__interrupt__", { approved: false }],
      ["task-1", "read_result", { content: "A rate of change" }],
    ]);
    reopened.close();
  });

  test("clones an exact checkpoint without copying pending execution writes", async () => {
    const saver = new SqliteLangGraphCheckpointer(databasePath(), {
      graphSchemaVersion: "spike-v1",
    });
    const sourceConfig = await saver.put(
      { configurable: { thread_id: "source-thread" } },
      checkpoint,
      metadata,
      {},
    );
    await saver.putWrites(
      sourceConfig,
      [["__interrupt__", { stale: true }]],
      "source-task",
    );

    const forkConfig = await saver.forkCheckpoint(
      sourceConfig,
      "target-thread",
    );
    const fork = await saver.getTuple(forkConfig);
    expect(fork?.checkpoint).toEqual(checkpoint);
    expect(fork?.metadata?.source).toBe("fork");
    expect(fork?.pendingWrites).toEqual([]);
    expect(fork?.parentConfig).toBeUndefined();
    saver.close();
  });

  test("fails closed when the stored graph schema is incompatible", async () => {
    const path = databasePath();
    const first = new SqliteLangGraphCheckpointer(path, {
      graphSchemaVersion: "spike-v1",
    });
    await first.put(
      { configurable: { thread_id: "thread-1" } },
      checkpoint,
      metadata,
      {},
    );
    first.close();

    const incompatible = new SqliteLangGraphCheckpointer(path, {
      graphSchemaVersion: "spike-v2",
    });
    await expect(
      incompatible.getTuple({ configurable: { thread_id: "thread-1" } }),
    ).rejects.toBeInstanceOf(IncompatibleGraphSchemaError);
    incompatible.close();
  });
});
