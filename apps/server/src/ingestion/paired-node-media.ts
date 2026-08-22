import {
  browserCaptureWorkerManifestV1Schema,
  browserRenderWorkerInputSchema,
  browserRenderWorkerOutputSchema,
  nodeArtifactRefSchema,
  nodeArtifactWorkerRequestV1Schema,
  videoAudioExtractWorkerManifestV2Schema,
  videoAudioExtractWorkerOutputV2Schema,
  videoAudioSegmentExtractWorkerInputSchema,
  videoSourceResultSchema,
  type NodeArtifactRef,
  type NodeJobExecutionProfile,
  type VideoTranscriptSegment,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { buildMarkdownDocument, extractMarkdown } from "../lib/ingest";
import {
  resolveTranscriptionProvider,
  type TranscriptionProvider,
} from "../lib/transcription";
import { parseYoutubeUrl } from "../lib/youtube";
import {
  coreNodeRelay,
  createPairedNodeObjectStorageProvider,
  deletePairedNodeArtifacts,
  dispatchPairedNodeJob,
  readPairedNodeArtifact,
} from "../node/services";
import { canonicalJson } from "../search/values";
import { AdvancedIngestionError } from "./errors";
import { PublicIngestionUrlPolicy } from "./url-policy";

const MIB = 1024 ** 2;
const JSON_LIMIT = 8 * MIB;
const AUDIO_SEGMENT_LIMIT = 32 * MIB;

type ArtifactJobKind =
  "artifact.browser-render" | "artifact.video-audio-extract";

type Dependencies = {
  resolveProfile: typeof resolveExecutionProfile;
  createStorage: typeof createPairedNodeObjectStorageProvider;
  dispatch: typeof dispatchPairedNodeJob;
  read: typeof readPairedNodeArtifact;
  remove: typeof deletePairedNodeArtifacts;
  resolveTranscription: typeof resolveTranscriptionProvider;
  urlPolicy: PublicIngestionUrlPolicy;
  now: () => Date;
};

const defaults: Dependencies = {
  resolveProfile: resolveExecutionProfile,
  createStorage: createPairedNodeObjectStorageProvider,
  dispatch: dispatchPairedNodeJob,
  read: readPairedNodeArtifact,
  remove: deletePairedNodeArtifacts,
  resolveTranscription: resolveTranscriptionProvider,
  urlPolicy: new PublicIngestionUrlPolicy({ allowHttp: false }),
  now: () => new Date(),
};

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function sha256(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function stableJobId(parts: readonly string[]) {
  return `nodejob_${createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 40)}`;
}

function stableIdempotencyKey(prefix: string, parts: readonly string[]) {
  return `${prefix}:${createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")}`;
}

async function dispatchRetryGeneration(
  dispatch: Dependencies["dispatch"],
  attemptValue: number | undefined,
  input: Omit<
    Parameters<Dependencies["dispatch"]>[0],
    "jobId" | "idempotencyKey" | "allowTerminalFailure"
  >,
  identity: readonly string[],
) {
  const attempt = attemptValue ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new Error("NODE_MEDIA_ATTEMPT_INVALID");
  }
  let run: Awaited<ReturnType<Dependencies["dispatch"]>> | null = null;
  for (let generation = 1; generation <= attempt; generation += 1) {
    const generationIdentity = [...identity, `generation:${generation}`];
    run = await dispatch({
      ...input,
      jobId: stableJobId(generationIdentity),
      idempotencyKey: stableIdempotencyKey(
        "advanced-media-job",
        generationIdentity,
      ),
      allowTerminalFailure: generation < attempt,
    });
    if (!run.terminal || run.terminal.stage === "completed") return run;
  }
  throw new Error("NODE_MEDIA_GENERATION_EXHAUSTED");
}

async function resolveExecutionProfile(input: {
  ownerId: string;
  nodeId: string;
  kind: ArtifactJobKind;
}) {
  const relay = coreNodeRelay.inspect(input.nodeId);
  const exactKind = `${input.kind}@1`;
  const profile = relay?.features.jobs?.executionProfiles?.find(
    (candidate) => candidate.kind === exactKind,
  );
  if (
    relay?.userId !== input.ownerId ||
    !relay.features.storage ||
    !relay.features.sandbox ||
    !relay.features.jobs?.kinds.includes(exactKind) ||
    !profile
  ) {
    throw new AdvancedIngestionError(
      "placement_unavailable",
      "The selected Node does not advertise the required attested artifact profile",
      false,
    );
  }
  return { nodeId: relay.nodeId, configRevision: relay.configRevision, profile };
}

async function storeRequest(input: {
  ownerId: string;
  nodeId: string;
  kind: ArtifactJobKind;
  request: unknown;
  idempotencyKey: string;
  createStorage: Dependencies["createStorage"];
}) {
  const bytes = new TextEncoder().encode(canonicalJson(input.request));
  if (bytes.byteLength < 2 || bytes.byteLength > JSON_LIMIT) {
    throw new Error("NODE_MEDIA_REQUEST_MANIFEST_LIMIT_EXCEEDED");
  }
  const digest = sha256(bytes);
  const storage = await input.createStorage({
    ownerId: input.ownerId,
    nodeId: input.nodeId,
  });
  const commit = await storage.put({
    ref: {
      ownerId: input.ownerId,
      namespace: "sandbox-inputs",
      key: `advanced-media/${input.kind}/${digest.slice(7)}.json`,
    },
    body: bytesStream(bytes),
    byteSize: bytes.byteLength,
    mimeType: "application/json",
    expectedDigest: digest,
    idempotencyKey: stableIdempotencyKey("advanced-media", [
      input.idempotencyKey,
      digest,
    ]),
  });
  return nodeArtifactRefSchema.parse({
    object: commit.ref,
    digest: commit.digest,
    byteSize: commit.byteSize,
    mimeType: commit.mimeType,
  });
}

function exactlyOneJsonArtifact(artifacts: readonly NodeArtifactRef[]) {
  const matches = artifacts.filter(
    (artifact) => artifact.mimeType === "application/json",
  );
  if (matches.length !== 1) {
    throw new Error("NODE_MEDIA_RESULT_MANIFEST_INVALID");
  }
  return matches[0]!;
}

function artifactForOutput(
  artifacts: readonly NodeArtifactRef[],
  output: { digest: string; byteSize: number; mimeType: string },
) {
  const matches = artifacts.filter(
    (artifact) =>
      artifact.digest === output.digest &&
      artifact.byteSize === output.byteSize &&
      artifact.mimeType === output.mimeType,
  );
  if (matches.length !== 1) {
    throw new Error("NODE_MEDIA_OUTPUT_ARTIFACT_MISMATCH");
  }
  return matches[0]!;
}

async function readJson(input: {
  ownerId: string;
  nodeId: string;
  artifact: NodeArtifactRef;
  signal?: AbortSignal;
  read: Dependencies["read"];
}) {
  const result = await input.read({
    ownerId: input.ownerId,
    nodeId: input.nodeId,
    artifact: input.artifact,
    maxBytes: JSON_LIMIT,
    signal: input.signal,
  });
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(result.bytes),
  ) as unknown;
}

async function cleanup(
  dependencies: Dependencies,
  input: {
    ownerId: string;
    nodeId: string;
    artifacts: readonly NodeArtifactRef[];
  },
  primaryError?: unknown,
) {
  try {
    await dependencies.remove(input);
  } catch (cleanupError) {
    if (primaryError === undefined) throw cleanupError;
  }
}

function dependencies(
  overrides: Partial<Dependencies> | undefined,
): Dependencies {
  return { ...defaults, ...overrides };
}

export async function executePairedNodeBrowserRender(
  input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    branchId: string;
    sourceVersionId: string;
    canonicalUrl: string;
    idempotencyKey: string;
    attempt?: number;
    signal?: AbortSignal;
  },
  overrides?: Partial<Dependencies>,
) {
  const deps = dependencies(overrides);
  input.signal?.throwIfAborted();
  const destination = await deps.urlPolicy.validate(
    input.canonicalUrl,
    "main-navigation",
    input.signal,
  );
  const execution = await deps.resolveProfile({
    ownerId: input.ownerId,
    nodeId: input.nodeId,
    kind: "artifact.browser-render",
  });
  const workerRequest = browserRenderWorkerInputSchema.parse({
    schemaVersion: 1,
    url: destination.url,
    wait: { kind: "dom-settled", maxMs: 8_000 },
    maxNavigations: 8,
    maxRequests: 250,
    maxResponseBytes: 5 * MIB,
    capture: ["readable-html", "metadata", "selected-images"],
  });
  const request = nodeArtifactWorkerRequestV1Schema.parse({
    schemaVersion: 1,
    worker: "browser-capture.v1",
    execution: { threadId: input.threadId, branchId: input.branchId },
    inputs: [],
    manifest: browserCaptureWorkerManifestV1Schema.parse({
      schemaVersion: 1,
      worker: "browser-capture.v1",
      request: workerRequest,
      egressPolicyDigest: execution.profile.egressPolicyDigest,
    }),
  });
  const manifest = await storeRequest({
    ...input,
    nodeId: execution.nodeId,
    kind: "artifact.browser-render",
    request,
    createStorage: deps.createStorage,
  });
  let outputs: readonly NodeArtifactRef[] = [];
  let primaryError: unknown;
  try {
    const run = await dispatchRetryGeneration(deps.dispatch, input.attempt, {
      ownerId: input.ownerId,
      nodeId: execution.nodeId,
      kind: "artifact.browser-render",
      expectedConfigRevision: execution.configRevision,
      expectedExecutionProfile: execution.profile,
      inputRefs: [manifest],
      resourceRefs: [manifest.object],
      limits: {
        cpuMillis: 2 * 60_000,
        memoryBytes: 2 * 1024 ** 3,
        inputBytes: manifest.byteSize,
        outputBytes: 6 * MIB,
        deadline: new Date(Date.now() + 3 * 60_000).toISOString(),
      },
      signal: input.signal,
    }, [
      input.ownerId,
      input.sourceVersionId,
      "browser-render",
      input.idempotencyKey,
    ]);
    outputs = run.resultManifest;
    const output = browserRenderWorkerOutputSchema.parse(
      await readJson({
        ownerId: input.ownerId,
        nodeId: execution.nodeId,
        artifact: exactlyOneJsonArtifact(outputs),
        signal: input.signal,
        read: deps.read,
      }),
    );
    for (const [index, url] of output.redirectChain.entries()) {
      await deps.urlPolicy.validate(
        url,
        index === 0 ? "main-navigation" : "redirect",
        input.signal,
      );
    }
    await deps.urlPolicy.validate(output.finalUrl, "redirect", input.signal);
    const extracted = extractMarkdown(output.readableHtml, output.finalUrl, {
      now: deps.now(),
    });
    await cleanup(deps, {
      ownerId: input.ownerId,
      nodeId: execution.nodeId,
      artifacts: [manifest, ...outputs],
    });
    return {
      output,
      extracted,
      profile: execution.profile,
    };
  } catch (error) {
    primaryError = error;
    await cleanup(
      deps,
      {
        ownerId: input.ownerId,
        nodeId: execution.nodeId,
        artifacts: [manifest, ...outputs],
      },
      primaryError,
    );
    throw error;
  }
}

function normalizeLanguage(value: string, fallback: string) {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return normalized.length >= 2 && normalized.length <= 35
    ? normalized
    : fallback;
}

export function mergeVideoTranscriptionSegments(
  output: ReturnType<typeof videoAudioExtractWorkerOutputV2Schema.parse>,
  transcripts: readonly {
    text: string;
    segments: readonly { startMs: number; endMs: number; text: string }[];
  }[],
): VideoTranscriptSegment[] {
  if (transcripts.length !== output.segments.length) {
    throw new Error("VIDEO_TRANSCRIPTION_SEGMENT_COUNT_MISMATCH");
  }
  const merged: VideoTranscriptSegment[] = [];
  output.segments.forEach((source, index) => {
    const transcript = transcripts[index]!;
    const duration = source.endMs - source.startMs;
    const relative = transcript.segments.length
      ? transcript.segments
      : transcript.text.trim()
        ? [{ startMs: 0, endMs: duration, text: transcript.text }]
        : [];
    for (const segment of relative) {
      const text = segment.text.trim();
      const startMs = source.startMs + Math.max(0, segment.startMs);
      const endMs =
        source.startMs + Math.min(duration, Math.max(1, segment.endMs));
      if (!text || endMs <= startMs) continue;
      merged.push({ startMs, endMs, text: text.slice(0, 8_000) });
    }
  });
  if (merged.length === 0) {
    throw new Error("VIDEO_TRANSCRIPTION_EMPTY");
  }
  return merged;
}

function transcriptBody(segments: readonly VideoTranscriptSegment[]) {
  const groups = new Map<number, string[]>();
  for (const segment of segments) {
    const bucket = Math.floor(segment.startMs / 300_000) * 300_000;
    const group = groups.get(bucket) ?? [];
    group.push(segment.text);
    groups.set(bucket, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([startMs, lines]) => {
      const seconds = Math.floor(startMs / 1_000);
      const hours = Math.floor(seconds / 3_600);
      const minutes = Math.floor((seconds % 3_600) / 60);
      const remainder = seconds % 60;
      const stamp =
        hours > 0
          ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
          : `${minutes}:${String(remainder).padStart(2, "0")}`;
      return `## ${stamp}\n\n${lines.join(" ")}`;
    })
    .join("\n\n");
}

export async function executePairedNodeVideoAudioTranscription(
  input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    branchId: string;
    sourceVersionId: string;
    canonicalUrl: string;
    title: string;
    requestedLanguage: string;
    consentRevision: string;
    idempotencyKey: string;
    attempt?: number;
    signal?: AbortSignal;
  },
  overrides?: Partial<Dependencies>,
) {
  const deps = dependencies(overrides);
  input.signal?.throwIfAborted();
  const parsedUrl = parseYoutubeUrl(input.canonicalUrl);
  if (!parsedUrl) {
    throw new AdvancedIngestionError(
      "unsupported_content",
      "Audio extraction supports one public YouTube video",
      false,
    );
  }
  const execution = await deps.resolveProfile({
    ownerId: input.ownerId,
    nodeId: input.nodeId,
    kind: "artifact.video-audio-extract",
  });
  const request = nodeArtifactWorkerRequestV1Schema.parse({
    schemaVersion: 1,
    worker: "video-audio-extract.v2",
    execution: { threadId: input.threadId, branchId: input.branchId },
    inputs: [],
    manifest: videoAudioExtractWorkerManifestV2Schema.parse({
      schemaVersion: 2,
      worker: "video-audio-extract.v2",
      request: videoAudioSegmentExtractWorkerInputSchema.parse({
        schemaVersion: 2,
        canonicalUrl: parsedUrl.canonicalUrl,
        provider: "youtube",
        maxDurationSeconds: 4 * 60 * 60,
        maxDownloadBytes: 512 * MIB,
        outputCodec: "mp3-mono-16khz",
        segmentSeconds: 10 * 60,
        maximumSegmentBytes: AUDIO_SEGMENT_LIMIT,
      }),
      requestedLanguage: input.requestedLanguage,
      consentRevision: input.consentRevision,
      egressPolicyDigest: execution.profile.egressPolicyDigest,
    }),
  });
  const manifest = await storeRequest({
    ...input,
    nodeId: execution.nodeId,
    kind: "artifact.video-audio-extract",
    request,
    createStorage: deps.createStorage,
  });
  let outputs: readonly NodeArtifactRef[] = [];
  let primaryError: unknown;
  try {
    const run = await dispatchRetryGeneration(deps.dispatch, input.attempt, {
      ownerId: input.ownerId,
      nodeId: execution.nodeId,
      kind: "artifact.video-audio-extract",
      expectedConfigRevision: execution.configRevision,
      expectedExecutionProfile: execution.profile,
      inputRefs: [manifest],
      resourceRefs: [manifest.object],
      limits: {
        cpuMillis: 15 * 60_000,
        memoryBytes: 2 * 1024 ** 3,
        inputBytes: manifest.byteSize,
        outputBytes: 129 * MIB,
        deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
      },
      signal: input.signal,
    }, [
      input.ownerId,
      input.sourceVersionId,
      "video-audio",
      input.idempotencyKey,
    ]);
    outputs = run.resultManifest;
    const extraction = videoAudioExtractWorkerOutputV2Schema.parse(
      await readJson({
        ownerId: input.ownerId,
        nodeId: execution.nodeId,
        artifact: exactlyOneJsonArtifact(outputs),
        signal: input.signal,
        read: deps.read,
      }),
    );
    const provider = await deps.resolveTranscription(input.ownerId, {
      operationId: stableJobId([
        input.ownerId,
        input.sourceVersionId,
        "video-transcription",
        input.idempotencyKey,
      ]),
      signal: input.signal,
    });
    const transcripts = [];
    const languages: string[] = [];
    for (const segment of extraction.segments) {
      input.signal?.throwIfAborted();
      const artifact = artifactForOutput(outputs, segment.audio);
      const audio = await deps.read({
        ownerId: input.ownerId,
        nodeId: execution.nodeId,
        artifact,
        maxBytes: AUDIO_SEGMENT_LIMIT,
        signal: input.signal,
      });
      const result = await provider.transcribeSegment({
        blob: new Blob([audio.bytes], { type: "audio/mpeg" }),
        mimeType: "audio/mpeg",
        language: input.requestedLanguage,
        operationId: `${input.sourceVersionId}:${segment.index}`,
        maximumSeconds: Math.ceil((segment.endMs - segment.startMs) / 1_000),
        attempt: input.attempt,
        signal: input.signal,
      });
      transcripts.push(result);
      if (result.language) languages.push(result.language);
    }
    const segments = mergeVideoTranscriptionSegments(extraction, transcripts);
    const requestedLanguage = normalizeLanguage(input.requestedLanguage, "fr");
    const selectedLanguage = normalizeLanguage(
      languages[0] ?? requestedLanguage,
      requestedLanguage,
    );
    const title = input.title.trim().slice(0, 160) || "YouTube video";
    const source = videoSourceResultSchema.parse({
      strategy: "extracted-audio",
      canonicalUrl: parsedUrl.canonicalUrl,
      mediaId: parsedUrl.videoId,
      title,
      channel: null,
      requestedLanguage,
      selectedLanguage,
      languageMismatch: selectedLanguage !== requestedLanguage,
      durationMs: extraction.durationMs,
      adapterId: "avermate-node-video-audio",
      adapterVersion: execution.profile.profileVersion,
      transcriptProvider: provider.id,
      transcriptModel: provider.model,
      segments,
    });
    const built = buildMarkdownDocument(transcriptBody(segments), {
      title,
      source: parsedUrl.canonicalUrl,
      fetchedAt: deps.now(),
      site: "YouTube",
    });
    await cleanup(deps, {
      ownerId: input.ownerId,
      nodeId: execution.nodeId,
      artifacts: [manifest, ...outputs],
    });
    return {
      source,
      markdown: built.markdown,
      wordCount: built.wordCount,
      truncated: built.truncated,
      chapters: [] as const,
      profile: execution.profile,
    };
  } catch (error) {
    primaryError = error;
    await cleanup(
      deps,
      {
        ownerId: input.ownerId,
        nodeId: execution.nodeId,
        artifacts: [manifest, ...outputs],
      },
      primaryError,
    );
    throw error;
  }
}

export type PairedNodeMediaDependencies = Partial<Dependencies>;
export type PairedNodeMediaTranscriptionProvider = TranscriptionProvider;
export type PairedNodeExecutionProfile = NodeJobExecutionProfile;
