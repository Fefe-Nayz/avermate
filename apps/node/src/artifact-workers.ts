import type {
  NodeArtifactJobKind,
  NodeArtifactRef,
  NodeArtifactWorkerId,
  NodeArtifactWorkerRequestV1,
  NodeJobExecutionProfile,
  NodeJobV1,
  ObjectStorageProvider,
  OwnedObjectRef,
  SandboxExecutionEvent,
  SandboxExecutionProfile,
  SandboxFileManifestEntry,
  SandboxInputFile,
  SandboxProfileId,
  SandboxProvider,
} from "@avermate/agent-contracts";
import {
  NODE_ARTIFACT_JOB_BINDINGS,
  corpusDerivativeWorkerOutputV1Schema,
  latexWorkerOutputV1Schema,
  localOcrWorkerOutputV1Schema,
  localTranscriptionWorkerOutputV1Schema,
  manimWorkerOutputV1Schema,
  materialPreviewWorkerOutputV1Schema,
  mediaTimelineRenderWorkerOutputV1Schema,
  nodeArtifactRefSchema,
  nodeArtifactWorkerRequestV1Schema,
  sandboxExecutionProfileSchema,
  slidesWorkerOutputV1Schema,
  videoAudioExtractWorkerOutputV2Schema,
  browserRenderWorkerOutputSchema,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { canonicalDigest, canonicalJson } from "./canonical-json";
import {
  localDocumentAiModelAttestation,
  type NodeConfig,
} from "./config";
import type { NodeJobHandler, NodeJobHandlerContext } from "./job-dispatcher";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const MAX_MANIFEST_BYTES = 8 * MIB;
const MAX_STAGED_INPUT_BYTES = 512 * MIB;

interface ValueSchema {
  parse(value: unknown): unknown;
}

type WorkerDefinition = {
  kind: NodeArtifactJobKind;
  worker: NodeArtifactWorkerId;
  profileId: Extract<
    SandboxProfileId,
    | "browser"
    | "media"
    | "video-audio"
    | "ocr"
    | "speech-to-text"
    | "manim"
    | "latex"
    | "slides"
  >;
  executable: string;
  argv: readonly string[];
  outputSchema: ValueSchema;
  resultPath: string;
  outputPaths(output: unknown): readonly string[];
  allowedKinds: readonly SandboxFileManifestEntry["kind"][];
  maximumFiles: number;
  maximumFileBytes: number;
  maximumTotalBytes: number;
  network: "required" | "denied";
};

const fixed = (paths: readonly string[]) => () => paths;
const kinds = (...values: SandboxFileManifestEntry["kind"][]) => values;

export const NODE_ARTIFACT_WORKER_DEFINITIONS = Object.freeze({
  "artifact.browser-render": Object.freeze({
    kind: "artifact.browser-render",
    worker: "browser-capture.v1",
    profileId: "browser",
    executable: "/opt/avermate/bin/browser-capture",
    argv: [
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/render.json",
    ],
    outputSchema: browserRenderWorkerOutputSchema,
    resultPath: "output/render.json",
    outputPaths: fixed(["output/render.json"]),
    allowedKinds: kinds("json"),
    maximumFiles: 1,
    maximumFileBytes: 6 * MIB,
    maximumTotalBytes: 6 * MIB,
    network: "required",
  }),
  "artifact.video-audio-extract": Object.freeze({
    kind: "artifact.video-audio-extract",
    worker: "video-audio-extract.v2",
    profileId: "video-audio",
    executable: "/opt/avermate/bin/media-build",
    argv: [
      "extract-video-audio-segments",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output",
      "--manifest",
      "/workspace/output/extraction-segments.json",
    ],
    outputSchema: videoAudioExtractWorkerOutputV2Schema,
    resultPath: "output/extraction-segments.json",
    outputPaths: (value: unknown) => {
      const output = videoAudioExtractWorkerOutputV2Schema.parse(value);
      return [
        ...output.segments.map((segment) => segment.audio.path),
        "output/extraction-segments.json",
      ];
    },
    allowedKinds: kinds("mp3", "json"),
    maximumFiles: 241,
    maximumFileBytes: 32 * MIB,
    maximumTotalBytes: 129 * MIB,
    network: "required",
  }),
  "artifact.local-ocr": Object.freeze({
    kind: "artifact.local-ocr",
    worker: "local-ocr.v1",
    profileId: "ocr",
    executable: "/opt/avermate/bin/local-ocr",
    argv: [
      "--input",
      "/workspace/input/request.json",
      "--manifest",
      "/workspace/output/ocr.json",
    ],
    outputSchema: localOcrWorkerOutputV1Schema,
    resultPath: "output/ocr.json",
    outputPaths: fixed(["output/ocr.json"]),
    allowedKinds: kinds("json"),
    maximumFiles: 1,
    maximumFileBytes: 3 * MIB,
    maximumTotalBytes: 3 * MIB,
    network: "denied",
  }),
  "artifact.local-transcription": Object.freeze({
    kind: "artifact.local-transcription",
    worker: "local-transcription.v1",
    profileId: "speech-to-text",
    executable: "/opt/avermate/bin/local-transcription",
    argv: [
      "--input",
      "/workspace/input/request.json",
      "--manifest",
      "/workspace/output/transcription.json",
    ],
    outputSchema: localTranscriptionWorkerOutputV1Schema,
    resultPath: "output/transcription.json",
    outputPaths: fixed(["output/transcription.json"]),
    allowedKinds: kinds("json"),
    maximumFiles: 1,
    maximumFileBytes: 8 * MIB,
    maximumTotalBytes: 8 * MIB,
    network: "denied",
  }),
  "artifact.render-video": Object.freeze({
    kind: "artifact.render-video",
    worker: "media-timeline-render.v1",
    profileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: [
      "render-timeline",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/video.mp4",
      "--manifest",
      "/workspace/output/render.json",
    ],
    outputSchema: mediaTimelineRenderWorkerOutputV1Schema,
    resultPath: "output/render.json",
    outputPaths: fixed([
      "output/video.mp4",
      "output/captions.vtt",
      "output/poster.png",
      "output/render.json",
    ]),
    allowedKinds: kinds("mp4", "vtt", "png", "json"),
    maximumFiles: 4,
    maximumFileBytes: 2 * GIB,
    maximumTotalBytes: 2 * GIB,
    network: "denied",
  }),
  "artifact.compose-thumbnail": Object.freeze({
    kind: "artifact.compose-thumbnail",
    worker: "material-preview.v1",
    profileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: [
      "material-preview",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/preview.webp",
      "--manifest",
      "/workspace/output/preview.json",
    ],
    outputSchema: materialPreviewWorkerOutputV1Schema,
    resultPath: "output/preview.json",
    outputPaths: fixed(["output/preview.webp", "output/preview.json"]),
    allowedKinds: kinds("webp", "json"),
    maximumFiles: 2,
    maximumFileBytes: 8 * MIB,
    maximumTotalBytes: 9 * MIB,
    network: "denied",
  }),
  "artifact.corpus-derivatives": Object.freeze({
    kind: "artifact.corpus-derivatives",
    worker: "corpus-derivatives.v1",
    profileId: "media",
    executable: "/opt/avermate/bin/corpus-derivatives",
    argv: [
      "--input",
      "/workspace/input/request.json",
      "--manifest",
      "/workspace/output/derivatives.json",
    ],
    outputSchema: corpusDerivativeWorkerOutputV1Schema,
    resultPath: "output/derivatives.json",
    outputPaths: (value: unknown) => {
      const output = corpusDerivativeWorkerOutputV1Schema.parse(value);
      const files =
        output.kind === "pdf"
          ? output.units.flatMap((unit) => [unit.pdf.path, unit.image.path])
          : output.kind === "image"
            ? [output.image.path]
            : output.kind === "media-probe"
              ? []
              : output.units.map((unit) => unit.file.path);
      return [...files, "output/derivatives.json"];
    },
    allowedKinds: kinds("pdf", "png", "mp3", "mp4", "json"),
    maximumFiles: 129,
    maximumFileBytes: 100 * MIB,
    maximumTotalBytes: 512 * MIB,
    network: "denied",
  }),
  "artifact.latex-build": Object.freeze({
    kind: "artifact.latex-build",
    worker: "latex-build.v1",
    profileId: "latex",
    executable: "/opt/avermate/bin/latex-build",
    argv: [
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/document.pdf",
      "--manifest",
      "/workspace/output/build.json",
    ],
    outputSchema: latexWorkerOutputV1Schema,
    resultPath: "output/build.json",
    outputPaths: fixed([
      "output/document.pdf",
      "output/build.log",
      "output/build.json",
    ]),
    allowedKinds: kinds("pdf", "text", "json"),
    maximumFiles: 3,
    maximumFileBytes: 256 * MIB,
    maximumTotalBytes: 257 * MIB,
    network: "denied",
  }),
  "artifact.slides-build": Object.freeze({
    kind: "artifact.slides-build",
    worker: "slides-build.v1",
    profileId: "slides",
    executable: "/opt/avermate/bin/slides-build",
    argv: [
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/slides.pdf",
      "--manifest",
      "/workspace/output/build.json",
    ],
    outputSchema: slidesWorkerOutputV1Schema,
    resultPath: "output/build.json",
    outputPaths: fixed(["output/slides.pdf", "output/build.json"]),
    allowedKinds: kinds("pdf", "json"),
    maximumFiles: 2,
    maximumFileBytes: 512 * MIB,
    maximumTotalBytes: 513 * MIB,
    network: "denied",
  }),
  "artifact.manim-build": Object.freeze({
    kind: "artifact.manim-build",
    worker: "manim-build.v1",
    profileId: "manim",
    executable: "/opt/avermate/bin/manim-build",
    argv: [
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/scene.mp4",
      "--manifest",
      "/workspace/output/render.json",
    ],
    outputSchema: manimWorkerOutputV1Schema,
    resultPath: "output/render.json",
    outputPaths: fixed(["output/scene.mp4", "output/render.json"]),
    allowedKinds: kinds("mp4", "json"),
    maximumFiles: 2,
    maximumFileBytes: 512 * MIB,
    maximumTotalBytes: 513 * MIB,
    network: "denied",
  }),
} satisfies Readonly<Record<NodeArtifactJobKind, WorkerDefinition>>);

const supportedProfiles = new Set<SandboxProfileId>([
  "browser",
  "media",
  "video-audio",
  "ocr",
  "speech-to-text",
  "manim",
  "latex",
  "slides",
]);

export function configuredArtifactSandboxProfiles(
  config: NodeConfig,
): readonly SandboxExecutionProfile[] {
  return config.sandbox.images
    .filter((image) => supportedProfiles.has(image.profileId))
    .map((image) => artifactSandboxProfile(image));
}

function artifactSandboxProfile(
  image: NodeConfig["sandbox"]["images"][number],
): SandboxExecutionProfile {
  const network =
    image.egress.mode === "allowlist"
      ? {
          networkBytes: image.egress.maxResponseBytes,
          networkRequests: image.egress.maxRequests,
        }
      : { networkBytes: 0, networkRequests: 0 };
  const base = {
    version: `node-v1-${image.profileId}-${image.digest.slice(7, 19)}`,
    enabled: true,
    requiredBaselineVersion: 1 as const,
    image: {
      imageDigest: image.digest,
      profileVersion: `node-v1-${image.profileId}-${image.digest.slice(7, 19)}`,
    },
    egress: image.egress,
    workspaceRoot: "/workspace" as const,
    readOnlyRootfs: true as const,
    allowHostMounts: false as const,
    allowDevices: false as const,
    readOnlyInputPaths: ["/workspace/input/"],
    writablePaths: ["/workspace/output/", "/workspace/tmp/"],
    allowSecrets: false,
    resources: {
      cpuMillis: 32_000,
      memoryBytes: 2 * GIB,
      swapBytes: 0,
      pids: 256,
      wallTimeMs: 15 * 60_000,
      cancellationGraceMs: 5_000,
      outputBytes: 2 * GIB,
      stdoutBytes: 4 * MIB,
      stderrBytes: 4 * MIB,
      eventBytes: 8 * MIB,
      workspaceBytes: 8 * GIB,
      fileCount: 10_000,
      tmpfsBytes: 512 * MIB,
      tmpfsInodes: 20_000,
      openFiles: 2_048,
      gpuCount: 0 as const,
      ...network,
    },
  };
  switch (image.profileId) {
    case "browser":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "browser",
        entrypoints: ["/opt/avermate/bin/browser-capture"],
        outputGlobs: ["output/*.json"],
        workload: {
          kind: "browser",
          freshContext: true,
          serviceWorkers: false,
          downloads: false,
          permissions: [],
          maxDomBytes: 16 * MIB,
          maxScreenshotBytes: 32 * MIB,
        },
      });
    case "media":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "media",
        entrypoints: [
          "/opt/avermate/bin/media-build",
          "/opt/avermate/bin/corpus-derivatives",
        ],
        outputGlobs: [
          "output/*.mp3",
          "output/*.wav",
          "output/*.mp4",
          "output/*.png",
          "output/*.webp",
          "output/*.vtt",
          "output/*.json",
          "output/pages/*.pdf",
          "output/pages/*.png",
          "output/segments/*.mp3",
        ],
        workload: {
          kind: "media",
          networkDuringRun: image.egress.mode === "allowlist",
          allowedInputCodecs: [
            "aac",
            "h264",
            "mp3",
            "opus",
            "pcm_s16le",
            "vp9",
          ],
          allowedOutputCodecs: ["aac", "h264", "mp3", "opus"],
          maxDurationSeconds: 8 * 60 * 60,
          maxWidth: 3_840,
          maxHeight: 2_160,
          maxStreams: 8,
        },
      });
    case "video-audio":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "video-audio",
        entrypoints: ["/opt/avermate/bin/media-build"],
        outputGlobs: ["output/*.mp3", "output/*.json"],
        workload: {
          kind: "video-audio",
          networkDuringRun: image.egress.mode === "allowlist",
          provider: "youtube",
          outputCodec: "mp3-mono-16khz",
          segmentSecondsMin: 60,
          segmentSecondsMax: 20 * 60,
          maximumSegmentBytes: 32 * MIB,
          maxDurationSeconds: 4 * 60 * 60,
        },
      });
    case "ocr":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "ocr",
        entrypoints: ["/opt/avermate/bin/local-ocr"],
        outputGlobs: ["output/*.json"],
        resources: {
          ...base.resources,
          wallTimeMs: 30 * 60_000,
          outputBytes: 3 * MIB,
          workspaceBytes: 512 * MIB,
        },
        workload: {
          kind: "ocr",
          networkDuringRun: false,
          engines: ["tesseract", "poppler"],
          maxPages: 300,
          maxPixelsPerPage: 16_777_216,
          maxTotalPixels: 1_000_000_000,
        },
      });
    case "speech-to-text":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "speech-to-text",
        entrypoints: ["/opt/avermate/bin/local-transcription"],
        outputGlobs: ["output/*.json"],
        resources: {
          ...base.resources,
          cpuMillis: 64_000,
          memoryBytes: 8 * GIB,
          wallTimeMs: 2 * 60 * 60_000,
          outputBytes: 8 * MIB,
          workspaceBytes: 512 * MIB,
        },
        workload: {
          kind: "speech-to-text",
          networkDuringRun: false,
          engine: "whisper.cpp",
          timestampSegments: true,
          maxDurationSeconds: 2 * 60 * 60,
          maxInputBytes: 32 * MIB,
        },
      });
    case "manim":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "manim",
        entrypoints: ["/opt/avermate/bin/manim-build"],
        outputGlobs: ["output/*.mp4", "output/*.json"],
        workload: {
          kind: "manim",
          networkDuringRun: false,
          limitedSceneApi: true,
          videoOnly: true,
        },
      });
    case "latex":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "latex",
        entrypoints: ["/opt/avermate/bin/latex-build"],
        outputGlobs: ["output/*.pdf", "output/*.log", "output/*.json"],
        workload: {
          kind: "latex",
          engine: "tectonic",
          shellEscape: false,
          networkDuringRun: false,
          maxPages: 1_000,
        },
      });
    case "slides":
      return sandboxExecutionProfileSchema.parse({
        ...base,
        id: "slides",
        entrypoints: ["/opt/avermate/bin/slides-build"],
        outputGlobs: ["output/*.pdf", "output/*.json"],
        workload: {
          kind: "slides",
          macros: false,
          externalResources: false,
          maxSlides: 1_000,
        },
      });
    default:
      throw new Error("NODE_ARTIFACT_PROFILE_UNSUPPORTED");
  }
}

export class ArtifactSandboxJobHandler implements NodeJobHandler {
  readonly kind: NodeArtifactJobKind;
  readonly capabilityVersion = 1;
  readonly requiredCapability: string;
  readonly #definition: WorkerDefinition;
  readonly #provider: SandboxProvider;
  readonly #profile: SandboxExecutionProfile;
  readonly #hostPolicyDigest: string;
  readonly #maxEvidenceAgeMs: number;
  readonly #storage: ObjectStorageProvider;
  readonly #modelAttestation: {
    modelId: string;
    modelRevision: string;
  } | null;

  constructor(input: {
    kind: NodeArtifactJobKind;
    provider: SandboxProvider;
    profile: SandboxExecutionProfile;
    hostPolicyDigest: string;
    maxEvidenceAgeMs: number;
    storage: ObjectStorageProvider;
    modelAttestation?: { modelId: string; modelRevision: string };
  }) {
    this.kind = input.kind;
    this.requiredCapability = `jobs:${input.kind}`;
    this.#definition = NODE_ARTIFACT_WORKER_DEFINITIONS[input.kind];
    this.#provider = input.provider;
    this.#profile = input.profile;
    this.#hostPolicyDigest = input.hostPolicyDigest;
    this.#maxEvidenceAgeMs = input.maxEvidenceAgeMs;
    this.#storage = input.storage;
    this.#modelAttestation = input.modelAttestation ?? null;
  }

  /** Signed by the enclosing Node capability manifest after a fresh preflight. */
  executionProfile(): NodeJobExecutionProfile {
    return Object.freeze({
      kind: `${this.kind}@${this.capabilityVersion}`,
      sandboxProfileId: this.#profile.id,
      profileVersion: this.#profile.version,
      imageDigest: this.#profile.image.imageDigest,
      egressPolicyDigest: canonicalDigest(this.#profile.egress),
    });
  }

  async healthy() {
    if (!this.#profilePolicyValid()) return false;
    const result = await this.#provider
      .preflight({
        profile: this.#profile,
        expectedHostPolicyDigest: this.#hostPolicyDigest,
        maxEvidenceAgeMs: this.#maxEvidenceAgeMs,
      })
      .catch(() => null);
    return Boolean(
      result?.ok &&
        result.evidence.profileId === this.#profile.id &&
        result.evidence.profileVersion === this.#profile.version &&
        result.evidence.imageDigest === this.#profile.image.imageDigest &&
        result.evidence.hostPolicyDigest === this.#hostPolicyDigest,
    );
  }

  async execute(context: NodeJobHandlerContext) {
    const { job } = context;
    this.#assertExecutionAttestation(job);
    const deadline = Date.parse(job.limits.deadline);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      throw new Error("ARTIFACT_WORKER_DEADLINE_EXPIRED");
    }
    const bounded = boundedJobSignal(context.signal, deadline);
    try {
      return await this.#executeBound(context, bounded.signal, deadline);
    } finally {
      bounded.dispose();
    }
  }

  async cleanupResults(job: NodeJobV1, results: readonly NodeArtifactRef[]) {
    await Promise.all(
      results.map(async (artifact) => {
        const parsed = nodeArtifactRefSchema.parse(artifact);
        if (
          parsed.object.ownerId !== job.principalRef.userId ||
          parsed.object.namespace !== "artifact-worker-results"
        ) {
          return;
        }
        await this.#storage.delete({
          ref: parsed.object,
          expectedDigest: parsed.digest,
          idempotencyKey: cleanupKey(job.id, parsed.object.key),
        });
      }),
    );
  }

  async #executeBound(
    context: NodeJobHandlerContext,
    signal: AbortSignal,
    deadline: number,
  ) {
    const { job } = context;
    assertArtifactWorkerActive(signal);
    if (job.inputRefs.length !== 1) {
      throw new Error("ARTIFACT_WORKER_MANIFEST_REQUIRED");
    }
    const manifestRef = nodeArtifactRefSchema.parse(job.inputRefs[0]);
    if (
      manifestRef.object.ownerId !== job.principalRef.userId ||
      manifestRef.mimeType !== "application/json" ||
      manifestRef.byteSize < 2 ||
      manifestRef.byteSize > MAX_MANIFEST_BYTES
    ) {
      throw new Error("ARTIFACT_WORKER_MANIFEST_INVALID");
    }
    const manifestBytes = await readStoredArtifact({
      storage: this.#storage,
      artifact: manifestRef,
      maximumBytes: Math.min(MAX_MANIFEST_BYTES, job.limits.inputBytes),
      signal,
    });
    const request = nodeArtifactWorkerRequestV1Schema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)),
    );
    if (request.worker !== this.#definition.worker) {
      throw new Error("ARTIFACT_WORKER_KIND_MISMATCH");
    }
    this.#assertGrantedResources(
      manifestRef,
      request,
      context.grantedResources,
      job.principalRef.userId,
    );
    this.#assertManifestPolicy(request);
    const inputTotal = request.inputs.reduce(
      (total, input) => total + input.artifact.byteSize,
      manifestRef.byteSize,
    );
    if (
      inputTotal > job.limits.inputBytes ||
      inputTotal > this.#profile.resources.workspaceBytes ||
      inputTotal > MAX_STAGED_INPUT_BYTES
    ) {
      throw new Error("ARTIFACT_WORKER_INPUT_LIMIT_EXCEEDED");
    }
    const innerBytes = new TextEncoder().encode(canonicalJson(request.manifest));
    const files: SandboxInputFile[] = [
      {
        relativePath: "input/request.json",
        bytes: innerBytes,
        digest: digestBytes(innerBytes),
        mimeType: "application/json",
      },
    ];
    for (const input of request.inputs) {
      files.push({
        relativePath: input.path,
        bytes: await readStoredArtifact({
          storage: this.#storage,
          artifact: input.artifact,
          maximumBytes: input.artifact.byteSize,
          signal,
        }),
        digest: input.artifact.digest,
        mimeType: input.artifact.mimeType,
      });
    }
    const preflight = await abortableArtifactOperation(
      this.#provider.preflight({
        profile: this.#profile,
        expectedHostPolicyDigest: this.#hostPolicyDigest,
        maxEvidenceAgeMs: this.#maxEvidenceAgeMs,
      }),
      signal,
    );
    if (!preflight.ok) throw new Error("ARTIFACT_WORKER_PREFLIGHT_FAILED");
    const now = Date.now();
    assertArtifactWorkerActive(signal);
    const handle = await abortableArtifactOperation(
      this.#provider.create({
        operationId: job.id,
        ownerId: job.principalRef.userId,
        threadId: request.execution.threadId,
        branchId: request.execution.branchId,
        profile: this.#profile,
        expectedHostPolicyDigest: this.#hostPolicyDigest,
        maxEvidenceAgeMs: this.#maxEvidenceAgeMs,
        now: new Date(now),
        expiresAt: new Date(
          Math.min(
            deadline,
            now + this.#profile.resources.wallTimeMs + 60_000,
            now + 24 * 60 * 60_000,
          ),
        ),
      }),
      signal,
    );
    const committed: NodeArtifactRef[] = [];
    let stopped = false;
    try {
      await abortableArtifactOperation(
        this.#provider.putFiles(handle, files),
        signal,
      );
      const execution = await consumeExecution({
        events: this.#provider.execute({
          handle,
          executable: this.#definition.executable,
          argv: this.#definition.argv,
          resources: {
            cpuMillis: Math.min(
              this.#profile.resources.cpuMillis,
              job.limits.cpuMillis,
            ),
            memoryBytes: Math.min(
              this.#profile.resources.memoryBytes,
              job.limits.memoryBytes,
            ),
            wallTimeMs: Math.max(
              100,
              Math.min(this.#profile.resources.wallTimeMs, deadline - now),
            ),
            outputBytes: Math.min(
              this.#profile.resources.outputBytes,
              job.limits.outputBytes,
              this.#definition.maximumTotalBytes,
            ),
          },
          signal,
        }),
        signal,
        maximumEventBytes: this.#profile.resources.eventBytes,
        progress: context.progress,
      });
      if (execution !== 0) throw new Error("ARTIFACT_WORKER_PROCESS_FAILED");
      assertArtifactWorkerActive(signal);
      const output = await this.#readAndParseResult(handle, signal);
      const paths = [...new Set(this.#definition.outputPaths(output))];
      if (
        paths.length < 1 ||
        paths.length > this.#definition.maximumFiles ||
        !paths.includes(this.#definition.resultPath)
      ) {
        throw new Error("ARTIFACT_WORKER_OUTPUT_SET_INVALID");
      }
      const entries = await abortableArtifactOperation(
        this.#provider.getFiles(handle, paths),
        signal,
      );
      this.#verifyOutputManifest(output, paths, entries, job.limits.outputBytes);
      for (const entry of entries) {
        assertArtifactWorkerActive(signal);
        const artifact = await this.#storeOutput(
          job.principalRef.userId,
          job.id,
          handle,
          entry,
          signal,
        );
        committed.push(artifact);
        assertArtifactWorkerActive(signal);
      }
      return committed;
    } catch (error) {
      if (signal.aborted) {
        await this.#provider.stop(handle).catch(() => undefined);
        stopped = true;
      }
      await Promise.all(
        committed.map((artifact) =>
          this.#storage
            .delete({
              ref: artifact.object,
              expectedDigest: artifact.digest,
              idempotencyKey: cleanupKey(job.id, artifact.object.key),
            })
            .catch(() => undefined),
        ),
      );
      throw error;
    } finally {
      if (!stopped) await this.#provider.stop(handle).catch(() => undefined);
      await this.#provider.destroy(handle).catch(() => undefined);
    }
  }

  #profilePolicyValid() {
    return (
      this.#profile.enabled &&
      this.#profile.id === this.#definition.profileId &&
      this.#profile.entrypoints.includes(this.#definition.executable) &&
      (this.#definition.network === "required"
        ? this.#profile.egress.mode === "allowlist" &&
          this.#profile.resources.networkBytes > 0 &&
          this.#profile.resources.networkRequests > 0
        : this.#profile.egress.mode === "none" &&
          this.#profile.resources.networkBytes === 0 &&
          this.#profile.resources.networkRequests === 0)
    );
  }

  #assertExecutionAttestation(job: NodeJobV1) {
    const expected = this.executionProfile();
    const actual = job.executionProfile;
    if (
      !actual ||
      actual.kind !== expected.kind ||
      actual.sandboxProfileId !== expected.sandboxProfileId ||
      actual.profileVersion !== expected.profileVersion ||
      actual.imageDigest !== expected.imageDigest ||
      actual.egressPolicyDigest !== expected.egressPolicyDigest
    ) {
      throw new Error("ARTIFACT_WORKER_EXECUTION_ATTESTATION_MISMATCH");
    }
  }

  #assertManifestPolicy(request: NodeArtifactWorkerRequestV1) {
    if (!this.#profilePolicyValid()) {
      throw new Error("ARTIFACT_WORKER_PROFILE_POLICY_INVALID");
    }
    if (
      request.worker === "browser-capture.v1" ||
      request.worker === "video-audio-extract.v2"
    ) {
      if (
        this.#profile.egress.mode !== "allowlist" ||
        request.manifest.egressPolicyDigest !==
          canonicalDigest(this.#profile.egress)
      ) {
        throw new Error("ARTIFACT_WORKER_EGRESS_POLICY_MISMATCH");
      }
      const value =
        request.worker === "browser-capture.v1"
          ? request.manifest.request.url
          : request.manifest.request.canonicalUrl;
      if (!urlAllowed(value, this.#profile.egress.destinations)) {
        throw new Error("ARTIFACT_WORKER_DESTINATION_NOT_ALLOWED");
      }
      if (
        request.worker === "browser-capture.v1" &&
        (request.manifest.request.maxRequests >
          this.#profile.egress.maxRequests ||
          request.manifest.request.maxResponseBytes >
            this.#profile.egress.maxResponseBytes)
      ) {
        throw new Error("ARTIFACT_WORKER_EGRESS_LIMIT_EXCEEDED");
      }
    }
    if (
      request.worker === "local-ocr.v1" ||
      request.worker === "local-transcription.v1"
    ) {
      if (
        !this.#modelAttestation ||
        request.manifest.modelId !== this.#modelAttestation.modelId ||
        request.manifest.modelRevision !== this.#modelAttestation.modelRevision
      ) {
        throw new Error("ARTIFACT_WORKER_MODEL_ATTESTATION_MISMATCH");
      }
    }
  }

  #assertGrantedResources(
    manifest: NodeArtifactRef,
    request: NodeArtifactWorkerRequestV1,
    granted: readonly OwnedObjectRef[],
    ownerId: string,
  ) {
    const expected = [manifest.object, ...request.inputs.map((input) => input.artifact.object)];
    if (
      expected.some((resource) => resource.ownerId !== ownerId) ||
      request.inputs.some((input) => input.artifact.object.ownerId !== ownerId) ||
      canonicalResources(expected) !== canonicalResources(granted)
    ) {
      throw new Error("ARTIFACT_WORKER_RESOURCE_AUTHORITY_MISMATCH");
    }
  }

  async #readAndParseResult(
    handle: Parameters<SandboxProvider["getFiles"]>[0],
    signal: AbortSignal,
  ) {
    const entries = await abortableArtifactOperation(
      this.#provider.getFiles(handle, [this.#definition.resultPath]),
      signal,
    );
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      !entry ||
      entry.relativePath !== this.#definition.resultPath ||
      entry.kind !== "json" ||
      entry.mimeType !== "application/json" ||
      entry.byteSize > Math.min(MAX_MANIFEST_BYTES, this.#definition.maximumFileBytes)
    ) {
      throw new Error("ARTIFACT_WORKER_RESULT_MANIFEST_INVALID");
    }
    const bytes = await readSandboxFile({
      provider: this.#provider,
      handle,
      entry,
      maximumBytes: MAX_MANIFEST_BYTES,
      signal,
    });
    return this.#definition.outputSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  }

  #verifyOutputManifest(
    output: unknown,
    paths: readonly string[],
    entries: readonly SandboxFileManifestEntry[],
    jobOutputLimit: number,
  ) {
    const descriptors = outputDescriptors(output);
    const unique = new Set(entries.map((entry) => entry.relativePath));
    const total = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
    if (
      entries.length !== paths.length ||
      unique.size !== entries.length ||
      total > jobOutputLimit ||
      total > this.#definition.maximumTotalBytes ||
      total > this.#profile.resources.outputBytes
    ) {
      throw new Error("ARTIFACT_WORKER_OUTPUT_MANIFEST_INVALID");
    }
    for (const entry of entries) {
      if (
        !paths.includes(entry.relativePath) ||
        entry.nodeType !== "file" ||
        entry.byteSize > this.#definition.maximumFileBytes ||
        !this.#definition.allowedKinds.includes(entry.kind)
      ) {
        throw new Error("ARTIFACT_WORKER_OUTPUT_PATH_UNEXPECTED");
      }
      if (entry.relativePath === this.#definition.resultPath) {
        if (entry.kind !== "json" || entry.mimeType !== "application/json") {
          throw new Error("ARTIFACT_WORKER_RESULT_MANIFEST_INVALID");
        }
        continue;
      }
      const descriptor = descriptors.get(entry.relativePath);
      if (
        !descriptor ||
        descriptor.digest !== entry.digest ||
        descriptor.byteSize !== entry.byteSize ||
        descriptor.mimeType !== entry.mimeType
      ) {
        throw new Error("ARTIFACT_WORKER_OUTPUT_DESCRIPTOR_MISMATCH");
      }
    }
  }

  async #storeOutput(
    ownerId: string,
    jobId: string,
    handle: Parameters<SandboxProvider["readFile"]>[0],
    entry: SandboxFileManifestEntry,
    signal: AbortSignal,
  ) {
    const jobKey = createHash("sha256").update(jobId).digest("hex");
    const pathKey = createHash("sha256")
      .update(entry.relativePath)
      .digest("hex");
    const ref = {
      ownerId,
      namespace: "artifact-worker-results",
      key: `${jobKey}/${pathKey}`,
    };
    let commit: Awaited<ReturnType<ObjectStorageProvider["put"]>>;
    try {
      const put = this.#storage.put({
        ref,
        body: asyncIterableStream(
          this.#provider.readFile(handle, entry.relativePath),
          signal,
        ),
        byteSize: entry.byteSize,
        mimeType: entry.mimeType,
        expectedDigest: entry.digest,
        idempotencyKey: `artifact-${jobKey.slice(0, 32)}-${pathKey.slice(0, 32)}`,
      });
      commit = await abortableArtifactOperation(put, signal, async () => {
        await this.#storage.delete({
          ref,
          expectedDigest: entry.digest,
          idempotencyKey: cleanupKey(jobId, ref.key),
        });
      });
      assertArtifactWorkerActive(signal);
    } catch (error) {
      if (signal.aborted) {
        await this.#storage
          .delete({
            ref,
            expectedDigest: entry.digest,
            idempotencyKey: cleanupKey(jobId, ref.key),
          })
          .catch(() => undefined);
      }
      throw error;
    }
    return nodeArtifactRefSchema.parse({
      object: commit.ref,
      digest: commit.digest,
      byteSize: commit.byteSize,
      mimeType: commit.mimeType,
    });
  }
}

export async function createHealthyArtifactHandlers(input: {
  config: NodeConfig;
  provider: SandboxProvider;
  profiles: readonly SandboxExecutionProfile[];
  storage: ObjectStorageProvider;
}) {
  if (!input.config.sandbox.hostPolicyDigest) return [];
  const profiles = new Map(input.profiles.map((profile) => [profile.id, profile]));
  const handlers: ArtifactSandboxJobHandler[] = [];
  for (const kind of Object.keys(
    NODE_ARTIFACT_JOB_BINDINGS,
  ) as NodeArtifactJobKind[]) {
    const definition = NODE_ARTIFACT_WORKER_DEFINITIONS[kind];
    const localModel =
      kind === "artifact.local-ocr"
        ? localDocumentAiModelAttestation(input.config.models, "ocr")
        : kind === "artifact.local-transcription"
          ? localDocumentAiModelAttestation(input.config.models, "transcription")
          : null;
    if (
      (kind === "artifact.local-ocr" ||
        kind === "artifact.local-transcription") &&
      !localModel
    ) continue;
    const profile = profiles.get(definition.profileId);
    if (!profile) continue;
    const handler = new ArtifactSandboxJobHandler({
      kind,
      provider: input.provider,
      profile,
      hostPolicyDigest: input.config.sandbox.hostPolicyDigest,
      maxEvidenceAgeMs: input.config.sandbox.maxEvidenceAgeSeconds * 1_000,
      storage: input.storage,
      ...(localModel
        ? {
            modelAttestation: {
              modelId: localModel.model.id,
              modelRevision: localModel.revision,
            },
          }
        : {}),
    });
    if (await handler.healthy()) handlers.push(handler);
  }
  return handlers;
}

async function readStoredArtifact(input: {
  storage: ObjectStorageProvider;
  artifact: NodeArtifactRef;
  maximumBytes: number;
  signal: AbortSignal;
}) {
  const metadata = await abortableArtifactOperation(
    input.storage.stat({ ref: input.artifact.object }),
    input.signal,
  );
  if (
    !metadata ||
    metadata.digest !== input.artifact.digest ||
    metadata.byteSize !== input.artifact.byteSize ||
    metadata.mimeType !== input.artifact.mimeType ||
    metadata.byteSize > input.maximumBytes
  ) {
    throw new Error("ARTIFACT_WORKER_INPUT_STORAGE_MISMATCH");
  }
  const streamPromise = input.storage.get({
    ref: input.artifact.object,
    maxBytes: input.maximumBytes,
  });
  const stream = await abortableArtifactOperation(
    streamPromise,
    input.signal,
    (lateStream) => lateStream.cancel().catch(() => undefined),
  );
  const reader = stream.getReader();
  const bytes = new Uint8Array(metadata.byteSize);
  const hash = createHash("sha256");
  let offset = 0;
  try {
    while (true) {
      assertArtifactWorkerActive(input.signal);
      const part = await abortableArtifactOperation(
        reader.read(),
        input.signal,
        () => reader.cancel().catch(() => undefined),
      );
      if (part.done) break;
      if (offset + part.value.byteLength > bytes.byteLength) {
        throw new Error("ARTIFACT_WORKER_INPUT_SIZE_MISMATCH");
      }
      bytes.set(part.value, offset);
      offset += part.value.byteLength;
      hash.update(part.value);
    }
  } finally {
    if (input.signal.aborted) {
      await reader.cancel(input.signal.reason).catch(() => undefined);
    }
    reader.releaseLock();
  }
  if (offset !== bytes.byteLength || digestHash(hash) !== metadata.digest) {
    throw new Error("ARTIFACT_WORKER_INPUT_DIGEST_MISMATCH");
  }
  return bytes;
}

async function readSandboxFile(input: {
  provider: SandboxProvider;
  handle: Parameters<SandboxProvider["readFile"]>[0];
  entry: SandboxFileManifestEntry;
  maximumBytes: number;
  signal: AbortSignal;
}) {
  if (input.entry.byteSize > input.maximumBytes) {
    throw new Error("ARTIFACT_WORKER_RESULT_TOO_LARGE");
  }
  const bytes = new Uint8Array(input.entry.byteSize);
  const hash = createHash("sha256");
  let offset = 0;
  const iterator = input.provider
    .readFile(input.handle, input.entry.relativePath)
    [Symbol.asyncIterator]();
  try {
    while (true) {
      assertArtifactWorkerActive(input.signal);
      const next = await abortableArtifactOperation(
        iterator.next(),
        input.signal,
        () => iterator.return?.().then(() => undefined),
      );
      if (next.done) break;
      const chunk = next.value;
      if (offset + chunk.byteLength > bytes.byteLength) {
        throw new Error("ARTIFACT_WORKER_RESULT_SIZE_MISMATCH");
      }
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
      hash.update(chunk);
    }
  } finally {
    if (input.signal.aborted) {
      await iterator.return?.().catch(() => undefined);
    }
  }
  if (offset !== input.entry.byteSize || digestHash(hash) !== input.entry.digest) {
    throw new Error("ARTIFACT_WORKER_RESULT_DIGEST_MISMATCH");
  }
  return bytes;
}

async function consumeExecution(input: {
  events: AsyncIterable<SandboxExecutionEvent>;
  signal: AbortSignal;
  maximumEventBytes: number;
  progress: NodeJobHandlerContext["progress"];
}) {
  let started = false;
  let exitCode: number | null = null;
  let eventBytes = 0;
  for await (const event of input.events) {
    if (input.signal.aborted) throw new Error("ARTIFACT_WORKER_CANCELLED");
    eventBytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (eventBytes > input.maximumEventBytes) {
      throw new Error("ARTIFACT_WORKER_EVENT_LIMIT_EXCEEDED");
    }
    if (event.type === "started") {
      if (started || exitCode !== null) {
        throw new Error("ARTIFACT_WORKER_EVENT_ORDER_INVALID");
      }
      started = true;
      continue;
    }
    if (!started || exitCode !== null) {
      throw new Error("ARTIFACT_WORKER_EVENT_ORDER_INVALID");
    }
    if (event.type === "progress") {
      if (
        !Number.isSafeInteger(event.current) ||
        !Number.isSafeInteger(event.total) ||
        event.current < 0 ||
        event.total < 1 ||
        event.current > event.total
      ) {
        throw new Error("ARTIFACT_WORKER_PROGRESS_INVALID");
      }
      await input.progress({
        numerator: event.current,
        denominator: event.total,
        unit: "worker",
        message: (event.message ?? "Artifact worker progress").slice(0, 512),
      });
    }
    if (event.type === "exited") exitCode = event.exitCode;
  }
  if (!started || exitCode === null) {
    throw new Error("ARTIFACT_WORKER_EXIT_EVENT_MISSING");
  }
  return exitCode;
}

function outputDescriptors(value: unknown) {
  const descriptors = new Map<
    string,
    { digest: string; byteSize: number; mimeType: string }
  >();
  const pending: unknown[] = [value];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    count += 1;
    if (count > 10_000) throw new Error("ARTIFACT_WORKER_OUTPUT_TOO_COMPLEX");
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (
      typeof record.path === "string" &&
      typeof record.digest === "string" &&
      typeof record.byteSize === "number" &&
      typeof record.mimeType === "string"
    ) {
      if (descriptors.has(record.path)) {
        throw new Error("ARTIFACT_WORKER_OUTPUT_DESCRIPTOR_DUPLICATE");
      }
      descriptors.set(record.path, {
        digest: record.digest,
        byteSize: record.byteSize,
        mimeType: record.mimeType,
      });
    }
    pending.push(...Object.values(record));
  }
  return descriptors;
}

function urlAllowed(
  value: string,
  destinations: Extract<
    SandboxExecutionProfile["egress"],
    { mode: "allowlist" }
  >["destinations"],
) {
  const url = new URL(value);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 0;
  return destinations.some(
    (destination) =>
      url.protocol === `${destination.protocol}:` &&
      url.hostname.toLowerCase() === destination.hostname.toLowerCase() &&
      port === destination.port &&
      url.pathname.startsWith(destination.pathPrefix),
  );
}

function canonicalResources(resources: readonly OwnedObjectRef[]) {
  return canonicalJson(
    resources.map((resource) => canonicalJson(resource)).sort(),
  );
}

function digestBytes(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function digestHash(hash: ReturnType<typeof createHash>) {
  return `sha256:${hash.digest("hex")}`;
}

function cleanupKey(jobId: string, key: string) {
  return `cleanup-${createHash("sha256").update(`${jobId}\0${key}`).digest("hex")}`;
}

function asyncIterableStream(
  iterable: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
) {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (signal) assertArtifactWorkerActive(signal);
        const next = signal
          ? await abortableArtifactOperation(
              iterator.next(),
              signal,
              () => iterator.return?.().then(() => undefined),
            )
          : await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function assertArtifactWorkerActive(signal: AbortSignal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("ARTIFACT_WORKER_CANCELLED");
}

function abortableArtifactOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onLateResolution?: (value: T) => Promise<unknown> | unknown,
) {
  if (signal.aborted) {
    void operation.then(onLateResolution).catch(() => undefined);
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("ARTIFACT_WORKER_CANCELLED"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("ARTIFACT_WORKER_CANCELLED"),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (settled) {
          void Promise.resolve(onLateResolution?.(value)).catch(() => undefined);
          return;
        }
        settled = true;
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

function boundedJobSignal(parent: AbortSignal, deadline: number) {
  const controller = new AbortController();
  const abortParent = () => controller.abort(
    parent.reason instanceof Error
      ? parent.reason
      : new Error("ARTIFACT_WORKER_CANCELLED"),
  );
  if (parent.aborted) abortParent();
  else parent.addEventListener("abort", abortParent, { once: true });
  const remaining = Math.max(0, deadline - Date.now());
  const timer = setTimeout(
    () => controller.abort(new Error("ARTIFACT_WORKER_DEADLINE_EXPIRED")),
    remaining,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abortParent);
    },
  };
}
