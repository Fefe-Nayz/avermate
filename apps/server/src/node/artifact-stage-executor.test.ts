import { describe, expect, test } from "bun:test";
import type { NodeArtifactRef } from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import type { ArtifactWorkflowStageExecutionInput } from "../ingestion/artifact-stage-executor";
import { CoreNodeArtifactWorkflowStageExecutor } from "./artifact-stage-executor";
import type { dispatchPairedNodeJob } from "./services";

type DispatchInput = Parameters<typeof dispatchPairedNodeJob>[0];

const digest = `sha256:${"a".repeat(64)}` as const;

function digestOf(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function previousRevision(bytes: Uint8Array) {
  const outputDigest = digestOf(bytes);
  return {
    id: "revision-node",
    outputDigest: outputDigest.slice("sha256:".length),
    outputMime: "text/html",
    byteSize: bytes.byteLength,
    manifestJson: {
      renderer: {
        toolVersions: {
          nodeId: "node-1",
          capabilityRevision: digest,
          jobEnvelope: digest,
          nodeObjectRef: JSON.stringify({
            ownerId: "owner-1",
            namespace: "artifacts",
            key: "jobs/output.html",
          }),
          nodeOutputDigest: outputDigest,
        },
      },
    },
  };
}

function artifact(ownerId = "owner-1"): NodeArtifactRef {
  return {
    object: { ownerId, namespace: "artifacts", key: "jobs/input.bin" },
    digest,
    byteSize: 16,
    mimeType: "application/octet-stream",
  };
}

function stage(
  overrides: Partial<ArtifactWorkflowStageExecutionInput> = {},
): ArtifactWorkflowStageExecutionInput {
  return {
    ownerId: "owner-1",
    runId: "run-1",
    artifactId: "artifact-1",
    kind: "html",
    workflowId: "artifact.interactive-module.v1",
    workflowVersion: 1,
    inputDigest: "b".repeat(64),
    sourceVersionIds: [],
    parentArtifactRevisionIds: [],
    settings: {
      nodeExecution: {
        nodeId: "node-1",
        jobKind: "specialist.opencode",
        inputRefs: [artifact()],
      },
    },
    stageId: "stage-1",
    stageKey: "generate",
    stagePosition: 0,
    stageAttempt: 1,
    stageInputDigest: "c".repeat(64),
    executionDeadline: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("Core Node artifact stage executor", () => {
  test("dispatches an exact specialist job and publishes verified Node output", async () => {
    const dispatched: unknown[] = [];
    const published: unknown[] = [];
    const executor = new CoreNodeArtifactWorkflowStageExecutor(
      {
        async execute() {
          return { rows: [], columns: [], rowsAffected: 0 };
        },
      } as never,
      {
        async publishRevision(input) {
          published.push(input);
          return { artifactRevisionId: "revision-1" } as never;
        },
      },
      (async (input: DispatchInput) => {
        dispatched.push(input);
        await input.onEvent?.({
          jobId: input.jobId,
          sequence: 1,
          eventId: "event-1",
          stage: "running",
          emittedAt: new Date().toISOString(),
          terminal: false,
          progress: {
            numerator: 1,
            denominator: 2,
            unit: "files",
            message: "Rendering",
          },
        });
        return {
          nodeId: "node-1",
          configRevision: digest,
          job: { envelopeDigest: digest },
          resultManifest: [artifact()],
        } as never;
      }) as never,
    );

    await expect(executor.execute(stage())).resolves.toBe("revision-1");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      ownerId: "owner-1",
      nodeId: "node-1",
      kind: "specialist.opencode",
      idempotencyKey: "run-1:stage-1:1",
    });
    expect(published[0]).toMatchObject({
      ownerId: "owner-1",
      artifactId: "artifact-1",
      renderer: {
        profile: "node.specialist.opencode",
        reproducibility: "best-effort",
      },
      output: { digest: "a".repeat(64), bytes: 16 },
    });
  });

  test("rejects a cross-owner input before dispatch", async () => {
    let dispatched = false;
    const executor = new CoreNodeArtifactWorkflowStageExecutor(
      {} as never,
      {} as never,
      (async () => {
        dispatched = true;
        throw new Error("should not run");
      }) as never,
    );
    const input = stage({
      settings: {
        nodeExecution: {
          jobKind: "specialist.opencode",
          inputRefs: [artifact("owner-2")],
        },
      },
    });

    await expect(executor.execute(input)).rejects.toThrow("different account");
    expect(dispatched).toBe(false);
  });

  test("adopt-output reuses only a preceding completed revision", async () => {
    const executor = new CoreNodeArtifactWorkflowStageExecutor(
      {
        async execute() {
          return {
            rows: [{ id: "revision-existing", outputFileId: "file-existing" }],
            columns: [],
            rowsAffected: 0,
          };
        },
      } as never,
      {} as never,
      (() => {
        throw new Error("should not dispatch");
      }) as never,
    );

    await expect(
      executor.execute(stage({ stageKey: "adopt-output", stagePosition: 3 })),
    ).resolves.toBe("revision-existing");
  });

  test("adopts verified Node bytes into a real Core file and immutable revision", async () => {
    const bytes = new TextEncoder().encode("<main>reviewed</main>");
    const previous = previousRevision(bytes);
    let query = 0;
    const stored: unknown[] = [];
    const published: unknown[] = [];
    const executor = new CoreNodeArtifactWorkflowStageExecutor(
      {
        async execute() {
          query += 1;
          return {
            rows: query === 1 ? [] : [previous],
            columns: [],
            rowsAffected: 0,
          };
        },
      } as never,
      {
        async publishRevision(input) {
          published.push(input);
          return {
            artifactRevisionId: "revision-adopted",
            revision: 2,
          } as never;
        },
      },
      (() => {
        throw new Error("should not dispatch a second job");
      }) as never,
      (async (
        input: Parameters<
          typeof import("./services").readPairedNodeArtifact
        >[0],
      ) => {
        expect(input).toMatchObject({
          ownerId: "owner-1",
          nodeId: "node-1",
          maxBytes: 1024,
        });
        return {
          metadata: {
            ref: input.artifact.object,
            digest: input.artifact.digest,
            byteSize: input.artifact.byteSize,
            mimeType: input.artifact.mimeType,
          },
          bytes,
        } as never;
      }) as never,
      (async (
        input: Parameters<
          typeof import("./services").adoptPairedNodeArtifact
        >[0],
      ) => {
        stored.push(input);
        expect(await input.loadBytes()).toEqual(bytes);
        return {
          fileId: "file-adopted",
          replayed: false,
          record: { state: "adopted" },
        } as never;
      }) as never,
      (async () => []) as never,
    );

    await expect(
      executor.execute(
        stage({
          stageKey: "adopt-output",
          stagePosition: 3,
          settings: { nodeAdoption: { maxBytes: 1024 } },
        }),
      ),
    ).resolves.toBe("revision-adopted");
    expect(stored).toHaveLength(1);
    expect(published[0]).toMatchObject({
      parentArtifactRevisionIds: ["revision-node"],
      renderer: {
        profile: "core.node-artifact-adoption",
        reproducibility: "full",
      },
      output: {
        fileId: "file-adopted",
        digest: previous.outputDigest,
        bytes: bytes.byteLength,
        mime: "text/html",
      },
    });
  });

  test("rejects an over-budget Node result before reading or storing bytes", async () => {
    const bytes = new Uint8Array(64);
    const previous = previousRevision(bytes);
    let query = 0;
    let read = false;
    let stored = false;
    const executor = new CoreNodeArtifactWorkflowStageExecutor(
      {
        async execute() {
          query += 1;
          return {
            rows: query === 1 ? [] : [previous],
            columns: [],
            rowsAffected: 0,
          };
        },
      } as never,
      {} as never,
      (() => {
        throw new Error("should not dispatch");
      }) as never,
      (async () => {
        read = true;
        throw new Error("should not read");
      }) as never,
      (async () => {
        stored = true;
        throw new Error("should not store");
      }) as never,
    );

    await expect(
      executor.execute(
        stage({
          stageKey: "adopt-output",
          stagePosition: 3,
          settings: { nodeAdoption: { maxBytes: 32 } },
        }),
      ),
    ).rejects.toThrow("adoption byte budget");
    expect(read).toBe(false);
    expect(stored).toBe(false);
  });
});
