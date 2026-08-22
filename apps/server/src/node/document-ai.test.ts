import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";

const ownerId = "owner-document-ai";
const nodeId = "node_document_ai";
const imageDigest = `sha256:${"d".repeat(64)}` as const;
const configRevision = `sha256:${"c".repeat(64)}` as const;
const noEgressDigest = `sha256:${createHash("sha256")
  .update('{"mode":"none"}')
  .digest("hex")}` as const;

function sha256(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

async function streamBytes(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function selection(kind: "ocr" | "transcription") {
  return {
    selected: true as const,
    nodeId,
    configRevision,
    profile: {
      kind:
        kind === "ocr"
          ? ("artifact.local-ocr@1" as const)
          : ("artifact.local-transcription@1" as const),
      sandboxProfileId:
        kind === "ocr" ? ("ocr" as const) : ("speech-to-text" as const),
      profileVersion:
        kind === "ocr" ? "tesseract-5.5.1-fra-eng" : "whisper-profile-2026-08",
      imageDigest,
      egressPolicyDigest: noEgressDigest,
    },
    modelId:
      kind === "ocr" ? "tesseract-ocr" : "selfhost/whisper-large-v3-turbo-q5_0",
    modelRevision:
      kind === "ocr"
        ? "tesseract-5.5.1-fra-eng"
        : "whisper-large-v3-turbo-q5_0-2026-08",
  };
}

function harness(input: {
  kind: "ocr" | "transcription";
  failReadOnce?: boolean;
  failRequestPut?: boolean;
  deleteOnRemove?: boolean;
  staleSource?: boolean;
  failedGenerationOne?: boolean;
}) {
  const objects = new Map<string, Uint8Array>();
  const dispatches: Array<Record<string, unknown>> = [];
  const removals: unknown[] = [];
  const directDeletions: unknown[] = [];
  const completed = new Map<
    string,
    { terminal: { stage: "completed" }; resultManifest: unknown[] }
  >();
  let failRead = input.failReadOnce ?? false;
  const key = (ref: { ownerId: string; namespace: string; key: string }) =>
    `${ref.ownerId}\0${ref.namespace}\0${ref.key}`;
  const createStorage = async () => ({
    id: `node:${nodeId}:test`,
    put: async (put: {
      ref: { ownerId: string; namespace: string; key: string };
      body: ReadableStream<Uint8Array>;
      byteSize: number;
      mimeType: string;
      expectedDigest: `sha256:${string}`;
    }) => {
      if (input.failRequestPut && put.ref.key.includes("/request-")) {
        throw new Error("REQUEST_PUT_FAILED");
      }
      const bytes = await streamBytes(put.body);
      expect(bytes.byteLength).toBe(put.byteSize);
      expect(sha256(bytes)).toBe(put.expectedDigest);
      const replayed = objects.has(key(put.ref));
      objects.set(key(put.ref), bytes);
      return {
        ref: put.ref,
        byteSize: bytes.byteLength,
        mimeType: put.mimeType,
        digest: put.expectedDigest,
        etag: put.expectedDigest,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        replayed,
      };
    },
    delete: async (value: {
      ref: { ownerId: string; namespace: string; key: string };
    }) => {
      directDeletions.push(value);
      const deleted = objects.delete(key(value.ref));
      return { ref: value.ref, deleted, alreadyAbsent: !deleted };
    },
  });
  const dispatch = async (job: {
    ownerId: string;
    nodeId?: string;
    jobId: string;
    kind: string;
    inputRefs: Array<{
      object: { ownerId: string; namespace: string; key: string };
    }>;
    resourceRefs?: Array<{ ownerId: string; namespace: string; key: string }>;
    idempotencyKey: string;
    limits: { inputBytes: number };
  }) => {
    dispatches.push(job as unknown as Record<string, unknown>);
    expect(job.nodeId).toBe(nodeId);
    expect(job.resourceRefs).toHaveLength(2);
    expect(job.resourceRefs?.every((ref) => ref.ownerId === ownerId)).toBe(
      true,
    );
    if (
      input.failedGenerationOne &&
      job.idempotencyKey.endsWith(":generation:1")
    ) {
      return {
        terminal: {
          stage: "failed" as const,
          safeErrorCode: "TRANSIENT_LOCAL_WORKER_FAILURE",
        },
        resultManifest: [],
      };
    }
    const replay = completed.get(job.jobId);
    if (replay) return replay;
    const requestBytes = objects.get(key(job.inputRefs[0]!.object));
    if (!requestBytes) throw new Error("test request missing");
    const request = JSON.parse(new TextDecoder().decode(requestBytes)) as {
      manifest: {
        source: { digest: string };
        modelId: string;
        modelRevision: string;
      };
    };
    const result =
      input.kind === "ocr"
        ? {
            schemaVersion: 1,
            worker: "local-ocr.v1",
            sourceDigest: input.staleSource
              ? `sha256:${"0".repeat(64)}`
              : request.manifest.source.digest,
            modelId: request.manifest.modelId,
            modelRevision: request.manifest.modelRevision,
            engine: "tesseract+poppler",
            networkAccess: false,
            pageCount: 1,
            pages: [
              {
                providerIndex: 0,
                markdown: "Cours OCR local",
                width: 1000,
                height: 1400,
              },
            ],
          }
        : {
            schemaVersion: 1,
            worker: "local-transcription.v1",
            sourceDigest: input.staleSource
              ? `sha256:${"0".repeat(64)}`
              : request.manifest.source.digest,
            modelId: request.manifest.modelId,
            modelRevision: request.manifest.modelRevision,
            engine: "whisper.cpp",
            networkAccess: false,
            text: "Bonjour la classe",
            language: "fr",
            durationMs: 12_000,
            segments: [
              { startMs: 0, endMs: 5_000, text: "Bonjour" },
              { startMs: 5_000, endMs: 12_000, text: "la classe" },
            ],
          };
    const bytes = new TextEncoder().encode(JSON.stringify(result));
    const artifact = {
      object: {
        ownerId,
        namespace: "sandbox-outputs",
        key: `document-ai/${job.jobId}/result.json`,
      },
      digest: sha256(bytes),
      byteSize: bytes.byteLength,
      mimeType: "application/json",
    };
    objects.set(key(artifact.object), bytes);
    const terminal = {
      terminal: { stage: "completed" as const },
      resultManifest: [artifact],
    };
    completed.set(job.jobId, terminal as never);
    return terminal;
  };
  const read = async (readInput: {
    ownerId: string;
    artifact: {
      object: { ownerId: string; namespace: string; key: string };
    };
  }) => {
    expect(readInput.ownerId).toBe(ownerId);
    expect(readInput.artifact.object.ownerId).toBe(ownerId);
    if (failRead) {
      failRead = false;
      throw new Error("NODE_ARTIFACT_SOURCE_OFFLINE");
    }
    const bytes = objects.get(key(readInput.artifact.object));
    if (!bytes) throw new Error("test result missing");
    return { bytes, metadata: {} };
  };
  return {
    dispatches,
    removals,
    directDeletions,
    objectCount: () => objects.size,
    dependencies: {
      select: async () => selection(input.kind),
      createStorage,
      dispatch,
      read,
      remove: async (value: unknown) => {
        removals.push(value);
        if (input.deleteOnRemove) {
          const artifacts =
            (
              value as {
                artifacts?: Array<{ object: Parameters<typeof key>[0] }>;
              }
            ).artifacts ?? [];
          for (const artifact of artifacts)
            objects.delete(key(artifact.object));
        }
        return [];
      },
      now: () => new Date("2026-08-22T12:00:00.000Z"),
    },
  };
}

describe("owner-bound Node document AI object lane", () => {
  test("routes audio larger than the inline relay limit and preserves timestamps", async () => {
    const { runPairedNodeTranscription } = await import("./document-ai");
    const fixture = harness({ kind: "transcription" });
    const bytes = new Uint8Array(256 * 1024);
    bytes.fill(7);
    const result = await runPairedNodeTranscription(
      ownerId,
      {
        blob: new Blob([bytes], { type: "audio/mpeg" }),
        mimeType: "audio/mpeg",
        operationId: "recording-segment-a",
        maximumSeconds: 60,
      },
      { dependencies: fixture.dependencies as never },
    );
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 5_000, text: "Bonjour" },
      { startMs: 5_000, endMs: 12_000, text: "la classe" },
    ]);
    expect(
      (fixture.dispatches[0]?.limits as { inputBytes: number }).inputBytes,
    ).toBeGreaterThan(128 * 1024);
    expect(fixture.removals).toHaveLength(1);
  });

  test("binds idempotency to source, model, language and limits", async () => {
    const { runPairedNodeTranscription } = await import("./document-ai");
    const fixture = harness({ kind: "transcription" });
    for (const value of ["first", "second"]) {
      await runPairedNodeTranscription(
        ownerId,
        {
          blob: new Blob([value], { type: "audio/mpeg" }),
          mimeType: "audio/mpeg",
          operationId: "same-logical-operation",
          maximumSeconds: 60,
        },
        { dependencies: fixture.dependencies as never },
      );
    }
    expect(fixture.dispatches).toHaveLength(2);
    expect(fixture.dispatches[0]?.jobId).not.toBe(fixture.dispatches[1]?.jobId);
    expect(fixture.dispatches[0]?.idempotencyKey).not.toBe(
      fixture.dispatches[1]?.idempotencyKey,
    );
  });

  test("keeps artifacts after a transient read failure so an exact retry can replay", async () => {
    const { runPairedNodeTranscription } = await import("./document-ai");
    const fixture = harness({ kind: "transcription", failReadOnce: true });
    const request = {
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
      operationId: "retryable-read",
      maximumSeconds: 60,
    };
    await expect(
      runPairedNodeTranscription(ownerId, request, {
        dependencies: fixture.dependencies as never,
      }),
    ).rejects.toThrow("NODE_ARTIFACT_SOURCE_OFFLINE");
    expect(fixture.removals).toHaveLength(0);
    const replay = await runPairedNodeTranscription(
      ownerId,
      {
        ...request,
        attempt: 2,
      },
      {
        dependencies: fixture.dependencies as never,
      },
    );
    expect(replay.text).toBe("Bonjour la classe");
    expect(fixture.dispatches[0]?.jobId).toBe(fixture.dispatches[1]?.jobId);
    expect(fixture.removals).toHaveLength(1);
  });

  test("replays completed generations and advances only after terminal failure", async () => {
    const { runPairedNodeTranscription } = await import("./document-ai");
    const fixture = harness({
      kind: "transcription",
      failedGenerationOne: true,
    });
    const request = {
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
      operationId: "node-terminal-retry",
      maximumSeconds: 60,
    };
    await expect(
      runPairedNodeTranscription(
        ownerId,
        { ...request, attempt: 1 },
        {
          dependencies: fixture.dependencies as never,
        },
      ),
    ).rejects.toThrow("NODE_DOCUMENT_AI_GENERATION_EXHAUSTED");
    const result = await runPairedNodeTranscription(
      ownerId,
      { ...request, attempt: 2 },
      { dependencies: fixture.dependencies as never },
    );
    expect(result.text).toBe("Bonjour la classe");
    expect(fixture.dispatches).toHaveLength(3);
    expect(fixture.dispatches[0]?.jobId).toBe(fixture.dispatches[1]?.jobId);
    expect(fixture.dispatches[2]?.jobId).not.toBe(fixture.dispatches[1]?.jobId);
    expect(fixture.dispatches[0]?.idempotencyKey).toBe(
      fixture.dispatches[1]?.idempotencyKey,
    );
    expect(fixture.dispatches[2]?.idempotencyKey).toContain("generation:2");
  });

  test("advances after a completed generation was cleaned before Core committed", async () => {
    const { runPairedNodeTranscription } = await import("./document-ai");
    const fixture = harness({ kind: "transcription", deleteOnRemove: true });
    const request = {
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
      operationId: "core-publication-retry",
      maximumSeconds: 60,
    };
    await runPairedNodeTranscription(ownerId, request, {
      dependencies: fixture.dependencies as never,
    });
    const replay = await runPairedNodeTranscription(
      ownerId,
      { ...request, attempt: 2 },
      { dependencies: fixture.dependencies as never },
    );
    expect(replay.text).toBe("Bonjour la classe");
    expect(fixture.dispatches).toHaveLength(3);
    expect(fixture.dispatches[0]?.jobId).toBe(fixture.dispatches[1]?.jobId);
    expect(fixture.dispatches[2]?.idempotencyKey).toContain("generation:2");
  });

  test("removes a newly-created source when request storage fails before dispatch", async () => {
    const { runPairedNodeTranscription } = await import("./document-ai");
    const fixture = harness({ kind: "transcription", failRequestPut: true });
    await expect(
      runPairedNodeTranscription(
        ownerId,
        {
          blob: new Blob(["audio"], { type: "audio/mpeg" }),
          mimeType: "audio/mpeg",
          operationId: "pre-dispatch-cleanup",
          maximumSeconds: 60,
        },
        { dependencies: fixture.dependencies as never },
      ),
    ).rejects.toThrow("REQUEST_PUT_FAILED");
    expect(fixture.dispatches).toHaveLength(0);
    expect(fixture.directDeletions).toHaveLength(1);
    expect(fixture.objectCount()).toBe(0);
  });

  test("rejects stale OCR output and preserves it for diagnosis/retry", async () => {
    const { runPairedNodeOcr } = await import("./document-ai");
    const fixture = harness({ kind: "ocr", staleSource: true });
    await expect(
      runPairedNodeOcr(
        ownerId,
        { blob: new Blob(["pdf"], { type: "application/pdf" }), name: "a.pdf" },
        {
          operationId: "ocr-stale",
          dependencies: fixture.dependencies as never,
        },
      ),
    ).rejects.toThrow("NODE_OCR_RESULT_FENCE_MISMATCH");
    expect(fixture.removals).toHaveLength(0);
  });

  test("fails closed for wrong owner, online gaps and egress-enabled profiles", async () => {
    const { requireNodeDocumentAiCapability } = await import("./document-ai");
    expect(() =>
      requireNodeDocumentAiCapability({
        ownerId,
        kind: "ocr",
        relay: null,
      }),
    ).toThrow("NODE_DOCUMENT_AI_OCR_UNAVAILABLE");
    expect(() =>
      requireNodeDocumentAiCapability({
        ownerId: "owner-other",
        kind: "transcription",
        relay: {
          nodeId,
          userId: ownerId,
          configRevision,
          features: {} as never,
        },
      }),
    ).toThrow("NODE_DOCUMENT_AI_TRANSCRIPTION_UNAVAILABLE");
  });

  test("rejects dishonest OCR/STT catalogue descriptors before dispatch", async () => {
    const { requireNodeDocumentAiCapability } = await import("./document-ai");
    const relay = (kind: "ocr" | "transcription") => {
      const selected = selection(kind);
      const ocr = kind === "ocr";
      const model = {
        id: selected.modelId,
        provider: ocr ? "tesseract+poppler" : "whisper.cpp",
        displayName: "Offline model fixture",
        modalities: [ocr ? "image" : "audio"],
        capabilities: {
          tools: false,
          reasoningSummary: false,
          cachedUsage: false,
          structuredOutput: false,
        },
        contextWindow: "unknown",
      };
      return {
        nodeId,
        userId: ownerId,
        configRevision,
        features: {
          storage: {} as never,
          sandbox: {} as never,
          models: {
            version: 1 as const,
            models: [model],
            revisions: { [selected.modelId]: selected.modelRevision },
          },
          jobs: {
            kinds: [selected.profile.kind],
            executionProfiles: [selected.profile],
          } as never,
        },
      };
    };

    expect(
      requireNodeDocumentAiCapability({
        ownerId,
        kind: "ocr",
        relay: relay("ocr") as never,
      }).modelRevision,
    ).toBe("tesseract-5.5.1-fra-eng");
    const dishonestOcr = relay("ocr");
    dishonestOcr.features.models.models[0]!.provider = "legacy-ocr";
    expect(() =>
      requireNodeDocumentAiCapability({
        ownerId,
        kind: "ocr",
        relay: dishonestOcr as never,
      }),
    ).toThrow("NODE_OCR_MODEL_NOT_ATTESTED");

    const dishonestStt = relay("transcription");
    dishonestStt.features.models.models[0]!.modalities = ["audio", "text"];
    expect(() =>
      requireNodeDocumentAiCapability({
        ownerId,
        kind: "transcription",
        relay: dishonestStt as never,
      }),
    ).toThrow("NODE_TRANSCRIPTION_MODEL_NOT_ATTESTED");
  });

  test("revalidates config, profile, image, egress and model at dispatch", async () => {
    const { assertNodeJobDispatchAttestation } = await import("./services");
    const selected = selection("ocr");
    const features = {
      jobs: {
        version: 1 as const,
        kinds: [selected.profile.kind],
        maxConcurrent: 1,
        executionProfiles: [selected.profile],
      },
      models: {
        version: 1 as const,
        models: [
          {
            id: selected.modelId,
            provider: "tesseract+poppler",
            displayName: "Tesseract OCR",
            modalities: ["image" as const],
            capabilities: {
              tools: false,
              reasoningSummary: false,
              cachedUsage: false,
              structuredOutput: false,
            },
            contextWindow: "unknown" as const,
          },
        ],
        revisions: { [selected.modelId]: selected.modelRevision },
      },
    };
    const expected = {
      state: { configRevision, features },
      kind: "artifact.local-ocr",
      capabilityVersion: 1,
      expectedConfigRevision: configRevision,
      expectedExecutionProfile: selected.profile,
      expectedModel: {
        id: selected.modelId,
        provider: "tesseract+poppler",
        modality: "image" as const,
        revision: selected.modelRevision,
      },
    };
    expect(() => assertNodeJobDispatchAttestation(expected)).not.toThrow();
    expect(() =>
      assertNodeJobDispatchAttestation({
        ...expected,
        state: {
          ...expected.state,
          configRevision: `sha256:${"0".repeat(64)}`,
        },
      }),
    ).toThrow("NODE_JOB_ATTESTATION_CONFIG_DRIFT");
    expect(() =>
      assertNodeJobDispatchAttestation({
        ...expected,
        state: {
          ...expected.state,
          features: {
            ...features,
            jobs: {
              ...features.jobs,
              executionProfiles: [
                {
                  ...selected.profile,
                  imageDigest: `sha256:${"0".repeat(64)}`,
                },
              ],
            },
          },
        },
      }),
    ).toThrow("NODE_JOB_ATTESTATION_PROFILE_DRIFT");
    expect(() =>
      assertNodeJobDispatchAttestation({
        ...expected,
        state: {
          ...expected.state,
          features: {
            ...features,
            models: {
              ...features.models,
              revisions: { [selected.modelId]: "changed-revision" },
            },
          },
        },
      }),
    ).toThrow("NODE_JOB_ATTESTATION_MODEL_DRIFT");
  });
});
