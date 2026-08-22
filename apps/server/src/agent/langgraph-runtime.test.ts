import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { AgentRunInput } from "@avermate/agent-contracts";
import {
  LANGGRAPH_SPIKE_SCHEMA_VERSION,
  LangGraphAgentRuntime,
} from "./langgraph-runtime";
import {
  IncompatibleGraphSchemaError,
  SqliteLangGraphCheckpointer,
} from "./langgraph-sqlite-checkpointer";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "avermate-lg-runtime-"));
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    ownerId: "owner-1",
    threadId: "thread-1",
    branchId: "branch-main",
    runId: "run-1",
    graphSchemaVersion: LANGGRAPH_SPIKE_SCHEMA_VERSION,
    modelId: "deterministic-spike",
    contextManifest: {
      manifestVersion: 1,
      policy: {
        policyVersion: "policy-v1",
        approvalMode: "confirm-medium",
        grantedScopes: ["materials:read"],
        deniedScopes: ["grades:delete"],
        allowedModelOrigins: [],
      },
      blocks: [
        {
          id: "question-1",
          trust: "user-instruction",
          mediaType: "text/plain",
          content: "Explain the chain rule.",
          sourceRef: null,
          redactions: [],
        },
      ],
    },
    ...overrides,
  };
}

function graphThreadId(
  saver: SqliteLangGraphCheckpointer,
  runId: string,
): string {
  const row = saver.database
    .query("SELECT graph_thread_id FROM agent_langgraph_runs WHERE run_id = ?")
    .get(runId) as { graph_thread_id: string } | null;
  if (!row) throw new Error("Test run was not persisted");
  return row.graph_thread_id;
}

describe("LangGraphAgentRuntime", () => {
  test("checkpoints a real tool loop, interrupts, then resumes after process restart", async () => {
    const path = databasePath();
    let readExecutions = 0;
    const firstSaver = new SqliteLangGraphCheckpointer(path, {
      graphSchemaVersion: LANGGRAPH_SPIKE_SCHEMA_VERSION,
    });
    const firstRuntime = new LangGraphAgentRuntime(firstSaver, {
      onReadTool: () => {
        readExecutions += 1;
      },
    });

    const started = await firstRuntime.start(input());
    const interrupted = await started.completed;
    expect(interrupted.phase).toBe("interrupted");
    expect(interrupted.interrupt).toEqual({
      kind: "medium-risk",
      action: "record-study-review",
      question: "Explain the chain rule.",
      readResult: "Machine-readable study source for: Explain the chain rule.",
    });
    expect(started.conversationCheckpointRef).toStartWith(
      "avermate-conversation-checkpoint:v1:",
    );
    expect(readExecutions).toBe(1);
    const reference = started.conversationCheckpointRef;
    if (!reference) throw new Error("Expected an interrupted checkpoint");

    firstRuntime.close();
    firstSaver.close();

    const secondSaver = new SqliteLangGraphCheckpointer(path, {
      graphSchemaVersion: LANGGRAPH_SPIKE_SCHEMA_VERSION,
    });
    const secondRuntime = new LangGraphAgentRuntime(secondSaver, {
      onReadTool: () => {
        readExecutions += 1;
      },
    });
    const resumed = await secondRuntime.resume({
      ownerId: "owner-1",
      runId: "run-1",
      conversationCheckpointRef: reference,
      resumeValue: { approved: true },
    });
    expect((await resumed.completed).phase).toBe("finished");
    expect(
      (await secondRuntime.inspect({ ownerId: "owner-1", runId: "run-1" }))
        .phase,
    ).toBe("finished");
    expect(readExecutions).toBe(1);

    const tuple = await secondSaver.getTuple({
      configurable: { thread_id: graphThreadId(secondSaver, "run-1") },
    });
    expect(tuple?.checkpoint.channel_values.finalAnswer).toBe(
      "Approved study review: Machine-readable study source for: Explain the chain rule.",
    );
    secondRuntime.close();
    secondSaver.close();
  });

  test("forks an older checkpoint into a distinct branch without replaying the read tool", async () => {
    const saver = new SqliteLangGraphCheckpointer(databasePath(), {
      graphSchemaVersion: LANGGRAPH_SPIKE_SCHEMA_VERSION,
    });
    let readExecutions = 0;
    const runtime = new LangGraphAgentRuntime(saver, {
      onReadTool: () => {
        readExecutions += 1;
      },
    });
    const started = await runtime.start(input());
    const currentReference = started.conversationCheckpointRef;
    if (!currentReference) throw new Error("Expected the current checkpoint");

    const sourceGraphThread = graphThreadId(saver, "run-1");
    let priorCheckpointId: string | undefined;
    for await (const checkpoint of saver.list({
      configurable: { thread_id: sourceGraphThread },
    })) {
      if (checkpoint.metadata?.step === 0) {
        priorCheckpointId = checkpoint.config.configurable?.checkpoint_id;
        break;
      }
    }
    if (!priorCheckpointId)
      throw new Error("Expected a prior graph checkpoint");
    const priorReference = await runtime.createCheckpointReference(
      "owner-1",
      "run-1",
      priorCheckpointId,
    );
    expect(priorReference).not.toBe(currentReference);

    const forkReference = await runtime.fork({
      ownerId: "owner-1",
      sourceThreadId: "thread-1",
      sourceBranchId: "branch-main",
      targetBranchId: "branch-edited",
      boundary: { conversationCheckpointRef: priorReference },
      editedInput: "Explain the product rule instead.",
    });
    const forkIdentity = await runtime.resolveCheckpointReference(
      "owner-1",
      forkReference,
    );
    expect(forkIdentity.runId).not.toBe("run-1");
    expect(readExecutions).toBe(1);

    const forkState = await runtime.inspect({
      ownerId: "owner-1",
      runId: forkIdentity.runId,
    });
    expect(forkState.phase).toBe("interrupted");
    expect(forkState.interrupt).toEqual(
      expect.objectContaining({
        question: "Explain the product rule instead.",
        readResult:
          "Machine-readable study source for: Explain the product rule instead.",
      }),
    );
    expect(
      (await runtime.inspect({ ownerId: "owner-1", runId: "run-1" })).phase,
    ).toBe("interrupted");

    const forkTuple = await saver.getTuple({
      configurable: {
        thread_id: graphThreadId(saver, forkIdentity.runId),
        checkpoint_id: forkIdentity.checkpointId,
      },
    });
    expect(forkTuple?.checkpoint.channel_values.branchId).toBe("branch-edited");
    expect(forkTuple?.checkpoint.channel_values.question).toBe(
      "Explain the product rule instead.",
    );

    const completedFork = await runtime.resume({
      ownerId: "owner-1",
      runId: forkIdentity.runId,
      conversationCheckpointRef: forkReference,
      resumeValue: true,
    });
    expect((await completedFork.completed).phase).toBe("finished");
    expect(readExecutions).toBe(1);
    runtime.close();
    saver.close();
  });

  test("binds checkpoint references to owners and fails closed on schema drift", async () => {
    const saver = new SqliteLangGraphCheckpointer(databasePath(), {
      graphSchemaVersion: LANGGRAPH_SPIKE_SCHEMA_VERSION,
    });
    const runtime = new LangGraphAgentRuntime(saver);
    const started = await runtime.start(input());
    const reference = started.conversationCheckpointRef;
    if (!reference) throw new Error("Expected a checkpoint reference");

    await expect(
      runtime.resolveCheckpointReference("another-owner", reference),
    ).rejects.toThrow("does not exist");
    await expect(
      runtime.start(input({ runId: "wrong-schema", graphSchemaVersion: "v2" })),
    ).rejects.toBeInstanceOf(IncompatibleGraphSchemaError);

    saver.database
      .query(
        `UPDATE agent_langgraph_runs
         SET graph_schema_version = 'unsupported-v2'
         WHERE run_id = 'run-1'`,
      )
      .run();
    await expect(
      runtime.inspect({ ownerId: "owner-1", runId: "run-1" }),
    ).rejects.toBeInstanceOf(IncompatibleGraphSchemaError);
    runtime.close();
    saver.close();
  });

  test("cancels an interrupted run and refuses a later resume", async () => {
    const saver = new SqliteLangGraphCheckpointer(databasePath(), {
      graphSchemaVersion: LANGGRAPH_SPIKE_SCHEMA_VERSION,
    });
    const runtime = new LangGraphAgentRuntime(saver);
    const started = await runtime.start(input());
    const reference = started.conversationCheckpointRef;
    if (!reference) throw new Error("Expected a checkpoint reference");
    await runtime.cancel({
      ownerId: "owner-1",
      runId: "run-1",
      reason: "User cancelled the proposal",
    });
    expect(
      (await runtime.inspect({ ownerId: "owner-1", runId: "run-1" })).phase,
    ).toBe("cancelled");
    await expect(
      runtime.resume({
        ownerId: "owner-1",
        runId: "run-1",
        conversationCheckpointRef: reference,
        resumeValue: true,
      }),
    ).rejects.toThrow("Only the current interrupted checkpoint");
    runtime.close();
    saver.close();
  });
});
