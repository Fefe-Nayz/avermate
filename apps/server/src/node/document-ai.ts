import {
  LOCAL_OCR_MODEL_ID,
  LOCAL_TRANSCRIPTION_MODEL_ID,
  localOcrWorkerManifestV1Schema,
  localOcrWorkerOutputV1Schema,
  localTranscriptionWorkerManifestV1Schema,
  localTranscriptionWorkerOutputV1Schema,
  nodeArtifactRefSchema,
  nodeArtifactWorkerRequestV1Schema,
  type NodeArtifactRef,
  type NodeCapabilityFeatures,
  type NodeJobExecutionProfile,
  type ObjectStorageProvider,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import type { MistralOcrResult } from "../lib/ocr";
import type { TranscriptionResult } from "../lib/transcription";
import { nodePlacementMigrationReady } from "./readiness";
import {
  coreNodeRegistry,
  coreNodeRelay,
  createPairedNodeObjectStorageProvider,
  deletePairedNodeArtifacts,
  dispatchPairedNodeJob,
  readPairedNodeArtifact,
} from "./services";

const MIB = 1024 ** 2;
const OCR_SOURCE_LIMIT = 50 * MIB;
const AUDIO_SOURCE_LIMIT = 32 * MIB;
const OCR_RESULT_LIMIT = 3 * MIB;
const TRANSCRIPTION_RESULT_LIMIT = 8 * MIB;

export type NodeDocumentAiKind = "ocr" | "transcription";

export type NodeDocumentAiSelection =
  | { selected: false }
  | {
      selected: true;
      nodeId: string;
      configRevision: string;
      profile: NodeJobExecutionProfile;
      modelId: string;
      modelRevision: string;
    };

type RelayState = {
  nodeId: string;
  userId: string;
  configRevision: string;
  features: NodeCapabilityFeatures;
};

function exactKind(kind: NodeDocumentAiKind) {
  return kind === "ocr"
    ? "artifact.local-ocr@1"
    : "artifact.local-transcription@1";
}

function exactAttestedModel(relay: RelayState, kind: NodeDocumentAiKind) {
  const expected =
    kind === "ocr"
      ? {
          id: LOCAL_OCR_MODEL_ID,
          provider: "tesseract+poppler",
          modality: "image" as const,
        }
      : {
          id: LOCAL_TRANSCRIPTION_MODEL_ID,
          provider: "whisper.cpp",
          modality: "audio" as const,
        };
  const candidates = relay.features.models!.models.filter(
    (candidate) => candidate.id === expected.id,
  );
  const model = candidates.length === 1 ? candidates[0] : undefined;
  const modelRevision = relay.features.models!.revisions?.[expected.id];
  if (
    !model ||
    model.provider !== expected.provider ||
    model.modalities.length !== 1 ||
    model.modalities[0] !== expected.modality ||
    model.contextWindow !== "unknown" ||
    Object.values(model.capabilities).some(Boolean) ||
    !modelRevision
  ) {
    throw new Error(
      kind === "ocr"
        ? "NODE_OCR_MODEL_NOT_ATTESTED"
        : "NODE_TRANSCRIPTION_MODEL_NOT_ATTESTED",
    );
  }
  return { modelId: model.id, modelRevision };
}

/** Pure capability check used both at selection time and by conformance tests. */
export function requireNodeDocumentAiCapability(input: {
  ownerId: string;
  kind: NodeDocumentAiKind;
  relay: RelayState | null;
}) {
  const requiredKind = exactKind(input.kind);
  const relay = input.relay;
  const profile = relay?.features.jobs?.executionProfiles?.find(
    (candidate) => candidate.kind === requiredKind,
  );
  if (
    !relay ||
    relay.userId !== input.ownerId ||
    !relay.features.storage ||
    !relay.features.models ||
    !relay.features.sandbox ||
    !relay.features.jobs?.kinds.includes(requiredKind) ||
    !profile
  ) {
    throw new Error(`NODE_DOCUMENT_AI_${input.kind.toUpperCase()}_UNAVAILABLE`);
  }
  if (profile.egressPolicyDigest !== noEgressPolicyDigest()) {
    throw new Error("NODE_DOCUMENT_AI_EGRESS_POLICY_INVALID");
  }
  if (input.kind === "ocr") {
    if (profile.sandboxProfileId !== "ocr") {
      throw new Error("NODE_DOCUMENT_AI_PROFILE_MISMATCH");
    }
    return {
      nodeId: relay.nodeId,
      configRevision: relay.configRevision,
      profile,
      ...exactAttestedModel(relay, "ocr"),
    };
  }
  if (profile.sandboxProfileId !== "speech-to-text") {
    throw new Error("NODE_DOCUMENT_AI_PROFILE_MISMATCH");
  }
  return {
    nodeId: relay.nodeId,
    configRevision: relay.configRevision,
    profile,
    ...exactAttestedModel(relay, "transcription"),
  };
}

function noEgressPolicyDigest() {
  return `sha256:${createHash("sha256")
    .update('{"mode":"none"}')
    .digest("hex")}`;
}

/** Models placement is the durable user choice for inference, including OCR/STT. */
export async function selectedNodeDocumentAi(
  ownerId: string,
  kind: NodeDocumentAiKind,
): Promise<NodeDocumentAiSelection> {
  const placement = (await coreNodeRegistry.currentPlacements(ownerId)).find(
    (candidate) => candidate.capability === "models",
  );
  if (placement?.placementKind !== "node") return { selected: false };
  if (
    !placement.nodeId ||
    !nodePlacementMigrationReady("models", placement.migrationState)
  ) {
    throw new Error("NODE_MODEL_PLACEMENT_NOT_READY");
  }
  const relay = coreNodeRelay.inspect(placement.nodeId);
  return {
    selected: true,
    ...requireNodeDocumentAiCapability({ ownerId, kind, relay }),
  };
}

type Dependencies = {
  select: typeof selectedNodeDocumentAi;
  createStorage: typeof createPairedNodeObjectStorageProvider;
  dispatch: typeof dispatchPairedNodeJob;
  read: typeof readPairedNodeArtifact;
  remove: typeof deletePairedNodeArtifacts;
  now: () => Date;
};

const defaults: Dependencies = {
  select: selectedNodeDocumentAi,
  createStorage: createPairedNodeObjectStorageProvider,
  dispatch: dispatchPairedNodeJob,
  read: readPairedNodeArtifact,
  remove: deletePairedNodeArtifacts,
  now: () => new Date(),
};

function dependencies(overrides?: Partial<Dependencies>): Dependencies {
  return { ...defaults, ...overrides };
}

function stableHash(parts: readonly string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function byteStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function putArtifact(input: {
  storage: ObjectStorageProvider;
  ownerId: string;
  operationHash: string;
  role: "source" | "request";
  bytes: Uint8Array;
  mimeType: string;
}) {
  const sha = digest(input.bytes);
  const commit = await input.storage.put({
    ref: {
      ownerId: input.ownerId,
      namespace: "sandbox-inputs",
      key: `document-ai/v1/${input.operationHash}/${input.role}-${sha.slice(7)}`,
    },
    body: byteStream(input.bytes),
    byteSize: input.bytes.byteLength,
    mimeType: input.mimeType,
    expectedDigest: sha,
    idempotencyKey: `document-ai:${input.role}:${stableHash([
      input.ownerId,
      input.operationHash,
      sha,
    ])}`,
  });
  return {
    artifact: nodeArtifactRefSchema.parse({
      object: commit.ref,
      digest: commit.digest,
      byteSize: commit.byteSize,
      mimeType: commit.mimeType,
    }),
    created: !commit.replayed,
  };
}

function exactlyOneJson(artifacts: readonly NodeArtifactRef[]) {
  const matches = artifacts.filter(
    (artifact) => artifact.mimeType === "application/json",
  );
  if (matches.length !== 1) {
    throw new Error("NODE_DOCUMENT_AI_RESULT_MANIFEST_INVALID");
  }
  return matches[0]!;
}

async function readJson(input: {
  deps: Dependencies;
  ownerId: string;
  nodeId: string;
  artifact: NodeArtifactRef;
  maxBytes: number;
  signal?: AbortSignal;
}) {
  const read = await input.deps.read({
    ownerId: input.ownerId,
    nodeId: input.nodeId,
    artifact: input.artifact,
    maxBytes: input.maxBytes,
    signal: input.signal,
  });
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(read.bytes),
  ) as unknown;
}

async function cleanup(
  deps: Dependencies,
  input: {
    ownerId: string;
    nodeId: string;
    artifacts: readonly NodeArtifactRef[];
  },
  primaryError?: unknown,
) {
  try {
    if (input.artifacts.length > 0) await deps.remove(input);
  } catch (error) {
    if (primaryError === undefined) throw error;
  }
}

async function cleanupCreatedInputs(
  storage: ObjectStorageProvider,
  artifacts: readonly NodeArtifactRef[],
) {
  await Promise.allSettled(
    artifacts.map((artifact) =>
      storage.delete({
        ref: artifact.object,
        expectedDigest: artifact.digest,
        idempotencyKey: `document-ai-pre-dispatch:${stableHash([
          artifact.object.ownerId,
          artifact.object.namespace,
          artifact.object.key,
          artifact.digest,
        ])}`,
      }),
    ),
  );
}

function validateWorkerResult(input: {
  kind: NodeDocumentAiKind;
  raw: unknown;
  source: NodeArtifactRef;
  selection: Extract<NodeDocumentAiSelection, { selected: true }>;
}) {
  const parsed =
    input.kind === "ocr"
      ? localOcrWorkerOutputV1Schema.parse(input.raw)
      : localTranscriptionWorkerOutputV1Schema.parse(input.raw);
  if (
    parsed.sourceDigest !== input.source.digest ||
    parsed.modelId !== input.selection.modelId ||
    parsed.modelRevision !== input.selection.modelRevision ||
    parsed.networkAccess !== false
  ) {
    throw new Error(
      input.kind === "ocr"
        ? "NODE_OCR_RESULT_FENCE_MISMATCH"
        : "NODE_TRANSCRIPTION_RESULT_FENCE_MISMATCH",
    );
  }
  return parsed;
}

async function execute(input: {
  ownerId: string;
  kind: NodeDocumentAiKind;
  blob: Blob;
  mimeType: string;
  operationId?: string;
  maximumSeconds?: number;
  maximumPages?: number;
  language?: string;
  /** One-based durable Core job attempt used to advance Node generations. */
  attempt?: number;
  signal?: AbortSignal;
  overrides?: Partial<Dependencies>;
}) {
  input.signal?.throwIfAborted();
  const deps = dependencies(input.overrides);
  const selection = await deps.select(input.ownerId, input.kind);
  if (!selection.selected) throw new Error("NODE_DOCUMENT_AI_NOT_SELECTED");
  const maximumSourceBytes =
    input.kind === "ocr" ? OCR_SOURCE_LIMIT : AUDIO_SOURCE_LIMIT;
  if (input.blob.size < 1 || input.blob.size > maximumSourceBytes) {
    throw new Error("NODE_DOCUMENT_AI_SOURCE_SIZE_INVALID");
  }
  const maximumSeconds = input.maximumSeconds ?? 30 * 60;
  if (
    input.kind === "transcription" &&
    (!Number.isSafeInteger(maximumSeconds) ||
      maximumSeconds < 1 ||
      maximumSeconds > 2 * 60 * 60)
  ) {
    throw new Error("NODE_TRANSCRIPTION_DURATION_LIMIT_INVALID");
  }
  const maximumPages = input.maximumPages ?? 300;
  if (
    input.kind === "ocr" &&
    (!Number.isSafeInteger(maximumPages) ||
      maximumPages < 1 ||
      maximumPages > 300)
  ) {
    throw new Error("NODE_OCR_PAGE_LIMIT_INVALID");
  }
  const attempt = input.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new Error("NODE_DOCUMENT_AI_ATTEMPT_INVALID");
  }

  const storage = await deps.createStorage({
    ownerId: input.ownerId,
    nodeId: selection.nodeId,
  });
  const sourceBytes = new Uint8Array(await input.blob.arrayBuffer());
  const sourceDigest = digest(sourceBytes);
  const logicalOperationId = input.operationId?.trim() || crypto.randomUUID();
  const operationHash = stableHash([
    logicalOperationId,
    input.ownerId,
    input.kind,
    sourceDigest,
    selection.nodeId,
    selection.configRevision,
    selection.profile.profileVersion,
    selection.profile.imageDigest,
    selection.modelId,
    selection.modelRevision,
    input.language ?? "",
    String(maximumSeconds),
    String(maximumPages),
  ]);
  const createdInputs: NodeArtifactRef[] = [];
  let preserveCompletedGeneration = false;
  try {
    const storedSource = await putArtifact({
      storage,
      ownerId: input.ownerId,
      operationHash,
      role: "source",
      bytes: sourceBytes,
      mimeType: input.mimeType,
    });
    const source = storedSource.artifact;
    if (storedSource.created) createdInputs.push(source);
    const branchId = `document-ai-${operationHash.slice(0, 48)}`;
    const manifest =
      input.kind === "ocr"
        ? localOcrWorkerManifestV1Schema.parse({
            schemaVersion: 1,
            worker: "local-ocr.v1",
            source: {
              path: "input/source",
              digest: source.digest,
              byteSize: source.byteSize,
              mimeType: source.mimeType,
            },
            language: input.language ?? "fra+eng",
            maximumPages,
            maximumPixelsPerPage: 16_777_216,
            maximumTotalPixels: 1_000_000_000,
            modelId: selection.modelId,
            modelRevision: selection.modelRevision,
          })
        : localTranscriptionWorkerManifestV1Schema.parse({
            schemaVersion: 1,
            worker: "local-transcription.v1",
            source: {
              path: "input/source",
              digest: source.digest,
              byteSize: source.byteSize,
              mimeType: source.mimeType,
            },
            modelId: selection.modelId,
            modelRevision: selection.modelRevision,
            ...(input.language ? { language: input.language } : {}),
            maximumSeconds,
            timestamps: "segment",
          });
    const request = nodeArtifactWorkerRequestV1Schema.parse({
      schemaVersion: 1,
      worker: manifest.worker,
      execution: { threadId: "document-ai", branchId },
      inputs: [{ path: "input/source", artifact: source }],
      manifest,
    });
    const requestBytes = new TextEncoder().encode(JSON.stringify(request));
    const storedRequest = await putArtifact({
      storage,
      ownerId: input.ownerId,
      operationHash,
      role: "request",
      bytes: requestBytes,
      mimeType: "application/json",
    });
    const requestArtifact = storedRequest.artifact;
    if (storedRequest.created) createdInputs.push(requestArtifact);
    const now = deps.now();
    for (let generation = 1; generation <= attempt; generation += 1) {
      const run = await deps.dispatch({
        ownerId: input.ownerId,
        nodeId: selection.nodeId,
        jobId: `nodejob_${stableHash([
          input.ownerId,
          operationHash,
          input.kind,
          `generation:${generation}`,
        ]).slice(0, 48)}`,
        kind:
          input.kind === "ocr"
            ? "artifact.local-ocr"
            : "artifact.local-transcription",
        inputRefs: [requestArtifact],
        resourceRefs: [requestArtifact.object, source.object],
        limits: {
          cpuMillis: input.kind === "ocr" ? 32_000 : 64_000,
          memoryBytes: input.kind === "ocr" ? 2 * 1024 ** 3 : 8 * 1024 ** 3,
          inputBytes: source.byteSize + requestArtifact.byteSize,
          outputBytes:
            input.kind === "ocr"
              ? OCR_RESULT_LIMIT
              : TRANSCRIPTION_RESULT_LIMIT,
          deadline: new Date(
            now.getTime() +
              (input.kind === "ocr" ? 35 * 60_000 : 2 * 60 * 60_000),
          ).toISOString(),
        },
        idempotencyKey: `document-ai:${input.kind}:${operationHash}:generation:${generation}`,
        expectedConfigRevision: selection.configRevision,
        expectedExecutionProfile: selection.profile,
        expectedModel: {
          id: selection.modelId,
          provider: input.kind === "ocr" ? "tesseract+poppler" : "whisper.cpp",
          modality: input.kind === "ocr" ? "image" : "audio",
          revision: selection.modelRevision,
        },
        signal: input.signal,
        allowTerminalFailure: generation < attempt,
      });
      if (run.terminal.stage !== "completed") continue;
      const outputs = run.resultManifest;
      try {
        const raw = validateWorkerResult({
          kind: input.kind,
          source,
          selection,
          raw: await readJson({
            deps,
            ownerId: input.ownerId,
            nodeId: selection.nodeId,
            artifact: exactlyOneJson(outputs),
            maxBytes:
              input.kind === "ocr"
                ? OCR_RESULT_LIMIT
                : TRANSCRIPTION_RESULT_LIMIT,
            signal: input.signal,
          }),
        });
        return {
          selection,
          source,
          requestArtifact,
          outputs,
          raw,
          dispose: () =>
            cleanup(
              deps,
              {
                ownerId: input.ownerId,
                nodeId: selection.nodeId,
                artifacts: [source, requestArtifact, ...outputs],
              },
              new Error("NODE_DOCUMENT_AI_RESULT_ALREADY_VALIDATED"),
            ),
        };
      } catch (error) {
        if (generation < attempt) continue;
        // Preserve a terminal result for an exact retry or operator diagnosis.
        preserveCompletedGeneration = true;
        throw error;
      }
    }
    throw new Error("NODE_DOCUMENT_AI_GENERATION_EXHAUSTED");
  } catch (error) {
    if (!preserveCompletedGeneration && createdInputs.length > 0) {
      await cleanupCreatedInputs(storage, createdInputs);
    }
    throw error;
  }
}

export async function runPairedNodeOcr(
  ownerId: string,
  file: { blob: Blob; name: string },
  options: {
    operationId?: string;
    maxPages?: number;
    language?: string;
    signal?: AbortSignal;
    attempt?: number;
    dependencies?: Partial<Dependencies>;
  } = {},
): Promise<MistralOcrResult> {
  const executed = await execute({
    ownerId,
    kind: "ocr",
    blob: file.blob,
    mimeType: file.blob.type || "application/octet-stream",
    operationId: options.operationId,
    maximumPages: options.maxPages,
    language: options.language,
    signal: options.signal,
    attempt: options.attempt,
    overrides: options.dependencies,
  });
  const result = localOcrWorkerOutputV1Schema.parse(executed.raw);
  if (
    result.sourceDigest !== executed.source.digest ||
    result.modelId !== executed.selection.modelId ||
    result.modelRevision !== executed.selection.modelRevision ||
    result.networkAccess !== false
  ) {
    throw new Error("NODE_OCR_RESULT_FENCE_MISMATCH");
  }
  const markdown = result.pages
    .map((page) => `<!-- Page ${page.providerIndex + 1} -->\n${page.markdown}`)
    .join("\n\n");
  if (new TextEncoder().encode(markdown).byteLength > 2 * MIB) {
    throw new Error("NODE_OCR_RESULT_TOO_LARGE");
  }
  const resolved = {
    markdown,
    pageCount: result.pageCount,
    providerFileId: `node:${executed.selection.nodeId}:${executed.requestArtifact.digest.slice(7, 31)}`,
    pages: result.pages.map(({ providerIndex, markdown: pageMarkdown }) => ({
      providerIndex,
      markdown: pageMarkdown,
    })),
  };
  await executed.dispose();
  return resolved;
}

export async function runPairedNodeTranscription(
  ownerId: string,
  input: {
    blob: Blob;
    mimeType: string;
    language?: string;
    operationId?: string;
    maximumSeconds?: number;
    attempt?: number;
    signal?: AbortSignal;
  },
  options: { dependencies?: Partial<Dependencies> } = {},
): Promise<TranscriptionResult> {
  const executed = await execute({
    ownerId,
    kind: "transcription",
    blob: input.blob,
    mimeType: input.mimeType,
    language: input.language,
    operationId: input.operationId,
    maximumSeconds: input.maximumSeconds,
    signal: input.signal,
    attempt: input.attempt,
    overrides: options.dependencies,
  });
  const result = localTranscriptionWorkerOutputV1Schema.parse(executed.raw);
  if (
    result.sourceDigest !== executed.source.digest ||
    result.modelId !== executed.selection.modelId ||
    result.modelRevision !== executed.selection.modelRevision ||
    result.networkAccess !== false
  ) {
    throw new Error("NODE_TRANSCRIPTION_RESULT_FENCE_MISMATCH");
  }
  const resolved = {
    text: result.text,
    language: result.language === "unknown" ? undefined : result.language,
    segments: result.segments.map((segment) => ({ ...segment })),
  };
  await executed.dispose();
  return resolved;
}

export type NodeDocumentAiDependencies = Partial<Dependencies>;
