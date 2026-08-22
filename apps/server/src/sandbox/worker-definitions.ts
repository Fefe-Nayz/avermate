import {
  browserCaptureWorkerManifestV1Schema,
  browserRenderWorkerOutputSchema,
  corpusDerivativeWorkerManifestV1Schema,
  corpusDerivativeWorkerOutputV1Schema,
  latexWorkerManifestV1Schema,
  latexWorkerOutputV1Schema,
  manimWorkerManifestV1Schema,
  manimWorkerOutputV1Schema,
  materialPreviewWorkerManifestV1Schema,
  materialPreviewWorkerOutputV1Schema,
  mediaSegmentWorkerManifestV1Schema,
  mediaSegmentWorkerOutputV1Schema,
  mediaTimelineRenderWorkerManifestV1Schema,
  mediaTimelineRenderWorkerOutputV1Schema,
  slidesWorkerManifestV1Schema,
  slidesWorkerOutputV1Schema,
  videoAudioExtractWorkerManifestV1Schema,
  videoAudioExtractWorkerOutputV1Schema,
  type SandboxFileManifestEntry,
  type SandboxProfileId,
} from "@avermate/agent-contracts";

interface ValueSchema {
  parse(value: unknown): unknown;
}

export interface SandboxWorkerDefinition {
  readonly id: SandboxWorkerId;
  readonly version: 1;
  readonly profileId: SandboxProfileId;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly resultPath: string;
  readonly outputPaths: (parsedResult: unknown) => readonly string[];
  readonly allowedKinds: readonly SandboxFileManifestEntry["kind"][];
  readonly maximumFiles: number;
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
}

export type SandboxWorkerId =
  | "browser-capture.v1"
  | "corpus-derivatives.v1"
  | "video-audio-extract.v1"
  | "media-segment.v1"
  | "media-timeline-render.v1"
  | "material-preview.v1"
  | "manim-build.v1"
  | "latex-build.v1"
  | "slides-build.v1";

export const SANDBOX_WORKER_IDS = Object.freeze([
  "browser-capture.v1",
  "corpus-derivatives.v1",
  "video-audio-extract.v1",
  "media-segment.v1",
  "media-timeline-render.v1",
  "material-preview.v1",
  "manim-build.v1",
  "latex-build.v1",
  "slides-build.v1",
] as const satisfies readonly SandboxWorkerId[]);

const MIB = 1024 * 1024;
const GIB = 1024 ** 3;
type SandboxOutputKind = SandboxFileManifestEntry["kind"];

function fixed(paths: readonly string[]) {
  return () => paths;
}

function kinds(...values: SandboxOutputKind[]): readonly SandboxOutputKind[] {
  return Object.freeze(values);
}

export const SANDBOX_WORKER_DEFINITIONS = Object.freeze({
  "browser-capture.v1": Object.freeze({
    id: "browser-capture.v1",
    version: 1,
    profileId: "browser",
    executable: "/opt/avermate/bin/browser-capture",
    argv: Object.freeze([
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/render.json",
    ]),
    inputSchema: browserCaptureWorkerManifestV1Schema,
    outputSchema: browserRenderWorkerOutputSchema,
    resultPath: "output/render.json",
    outputPaths: fixed(["output/render.json"]),
    allowedKinds: kinds("json"),
    maximumFiles: 1,
    maximumFileBytes: 6 * MIB,
    maximumTotalBytes: 6 * MIB,
  }),
  "corpus-derivatives.v1": Object.freeze({
    id: "corpus-derivatives.v1",
    version: 1,
    profileId: "media",
    executable: "/opt/avermate/bin/corpus-derivatives",
    argv: Object.freeze([
      "--input",
      "/workspace/input/request.json",
      "--manifest",
      "/workspace/output/derivatives.json",
    ]),
    inputSchema: corpusDerivativeWorkerManifestV1Schema,
    outputSchema: corpusDerivativeWorkerOutputV1Schema,
    resultPath: "output/derivatives.json",
    outputPaths: (value: unknown) => {
      const result = corpusDerivativeWorkerOutputV1Schema.parse(value);
      const files =
        result.kind === "pdf"
          ? result.units.flatMap((unit) => [unit.pdf.path, unit.image.path])
          : result.kind === "image"
            ? [result.image.path]
            : result.kind === "media-probe"
              ? []
              : result.units.map((unit) => unit.file.path);
      return Object.freeze([...files, "output/derivatives.json"]);
    },
    allowedKinds: kinds("pdf", "png", "mp3", "mp4", "json"),
    maximumFiles: 129,
    maximumFileBytes: 100 * MIB,
    maximumTotalBytes: 512 * MIB,
  }),
  "video-audio-extract.v1": Object.freeze({
    id: "video-audio-extract.v1",
    version: 1,
    profileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: Object.freeze([
      "extract-video-audio",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/audio.wav",
      "--manifest",
      "/workspace/output/extraction.json",
    ]),
    inputSchema: videoAudioExtractWorkerManifestV1Schema,
    outputSchema: videoAudioExtractWorkerOutputV1Schema,
    resultPath: "output/extraction.json",
    outputPaths: fixed(["output/audio.wav", "output/extraction.json"]),
    allowedKinds: kinds("wav", "json"),
    maximumFiles: 2,
    maximumFileBytes: 512 * MIB,
    maximumTotalBytes: 512 * MIB + MIB,
  }),
  "media-segment.v1": Object.freeze({
    id: "media-segment.v1",
    version: 1,
    profileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: Object.freeze([
      "extract-segments",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output",
      "--manifest",
      "/workspace/output/segments.json",
    ]),
    inputSchema: mediaSegmentWorkerManifestV1Schema,
    outputSchema: mediaSegmentWorkerOutputV1Schema,
    resultPath: "output/segments.json",
    outputPaths: (value: unknown) => {
      const result = mediaSegmentWorkerOutputV1Schema.parse(value);
      return Object.freeze([
        ...result.segments.map((segment) => segment.file.path),
        "output/segments.json",
      ]);
    },
    allowedKinds: kinds("mp3", "json"),
    maximumFiles: 1_001,
    maximumFileBytes: 128 * MIB,
    maximumTotalBytes: 2 * GIB,
  }),
  "media-timeline-render.v1": Object.freeze({
    id: "media-timeline-render.v1",
    version: 1,
    profileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: Object.freeze([
      "render-timeline",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/video.mp4",
      "--manifest",
      "/workspace/output/render.json",
    ]),
    inputSchema: mediaTimelineRenderWorkerManifestV1Schema,
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
  }),
  "material-preview.v1": Object.freeze({
    id: "material-preview.v1",
    version: 1,
    profileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: Object.freeze([
      "material-preview",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/preview.webp",
      "--manifest",
      "/workspace/output/preview.json",
    ]),
    inputSchema: materialPreviewWorkerManifestV1Schema,
    outputSchema: materialPreviewWorkerOutputV1Schema,
    resultPath: "output/preview.json",
    outputPaths: fixed(["output/preview.webp", "output/preview.json"]),
    allowedKinds: kinds("webp", "json"),
    maximumFiles: 2,
    maximumFileBytes: 8 * MIB,
    maximumTotalBytes: 9 * MIB,
  }),
  "manim-build.v1": Object.freeze({
    id: "manim-build.v1",
    version: 1,
    profileId: "manim",
    executable: "/opt/avermate/bin/manim-build",
    argv: Object.freeze([
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/scene.mp4",
      "--manifest",
      "/workspace/output/render.json",
    ]),
    inputSchema: manimWorkerManifestV1Schema,
    outputSchema: manimWorkerOutputV1Schema,
    resultPath: "output/render.json",
    outputPaths: fixed(["output/scene.mp4", "output/render.json"]),
    allowedKinds: kinds("mp4", "json"),
    maximumFiles: 2,
    maximumFileBytes: 512 * MIB,
    maximumTotalBytes: 513 * MIB,
  }),
  "latex-build.v1": Object.freeze({
    id: "latex-build.v1",
    version: 1,
    profileId: "latex",
    executable: "/opt/avermate/bin/latex-build",
    argv: Object.freeze([
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/document.pdf",
      "--manifest",
      "/workspace/output/build.json",
    ]),
    inputSchema: latexWorkerManifestV1Schema,
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
  }),
  "slides-build.v1": Object.freeze({
    id: "slides-build.v1",
    version: 1,
    profileId: "slides",
    executable: "/opt/avermate/bin/slides-build",
    argv: Object.freeze([
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/slides.pdf",
      "--manifest",
      "/workspace/output/build.json",
    ]),
    inputSchema: slidesWorkerManifestV1Schema,
    outputSchema: slidesWorkerOutputV1Schema,
    resultPath: "output/build.json",
    outputPaths: fixed(["output/slides.pdf", "output/build.json"]),
    allowedKinds: kinds("pdf", "json"),
    maximumFiles: 2,
    maximumFileBytes: 512 * MIB,
    maximumTotalBytes: 513 * MIB,
  }),
} satisfies Readonly<Record<SandboxWorkerId, SandboxWorkerDefinition>>);

export function resolveSandboxWorkerDefinition(input: {
  workerId: SandboxWorkerId;
  profileId: SandboxProfileId;
  executable: string;
  argv: readonly string[];
}): SandboxWorkerDefinition {
  const found = SANDBOX_WORKER_DEFINITIONS[input.workerId];
  if (
    found.profileId !== input.profileId ||
    found.executable !== input.executable ||
    !exactVector(found.argv, input.argv)
  ) {
    throw new Error("SANDBOX_WORKER_DEFINITION_NOT_ALLOWED");
  }
  return found;
}

function exactVector(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
