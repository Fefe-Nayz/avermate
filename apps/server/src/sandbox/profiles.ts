import {
  sandboxExecutionProfileSchema,
  type SandboxExecutionProfile,
  type SandboxProfileId,
} from "@avermate/agent-contracts";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const imageDigests = {
  latex: `sha256:${"1".repeat(64)}`,
  "python-data": `sha256:${"2".repeat(64)}`,
  browser: `sha256:${"3".repeat(64)}`,
  slides: `sha256:${"4".repeat(64)}`,
  media: `sha256:${"5".repeat(64)}`,
  "video-audio": `sha256:${"a".repeat(64)}`,
  ocr: `sha256:${"b".repeat(64)}`,
  "speech-to-text": `sha256:${"c".repeat(64)}`,
  manim: `sha256:${"6".repeat(64)}`,
  "image-builder": `sha256:${"7".repeat(64)}`,
  opencode: `sha256:${"8".repeat(64)}`,
  openhands: `sha256:${"9".repeat(64)}`,
} satisfies Record<SandboxProfileId, string>;

function profile(input: {
  id: SandboxProfileId;
  entrypoints: string[];
  cpuMillis?: number;
  memoryBytes?: number;
  wallTimeMs?: number;
  outputBytes?: number;
  workspaceBytes?: number;
  outputGlobs: string[];
  workload: SandboxExecutionProfile["workload"];
}): SandboxExecutionProfile {
  return sandboxExecutionProfileSchema.parse({
    id: input.id,
    version: "v1-disabled",
    enabled: false,
    requiredBaselineVersion: 1,
    image: {
      imageDigest: imageDigests[input.id],
      profileVersion: "v1-disabled",
    },
    entrypoints: input.entrypoints,
    resources: {
      cpuMillis: input.cpuMillis ?? 1_000,
      memoryBytes: input.memoryBytes ?? 512 * MIB,
      swapBytes: 0,
      pids: 128,
      wallTimeMs: input.wallTimeMs ?? 60_000,
      cancellationGraceMs: 5_000,
      outputBytes: input.outputBytes ?? 64 * MIB,
      stdoutBytes: 4 * MIB,
      stderrBytes: 4 * MIB,
      eventBytes: 8 * MIB,
      workspaceBytes: input.workspaceBytes ?? 2 * GIB,
      fileCount: 10_000,
      tmpfsBytes: 256 * MIB,
      tmpfsInodes: 10_000,
      openFiles: 1_024,
      networkBytes: 0,
      networkRequests: 0,
      gpuCount: 0,
    },
    egress: { mode: "none" },
    workspaceRoot: "/workspace",
    readOnlyRootfs: true,
    allowHostMounts: false,
    allowDevices: false,
    readOnlyInputPaths: ["/workspace/input/"],
    writablePaths: ["/workspace/output/", "/workspace/tmp/"],
    outputGlobs: [...input.outputGlobs, "output/conformance.json"],
    allowSecrets: false,
    workload: input.workload,
  });
}

/**
 * Capability catalogue only. Every v1 profile is deliberately disabled until a
 * deployment pins a reviewed image and supplies matching baseline evidence.
 */
export const SANDBOX_PROFILES_V1 = {
  latex: profile({
    id: "latex",
    entrypoints: ["/opt/avermate/bin/latex-build"],
    outputGlobs: ["output/*.pdf", "output/*.log", "output/build.json"],
    wallTimeMs: 120_000,
    workload: {
      kind: "latex",
      engine: "tectonic",
      shellEscape: false,
      networkDuringRun: false,
      maxPages: 100,
    },
  }),
  "python-data": profile({
    id: "python-data",
    entrypoints: ["/opt/avermate/bin/python-data"],
    outputGlobs: ["output/*.json", "output/*.csv", "output/*.png"],
    memoryBytes: GIB,
    workload: {
      kind: "python-data",
      packageManager: false,
      networkDuringRun: false,
      gpu: false,
    },
  }),
  browser: profile({
    id: "browser",
    entrypoints: ["/opt/avermate/bin/browser-capture"],
    outputGlobs: ["output/*.pdf", "output/*.png", "output/*.json"],
    memoryBytes: 2 * GIB,
    wallTimeMs: 120_000,
    workload: {
      kind: "browser",
      freshContext: true,
      serviceWorkers: false,
      downloads: false,
      permissions: [],
      maxDomBytes: 16 * MIB,
      maxScreenshotBytes: 32 * MIB,
    },
  }),
  slides: profile({
    id: "slides",
    entrypoints: ["/opt/avermate/bin/slides-build"],
    outputGlobs: ["output/*.pptx", "output/*.pdf", "output/*.json"],
    memoryBytes: GIB,
    workload: {
      kind: "slides",
      macros: false,
      externalResources: false,
      maxSlides: 250,
    },
  }),
  media: profile({
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
    ],
    memoryBytes: 2 * GIB,
    wallTimeMs: 15 * 60_000,
    outputBytes: 512 * MIB,
    workspaceBytes: 8 * GIB,
    workload: {
      kind: "media",
      networkDuringRun: false,
      allowedInputCodecs: ["aac", "h264", "mp3", "opus", "pcm_s16le", "vp9"],
      allowedOutputCodecs: ["aac", "h264", "mp3", "opus"],
      maxDurationSeconds: 2 * 60 * 60,
      maxWidth: 3_840,
      maxHeight: 2_160,
      maxStreams: 8,
    },
  }),
  "video-audio": profile({
    id: "video-audio",
    entrypoints: ["/opt/avermate/bin/media-build"],
    outputGlobs: ["output/*.mp3", "output/*.json"],
    memoryBytes: 2 * GIB,
    wallTimeMs: 15 * 60_000,
    outputBytes: 128 * MIB,
    workspaceBytes: 4 * GIB,
    workload: {
      kind: "video-audio",
      networkDuringRun: false,
      provider: "youtube",
      outputCodec: "mp3-mono-16khz",
      segmentSecondsMin: 60,
      segmentSecondsMax: 20 * 60,
      maximumSegmentBytes: 32 * MIB,
      maxDurationSeconds: 4 * 60 * 60,
    },
  }),
  ocr: profile({
    id: "ocr",
    entrypoints: ["/opt/avermate/bin/local-ocr"],
    outputGlobs: ["output/*.json"],
    memoryBytes: 2 * GIB,
    wallTimeMs: 30 * 60_000,
    outputBytes: 3 * MIB,
    workspaceBytes: 512 * MIB,
    workload: {
      kind: "ocr",
      networkDuringRun: false,
      engines: ["tesseract", "poppler"],
      maxPages: 300,
      maxPixelsPerPage: 16_777_216,
      maxTotalPixels: 1_000_000_000,
    },
  }),
  "speech-to-text": profile({
    id: "speech-to-text",
    entrypoints: ["/opt/avermate/bin/local-transcription"],
    outputGlobs: ["output/*.json"],
    cpuMillis: 64_000,
    memoryBytes: 8 * GIB,
    wallTimeMs: 2 * 60 * 60_000,
    outputBytes: 8 * MIB,
    workspaceBytes: 512 * MIB,
    workload: {
      kind: "speech-to-text",
      networkDuringRun: false,
      engine: "whisper.cpp",
      timestampSegments: true,
      maxDurationSeconds: 2 * 60 * 60,
      maxInputBytes: 32 * MIB,
    },
  }),
  manim: profile({
    id: "manim",
    entrypoints: ["/opt/avermate/bin/manim-build"],
    outputGlobs: ["output/*.mp4", "output/*.json"],
    memoryBytes: 2 * GIB,
    wallTimeMs: 15 * 60_000,
    workload: {
      kind: "manim",
      networkDuringRun: false,
      limitedSceneApi: true,
      videoOnly: true,
    },
  }),
  "image-builder": profile({
    id: "image-builder",
    entrypoints: ["/opt/avermate/bin/build-profile-image"],
    outputGlobs: ["output/attestation.json"],
    memoryBytes: 2 * GIB,
    wallTimeMs: 30 * 60_000,
    workspaceBytes: 8 * GIB,
    workload: {
      kind: "image-builder",
      rootless: true,
      privileged: false,
      hostRuntimeSocket: false,
      tenantScopedMutableCache: true,
      requireSbom: true,
      requireProvenance: true,
      requireSignature: true,
    },
  }),
  opencode: profile({
    id: "opencode",
    entrypoints: ["/opt/avermate/bin/opencode", "/usr/bin/git"],
    outputGlobs: ["output/**"],
    memoryBytes: 4 * GIB,
    wallTimeMs: 30 * 60_000,
    outputBytes: 128 * MIB,
    workspaceBytes: 4 * GIB,
    workload: {
      kind: "opencode",
      reviewedCommandCatalogue: true,
      arbitraryHostCommands: false,
      canonicalHistoryImported: false,
    },
  }),
  openhands: profile({
    id: "openhands",
    entrypoints: ["/opt/avermate/bin/openhands", "/usr/bin/git"],
    outputGlobs: ["output/**"],
    memoryBytes: 4 * GIB,
    wallTimeMs: 30 * 60_000,
    outputBytes: 128 * MIB,
    workspaceBytes: 4 * GIB,
    workload: {
      kind: "openhands",
      reviewedCommandCatalogue: true,
      arbitraryHostCommands: false,
      canonicalHistoryImported: false,
    },
  }),
} satisfies Readonly<Record<SandboxProfileId, SandboxExecutionProfile>>;

export function enableSandboxProfile(
  id: SandboxProfileId,
  input: {
    version: string;
    imageDigest: string;
    egress?: SandboxExecutionProfile["egress"];
    allowSecrets?: boolean;
    resources?: Partial<SandboxExecutionProfile["resources"]>;
  },
): SandboxExecutionProfile {
  const base = SANDBOX_PROFILES_V1[id];
  const egress = input.egress ?? base.egress;
  return sandboxExecutionProfileSchema.parse({
    ...base,
    version: input.version,
    enabled: true,
    image: {
      imageDigest: input.imageDigest,
      profileVersion: input.version,
    },
    egress,
    allowSecrets: input.allowSecrets ?? false,
    resources: { ...base.resources, ...input.resources },
    workload:
      "networkDuringRun" in base.workload
        ? {
            ...base.workload,
            networkDuringRun: egress.mode === "allowlist",
          }
        : base.workload,
  });
}
