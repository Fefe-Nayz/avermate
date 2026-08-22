import { z } from "zod";
import { nodeArtifactRefSchema } from "./node";
import {
  browserCaptureWorkerManifestV1Schema,
  corpusDerivativeWorkerManifestV1Schema,
  latexWorkerManifestV1Schema,
  localOcrWorkerManifestV1Schema,
  localTranscriptionWorkerManifestV1Schema,
  manimWorkerManifestV1Schema,
  materialPreviewWorkerManifestV1Schema,
  mediaTimelineRenderWorkerManifestV1Schema,
  slidesWorkerManifestV1Schema,
  videoAudioExtractWorkerManifestV2Schema,
} from "./sandbox-workers";

export const NODE_ARTIFACT_JOB_BINDINGS = Object.freeze({
  "artifact.browser-render": "browser-capture.v1",
  "artifact.video-audio-extract": "video-audio-extract.v2",
  "artifact.local-ocr": "local-ocr.v1",
  "artifact.local-transcription": "local-transcription.v1",
  "artifact.render-video": "media-timeline-render.v1",
  "artifact.compose-thumbnail": "material-preview.v1",
  "artifact.corpus-derivatives": "corpus-derivatives.v1",
  "artifact.latex-build": "latex-build.v1",
  "artifact.slides-build": "slides-build.v1",
  "artifact.manim-build": "manim-build.v1",
} as const);

export const NODE_ARTIFACT_JOB_KINDS = Object.freeze(
  Object.keys(NODE_ARTIFACT_JOB_BINDINGS) as Array<
    keyof typeof NODE_ARTIFACT_JOB_BINDINGS
  >,
);
export type NodeArtifactJobKind = keyof typeof NODE_ARTIFACT_JOB_BINDINGS;
export type NodeArtifactWorkerId =
  (typeof NODE_ARTIFACT_JOB_BINDINGS)[NodeArtifactJobKind];

const executionContext = z.strictObject({
  threadId: z.string().trim().min(1).max(256),
  branchId: z.string().trim().min(1).max(256),
});
const inputPath = z
  .string()
  .regex(/^input\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/u)
  .max(512)
  .refine(
    (value) => value.split("/").every((part) => part !== "." && part !== ".."),
    "input paths must be relative and traversal-free",
  );
export const nodeArtifactWorkerInputV1Schema = z.strictObject({
  path: inputPath,
  artifact: nodeArtifactRefSchema,
});

const common = {
  schemaVersion: z.literal(1),
  execution: executionContext,
  inputs: z.array(nodeArtifactWorkerInputV1Schema).max(255),
} as const;

export const nodeArtifactWorkerRequestV1Schema = z
  .discriminatedUnion("worker", [
    z.strictObject({
      ...common,
      worker: z.literal("browser-capture.v1"),
      manifest: browserCaptureWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("video-audio-extract.v2"),
      manifest: videoAudioExtractWorkerManifestV2Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("local-ocr.v1"),
      manifest: localOcrWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("local-transcription.v1"),
      manifest: localTranscriptionWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("media-timeline-render.v1"),
      manifest: mediaTimelineRenderWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("material-preview.v1"),
      manifest: materialPreviewWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("corpus-derivatives.v1"),
      manifest: corpusDerivativeWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("latex-build.v1"),
      manifest: latexWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("slides-build.v1"),
      manifest: slidesWorkerManifestV1Schema,
    }),
    z.strictObject({
      ...common,
      worker: z.literal("manim-build.v1"),
      manifest: manimWorkerManifestV1Schema,
    }),
  ])
  .superRefine((request, context) => {
    const expected = expectedInputs(request);
    const actual = new Map(request.inputs.map((input) => [input.path, input]));
    if (actual.size !== request.inputs.length || actual.size !== expected.length) {
      context.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "worker input paths must be unique and exactly complete",
      });
      return;
    }
    for (const descriptor of expected) {
      const input = actual.get(descriptor.path);
      if (
        !input ||
        input.artifact.digest !== descriptor.digest ||
        input.artifact.byteSize !== descriptor.byteSize ||
        input.artifact.mimeType !== descriptor.mimeType
      ) {
        context.addIssue({
          code: "custom",
          path: ["inputs"],
          message:
            "every worker input must match the manifest path, digest, size and MIME type",
        });
      }
    }
  });

export type NodeArtifactWorkerRequestV1 = z.infer<
  typeof nodeArtifactWorkerRequestV1Schema
>;

type InputDescriptor = {
  path: string;
  digest: string;
  byteSize: number;
  mimeType: string;
};

function expectedInputs(
  request: z.infer<typeof nodeArtifactWorkerRequestV1Schema>,
): readonly InputDescriptor[] {
  switch (request.worker) {
    case "browser-capture.v1":
    case "video-audio-extract.v2":
    case "manim-build.v1":
      return [];
    case "local-ocr.v1":
    case "local-transcription.v1":
      return [request.manifest.source];
    case "media-timeline-render.v1":
      return request.manifest.assets.map((asset) => ({
        path: asset.path,
        digest: asset.digest,
        byteSize: asset.byteSize,
        mimeType: asset.mimeType,
      }));
    case "material-preview.v1":
    case "corpus-derivatives.v1":
      return [request.manifest.source];
    case "latex-build.v1":
      return [
        {
          ...request.manifest.source,
          mimeType: "text/x-tex",
        },
      ];
    case "slides-build.v1":
      return [request.manifest.source];
  }
}
