import { z } from "zod";
import {
  browserRenderWorkerInputSchema,
  videoAudioExtractWorkerInputSchema,
  videoAudioSegmentExtractWorkerInputSchema,
  videoTimelineV1Schema,
} from "./media";
import { sandboxWorkspaceSnapshotRefSchema } from "./sandbox";

const MIB = 1024 * 1024;
const sha256Digest = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "expected a lowercase sha256 digest");
const policyDigest = sha256Digest;
const boundedLanguage = z.string().trim().min(2).max(35);
const outputPath = z
  .string()
  .regex(/^output\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/u)
  .max(512)
  .refine(
    (value) => value.split("/").every((part) => part !== "." && part !== ".."),
    "output paths must not contain traversal segments",
  );

export const sandboxWorkerOutputFileSchema = z.strictObject({
  path: outputPath,
  digest: sha256Digest,
  byteSize: z.number().int().nonnegative().max(2 * 1024 ** 3),
  mimeType: z.string().trim().min(1).max(255),
});
export type SandboxWorkerOutputFile = z.infer<
  typeof sandboxWorkerOutputFileSchema
>;

export const browserCaptureWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("browser-capture.v1"),
  request: browserRenderWorkerInputSchema,
  egressPolicyDigest: policyDigest,
});
export type BrowserCaptureWorkerManifestV1 = z.infer<
  typeof browserCaptureWorkerManifestV1Schema
>;

export const videoAudioExtractWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("video-audio-extract.v1"),
  request: videoAudioExtractWorkerInputSchema,
  requestedLanguage: boundedLanguage,
  consentRevision: z.string().trim().min(1).max(128),
  egressPolicyDigest: policyDigest,
});
export type VideoAudioExtractWorkerManifestV1 = z.infer<
  typeof videoAudioExtractWorkerManifestV1Schema
>;

export const videoAudioExtractWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("video-audio-extract.v1"),
  audio: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/audio.wav"),
    mimeType: z.literal("audio/wav"),
  }),
  durationMs: z.number().int().positive().max(4 * 60 * 60_000),
  codec: z.literal("pcm_s16le"),
  sampleRate: z.literal(16_000),
  channels: z.literal(1),
});
export type VideoAudioExtractWorkerOutputV1 = z.infer<
  typeof videoAudioExtractWorkerOutputV1Schema
>;

export const videoAudioExtractWorkerManifestV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  worker: z.literal("video-audio-extract.v2"),
  request: videoAudioSegmentExtractWorkerInputSchema,
  requestedLanguage: boundedLanguage,
  consentRevision: z.string().trim().min(1).max(128),
  egressPolicyDigest: policyDigest,
});
export type VideoAudioExtractWorkerManifestV2 = z.infer<
  typeof videoAudioExtractWorkerManifestV2Schema
>;

const transcriptionSegmentFileSchema = sandboxWorkerOutputFileSchema.extend({
  path: z.string().regex(/^output\/audio-segment-\d{3}\.mp3$/u),
  byteSize: z.number().int().positive().max(32 * MIB),
  mimeType: z.literal("audio/mpeg"),
});

export const videoAudioExtractWorkerOutputV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    worker: z.literal("video-audio-extract.v2"),
    durationMs: z.number().int().positive().max(4 * 60 * 60_000),
    codec: z.literal("mp3"),
    bitrateKbps: z.literal(48),
    sampleRate: z.literal(16_000),
    channels: z.literal(1),
    segments: z
      .array(
        z.strictObject({
          index: z.number().int().nonnegative().max(239),
          startMs: z.number().int().nonnegative(),
          endMs: z.number().int().positive(),
          audio: transcriptionSegmentFileSchema,
        }),
      )
      .min(1)
      .max(240),
  })
  .superRefine((output, context) => {
    let previousEnd = 0;
    output.segments.forEach((segment, index) => {
      const expectedPath = `output/audio-segment-${String(index).padStart(3, "0")}.mp3`;
      if (
        segment.index !== index ||
        segment.startMs !== previousEnd ||
        segment.endMs <= segment.startMs ||
        segment.audio.path !== expectedPath
      ) {
        context.addIssue({
          code: "custom",
          path: ["segments", index],
          message:
            "audio segments must be ordered, contiguous, non-empty and canonically named",
        });
      }
      previousEnd = segment.endMs;
    });
    if (previousEnd !== output.durationMs) {
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "duration must equal the final audio segment boundary",
      });
    }
  });
export type VideoAudioExtractWorkerOutputV2 = z.infer<
  typeof videoAudioExtractWorkerOutputV2Schema
>;

const localDocumentAiSourceSchema = z.strictObject({
  path: z.literal("input/source"),
  digest: sha256Digest,
  byteSize: z.number().int().positive().max(50 * MIB),
  mimeType: z.enum([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]),
});

/** Stable catalogue identities used to fence offline document-AI workers. */
export const LOCAL_OCR_MODEL_ID = "tesseract-ocr" as const;
export const LOCAL_TRANSCRIPTION_MODEL_ID =
  "selfhost/whisper-large-v3-turbo-q5_0" as const;

/** Offline OCR request. The profile/image digest attests the fixed engines and data. */
export const localOcrWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("local-ocr.v1"),
  source: localDocumentAiSourceSchema,
  language: z.string().trim().regex(/^[a-z]{3}(?:\+[a-z]{3}){0,3}$/u),
  maximumPages: z.number().int().min(1).max(1_000),
  maximumPixelsPerPage: z.number().int().min(1).max(100_000_000),
  maximumTotalPixels: z.number().int().min(1).max(5_000_000_000),
  modelId: z.literal(LOCAL_OCR_MODEL_ID),
  modelRevision: z.string().trim().min(7).max(256),
});
export type LocalOcrWorkerManifestV1 = z.infer<
  typeof localOcrWorkerManifestV1Schema
>;

export const localOcrWorkerOutputV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    worker: z.literal("local-ocr.v1"),
    sourceDigest: sha256Digest,
    modelId: z.literal(LOCAL_OCR_MODEL_ID),
    modelRevision: z.string().trim().min(7).max(256),
    engine: z.literal("tesseract+poppler"),
    networkAccess: z.literal(false),
    pageCount: z.number().int().min(1).max(1_000),
    pages: z
      .array(
        z.strictObject({
          providerIndex: z.number().int().nonnegative().max(999),
          markdown: z.string().max(512 * 1024),
          width: z.number().int().positive().max(100_000),
          height: z.number().int().positive().max(100_000),
        }),
      )
      .min(1)
      .max(1_000),
  })
  .superRefine((output, context) => {
    if (
      output.pageCount !== output.pages.length ||
      output.pages.some((page, index) => page.providerIndex !== index)
    ) {
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message: "OCR pages must be complete, contiguous and zero-indexed",
      });
    }
  });
export type LocalOcrWorkerOutputV1 = z.infer<
  typeof localOcrWorkerOutputV1Schema
>;

const localTranscriptionSourceSchema = z.strictObject({
  path: z.literal("input/source"),
  digest: sha256Digest,
  byteSize: z.number().int().positive().max(32 * MIB),
  mimeType: z.enum([
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/m4a",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
  ]),
});

/** Object-lane local STT request; audio bytes never enter a control frame. */
export const localTranscriptionWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("local-transcription.v1"),
  source: localTranscriptionSourceSchema,
  modelId: z.literal(LOCAL_TRANSCRIPTION_MODEL_ID),
  modelRevision: z.string().trim().min(7).max(256),
  language: boundedLanguage.optional(),
  maximumSeconds: z.number().int().min(1).max(2 * 60 * 60),
  timestamps: z.literal("segment"),
});
export type LocalTranscriptionWorkerManifestV1 = z.infer<
  typeof localTranscriptionWorkerManifestV1Schema
>;

const localTranscriptionSegmentSchema = z
  .strictObject({
    startMs: z.number().int().nonnegative().max(2 * 60 * 60_000),
    endMs: z.number().int().positive().max(2 * 60 * 60_000),
    text: z.string().max(32_000),
  })
  .refine((segment) => segment.endMs >= segment.startMs, {
    message: "transcription segment timestamps must be ordered",
  });

export const localTranscriptionWorkerOutputV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    worker: z.literal("local-transcription.v1"),
    sourceDigest: sha256Digest,
    modelId: z.literal(LOCAL_TRANSCRIPTION_MODEL_ID),
    modelRevision: z.string().trim().min(7).max(256),
    engine: z.literal("whisper.cpp"),
    networkAccess: z.literal(false),
    text: z.string().max(2 * MIB),
    language: z.string().trim().min(2).max(35),
    durationMs: z.number().int().positive().max(2 * 60 * 60_000),
    segments: z.array(localTranscriptionSegmentSchema).max(20_000),
  })
  .superRefine((output, context) => {
    let previousStart = 0;
    output.segments.forEach((segment, index) => {
      if (
        segment.startMs < previousStart ||
        segment.endMs > output.durationMs + 2_000
      ) {
        context.addIssue({
          code: "custom",
          path: ["segments", index],
          message: "transcription segments must be monotonic and duration-bound",
        });
      }
      previousStart = segment.startMs;
    });
  });
export type LocalTranscriptionWorkerOutputV1 = z.infer<
  typeof localTranscriptionWorkerOutputV1Schema
>;

export const mediaSegmentWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("media-segment.v1"),
  source: z.strictObject({
    path: z.literal("input/source"),
    digest: sha256Digest,
    byteSize: z.number().int().positive().max(2 * 1024 ** 3),
    mimeType: z
      .string()
      .regex(/^(?:audio|video)\/[a-zA-Z0-9.+-]+$/u)
      .max(255),
  }),
  segmentSeconds: z.number().int().min(60).max(20 * 60),
  maxDurationSeconds: z.number().int().min(1).max(8 * 60 * 60),
  outputCodec: z.literal("mp3-mono-16khz"),
});
export type MediaSegmentWorkerManifestV1 = z.infer<
  typeof mediaSegmentWorkerManifestV1Schema
>;

export const mediaSegmentWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("media-segment.v1"),
  durationMs: z.number().int().positive().max(8 * 60 * 60_000),
  segments: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative().max(999),
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
        file: sandboxWorkerOutputFileSchema.extend({
          path: z
            .string()
            .regex(/^output\/segment-\d{3}\.mp3$/u),
          mimeType: z.literal("audio/mpeg"),
        }),
      }),
    )
    .min(1)
    .max(1_000),
}).superRefine((output, context) => {
  let previousEnd = 0;
  output.segments.forEach((segment, index) => {
    if (
      segment.index !== index ||
      segment.startMs !== previousEnd ||
      segment.endMs <= segment.startMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["segments", index],
        message: "media segments must be ordered, contiguous and non-empty",
      });
    }
    previousEnd = segment.endMs;
  });
  if (previousEnd !== output.durationMs) {
    context.addIssue({
      code: "custom",
      path: ["durationMs"],
      message: "duration must equal the last segment boundary",
    });
  }
});
export type MediaSegmentWorkerOutputV1 = z.infer<
  typeof mediaSegmentWorkerOutputV1Schema
>;

export const materialPreviewWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("material-preview.v1"),
  source: z.strictObject({
    path: z.literal("input/source"),
    digest: sha256Digest,
    byteSize: z.number().int().positive().max(100 * MIB),
    mimeType: z.enum([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
  }),
  maximumDimension: z.number().int().min(64).max(2_048),
});
export type MaterialPreviewWorkerManifestV1 = z.infer<
  typeof materialPreviewWorkerManifestV1Schema
>;

export const materialPreviewWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("material-preview.v1"),
  preview: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/preview.webp"),
    mimeType: z.literal("image/webp"),
  }),
  width: z.number().int().positive().max(2_048),
  height: z.number().int().positive().max(2_048),
});
export type MaterialPreviewWorkerOutputV1 = z.infer<
  typeof materialPreviewWorkerOutputV1Schema
>;

const corpusDerivativeUnitId = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u);
const corpusDerivativeSourceSchema = z.strictObject({
  path: z.literal("input/source"),
  digest: sha256Digest,
  byteSize: z.number().int().positive().max(500 * MIB),
  mimeType: z.enum([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/mpeg",
    "audio/mp4",
    "audio/m4a",
    "audio/wav",
    "audio/ogg",
    "audio/webm",
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ]),
});

const pdfDerivativeRequestSchema = z.strictObject({
  kind: z.literal("pdf"),
  maximumDimension: z.number().int().min(256).max(2_048),
  units: z
    .array(
      z.strictObject({
        unitId: corpusDerivativeUnitId,
        page: z.number().int().positive().max(10_000),
      }),
    )
    .min(1)
    .max(64),
});
const imageDerivativeRequestSchema = z.strictObject({
  kind: z.literal("image"),
  maximumDimension: z.number().int().min(256).max(4_096),
  unitId: corpusDerivativeUnitId,
});
const timedDerivativeUnitSchema = z
  .strictObject({
    unitId: corpusDerivativeUnitId,
    startMs: z.number().int().nonnegative().max(8 * 60 * 60_000),
    endMs: z.number().int().positive().max(8 * 60 * 60_000),
  })
  .refine((unit) => unit.endMs > unit.startMs, {
    message: "a media derivative window must be non-empty",
  });
const audioDerivativeRequestSchema = z.strictObject({
  kind: z.literal("audio"),
  units: z.array(timedDerivativeUnitSchema).min(1).max(64),
});
const videoDerivativeRequestSchema = z.strictObject({
  kind: z.literal("video"),
  maximumDimension: z.number().int().min(256).max(1_280),
  units: z.array(timedDerivativeUnitSchema).min(1).max(64),
});
const mediaProbeDerivativeRequestSchema = z.strictObject({
  kind: z.literal("media-probe"),
  modality: z.enum(["audio", "video"]),
});

/** Exact multimodal units requested by the Core from an attested, no-egress worker. */
export const corpusDerivativeWorkerManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    worker: z.literal("corpus-derivatives.v1"),
    source: corpusDerivativeSourceSchema,
    request: z.discriminatedUnion("kind", [
      pdfDerivativeRequestSchema,
      imageDerivativeRequestSchema,
      audioDerivativeRequestSchema,
      videoDerivativeRequestSchema,
      mediaProbeDerivativeRequestSchema,
    ]),
  })
  .superRefine((manifest, context) => {
    const mime = manifest.source.mimeType;
    const valid =
      (manifest.request.kind === "pdf" && mime === "application/pdf") ||
      (manifest.request.kind === "image" && mime.startsWith("image/")) ||
      (manifest.request.kind === "audio" && mime.startsWith("audio/")) ||
      (manifest.request.kind === "video" && mime.startsWith("video/")) ||
      (manifest.request.kind === "media-probe" &&
        mime.startsWith(`${manifest.request.modality}/`));
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["request", "kind"],
        message: "derivative request kind must match the source media type",
      });
    }
    if (
      (manifest.request.kind === "audio" ||
        manifest.request.kind === "video") &&
      manifest.request.units.some(
        (unit) =>
          unit.endMs - unit.startMs >
          (manifest.request.kind === "audio" ? 180_000 : 120_000),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["request", "units"],
        message: "media derivative windows exceed the embedding input limit",
      });
    }
    if ("units" in manifest.request) {
      const ids = manifest.request.units.map((unit) => unit.unitId);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          path: ["request", "units"],
          message: "derivative unit ids must be unique",
        });
      }
      if (manifest.request.kind === "pdf") {
        const pages = manifest.request.units.map((unit) => unit.page);
        if (new Set(pages).size !== pages.length) {
          context.addIssue({
            code: "custom",
            path: ["request", "units"],
            message: "each PDF page may be requested only once",
          });
        }
      }
    }
  });
export type CorpusDerivativeWorkerManifestV1 = z.infer<
  typeof corpusDerivativeWorkerManifestV1Schema
>;

const pdfDerivativeOutputUnitSchema = z.strictObject({
  unitId: corpusDerivativeUnitId,
  page: z.number().int().positive().max(10_000),
  rotationDegrees: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  widthPoints: z.number().positive().max(100_000),
  heightPoints: z.number().positive().max(100_000),
  pdf: sandboxWorkerOutputFileSchema.extend({
    path: z.string().regex(/^output\/page-\d{5}\.pdf$/u),
    mimeType: z.literal("application/pdf"),
  }),
  image: sandboxWorkerOutputFileSchema.extend({
    path: z.string().regex(/^output\/page-\d{5}\.png$/u),
    mimeType: z.literal("image/png"),
  }),
});
const timedDerivativeOutputUnitSchema = z.strictObject({
  unitId: corpusDerivativeUnitId,
  index: z.number().int().nonnegative().max(999),
  startMs: z.number().int().nonnegative().max(8 * 60 * 60_000),
  endMs: z.number().int().positive().max(8 * 60 * 60_000),
  file: sandboxWorkerOutputFileSchema,
});

export const corpusDerivativeWorkerOutputV1Schema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      schemaVersion: z.literal(1),
      worker: z.literal("corpus-derivatives.v1"),
      kind: z.literal("pdf"),
      totalPages: z.number().int().positive().max(10_000),
      units: z.array(pdfDerivativeOutputUnitSchema).min(1).max(64),
    }),
    z.strictObject({
      schemaVersion: z.literal(1),
      worker: z.literal("corpus-derivatives.v1"),
      kind: z.literal("image"),
      unitId: corpusDerivativeUnitId,
      width: z.number().int().positive().max(4_096),
      height: z.number().int().positive().max(4_096),
      image: sandboxWorkerOutputFileSchema.extend({
        path: z.literal("output/image.png"),
        mimeType: z.literal("image/png"),
      }),
    }),
    z.strictObject({
      schemaVersion: z.literal(1),
      worker: z.literal("corpus-derivatives.v1"),
      kind: z.literal("media-probe"),
      modality: z.enum(["audio", "video"]),
      durationMs: z.number().int().positive().max(8 * 60 * 60_000),
    }),
    z.strictObject({
      schemaVersion: z.literal(1),
      worker: z.literal("corpus-derivatives.v1"),
      kind: z.literal("audio"),
      durationMs: z.number().int().positive().max(8 * 60 * 60_000),
      units: z
        .array(
          timedDerivativeOutputUnitSchema.extend({
            file: sandboxWorkerOutputFileSchema.extend({
              path: z.string().regex(/^output\/audio-\d{3}\.mp3$/u),
              mimeType: z.literal("audio/mpeg"),
            }),
          }),
        )
        .min(1)
        .max(64),
    }),
    z.strictObject({
      schemaVersion: z.literal(1),
      worker: z.literal("corpus-derivatives.v1"),
      kind: z.literal("video"),
      durationMs: z.number().int().positive().max(8 * 60 * 60_000),
      units: z
        .array(
          timedDerivativeOutputUnitSchema.extend({
            file: sandboxWorkerOutputFileSchema.extend({
              path: z.string().regex(/^output\/video-\d{3}\.mp4$/u),
              mimeType: z.literal("video/mp4"),
            }),
          }),
        )
        .min(1)
        .max(64),
    }),
  ],
);
export type CorpusDerivativeWorkerOutputV1 = z.infer<
  typeof corpusDerivativeWorkerOutputV1Schema
>;

export const timelineAssetV1Schema = z.strictObject({
  artifactRevisionId: z.string().trim().min(1).max(256),
  digest: sha256Digest,
  byteSize: z.number().int().positive().max(2 * 1024 ** 3),
  path: z.string().regex(/^input\/assets\/[a-zA-Z0-9._-]+$/u).max(512),
  mimeType: z.enum(["image/png", "image/jpeg", "audio/mpeg", "audio/wav"]),
});

export const mediaTimelineRenderWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("media-timeline-render.v1"),
  timeline: videoTimelineV1Schema,
  assets: z.array(timelineAssetV1Schema).min(1).max(2_000),
  videoCodec: z.literal("h264"),
  audioCodec: z.literal("aac"),
  maximumOutputBytes: z.number().int().positive().max(2 * 1024 ** 3),
}).superRefine((manifest, context) => {
  const assets = new Map(
    manifest.assets.map((asset) => [
      `${asset.artifactRevisionId}\0${asset.digest}`,
      asset,
    ]),
  );
  if (assets.size !== manifest.assets.length) {
    context.addIssue({
      code: "custom",
      path: ["assets"],
      message: "timeline assets must have unique revision/digest pairs",
    });
  }
  manifest.timeline.scenes.forEach((scene, index) => {
    const visual = assets.get(
      `${scene.visual.artifactRevisionId}\0sha256:${scene.visual.digest}`,
    );
    if (!visual || !visual.mimeType.startsWith("image/")) {
      context.addIssue({
        code: "custom",
        path: ["timeline", "scenes", index, "visual"],
        message: "each visual must resolve to an exact image asset",
      });
    }
    if (scene.narration) {
      const narration = assets.get(
        `${scene.narration.artifactRevisionId}\0sha256:${scene.narration.digest}`,
      );
      if (!narration || !narration.mimeType.startsWith("audio/")) {
        context.addIssue({
          code: "custom",
          path: ["timeline", "scenes", index, "narration"],
          message: "each narration must resolve to an exact audio asset",
        });
      }
    }
  });
});
export type MediaTimelineRenderWorkerManifestV1 = z.infer<
  typeof mediaTimelineRenderWorkerManifestV1Schema
>;

export const mediaTimelineRenderWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("media-timeline-render.v1"),
  video: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/video.mp4"),
    mimeType: z.literal("video/mp4"),
  }),
  captions: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/captions.vtt"),
    mimeType: z.literal("text/vtt"),
  }),
  poster: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/poster.png"),
    mimeType: z.literal("image/png"),
  }),
  durationMs: z.number().int().positive().max(24 * 60 * 60_000),
  width: z.literal(1_920),
  height: z.literal(1_080),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  videoCodec: z.literal("h264"),
  audioCodec: z.literal("aac"),
});
export type MediaTimelineRenderWorkerOutputV1 = z.infer<
  typeof mediaTimelineRenderWorkerOutputV1Schema
>;

const scalar = z.number().finite().min(-10_000).max(10_000);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/u);
const manimObjectId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u);

export const manimSceneDslV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  durationMs: z.number().int().min(250).max(5 * 60_000),
  background: color.default("#000000"),
  objects: z.array(z.discriminatedUnion("kind", [
    z.strictObject({
      id: manimObjectId,
      kind: z.literal("text"),
      text: z.string().min(1).max(1_000),
      x: scalar,
      y: scalar,
      color,
    }),
    z.strictObject({
      id: manimObjectId,
      kind: z.literal("line"),
      from: z.tuple([scalar, scalar]),
      to: z.tuple([scalar, scalar]),
      color,
    }),
    z.strictObject({
      id: manimObjectId,
      kind: z.literal("circle"),
      center: z.tuple([scalar, scalar]),
      radius: z.number().positive().max(10_000),
      color,
    }),
  ])).min(1).max(250),
  animations: z.array(z.strictObject({
    objectId: manimObjectId,
    effect: z.enum(["appear", "fade-in", "fade-out", "move", "draw"]),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive().max(60_000),
    to: z.tuple([scalar, scalar]).optional(),
  })).max(1_000),
}).superRefine((scene, context) => {
  const ids = new Set(scene.objects.map((object) => object.id));
  if (ids.size !== scene.objects.length) {
    context.addIssue({ code: "custom", path: ["objects"], message: "object IDs must be unique" });
  }
  scene.animations.forEach((animation, index) => {
    if (!ids.has(animation.objectId)) {
      context.addIssue({ code: "custom", path: ["animations", index, "objectId"], message: "animation object must exist" });
    }
    if (animation.startMs + animation.durationMs > scene.durationMs) {
      context.addIssue({ code: "custom", path: ["animations", index], message: "animation exceeds scene duration" });
    }
    if (animation.effect === "move" && !animation.to) {
      context.addIssue({ code: "custom", path: ["animations", index, "to"], message: "move requires a destination" });
    }
  });
});
export type ManimSceneDslV1 = z.infer<typeof manimSceneDslV1Schema>;

export const manimWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("manim-build.v1"),
  scene: manimSceneDslV1Schema,
  width: z.literal(1_920),
  height: z.literal(1_080),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
});
export type ManimWorkerManifestV1 = z.infer<typeof manimWorkerManifestV1Schema>;

export const manimWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("manim-build.v1"),
  video: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/scene.mp4"),
    mimeType: z.literal("video/mp4"),
  }),
  durationMs: z.number().int().positive().max(5 * 60_000),
  width: z.literal(1_920),
  height: z.literal(1_080),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
});
export type ManimWorkerOutputV1 = z.infer<typeof manimWorkerOutputV1Schema>;

export const latexWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("latex-build.v1"),
  source: z.strictObject({
    path: z.literal("input/main.tex"),
    digest: sha256Digest,
    byteSize: z.number().int().positive().max(8 * MIB),
  }),
  engine: z.literal("tectonic"),
  shellEscape: z.literal(false),
  maximumPages: z.number().int().min(1).max(1_000),
});
export type LatexWorkerManifestV1 = z.infer<typeof latexWorkerManifestV1Schema>;

export const latexWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("latex-build.v1"),
  pdf: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/document.pdf"),
    mimeType: z.literal("application/pdf"),
  }),
  log: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/build.log"),
    mimeType: z.literal("text/plain"),
  }),
  pageCount: z.number().int().positive().max(1_000),
  engine: z.literal("tectonic"),
});
export type LatexWorkerOutputV1 = z.infer<typeof latexWorkerOutputV1Schema>;

export const slidesWorkerManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("slides-build.v1"),
  source: z.strictObject({
    path: z.literal("input/source.pptx"),
    digest: sha256Digest,
    byteSize: z.number().int().positive().max(256 * MIB),
    mimeType: z.literal(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
  }),
  maximumSlides: z.number().int().min(1).max(1_000),
  renderPdf: z.literal(true),
});
export type SlidesWorkerManifestV1 = z.infer<typeof slidesWorkerManifestV1Schema>;

export const slidesWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: z.literal("slides-build.v1"),
  pdf: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/slides.pdf"),
    mimeType: z.literal("application/pdf"),
  }),
  slideCount: z.number().int().positive().max(1_000),
});
export type SlidesWorkerOutputV1 = z.infer<typeof slidesWorkerOutputV1Schema>;

export const specialistWorkerIdSchema = z.enum(["opencode", "openhands"]);
export type SpecialistWorkerId = z.infer<typeof specialistWorkerIdSchema>;

const specialistWorkspacePath = z
  .string()
  .regex(/^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/u)
  .max(512)
  .refine(
    (value) => value.split("/").every((part) => part !== "." && part !== ".."),
    "workspace paths must be relative and traversal-free",
  );

export const specialistWorkerManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    worker: specialistWorkerIdSchema,
    operation: z.enum(["create-artifact", "revise-artifact"]),
    jobId: z.string().min(1).max(256),
    ownerId: z.string().min(1).max(256),
    sourceWorkspaceSnapshot: sandboxWorkspaceSnapshotRefSchema,
    sourceRevisionDigest: sha256Digest,
    instruction: z.string().min(1).max(32_768),
    writableRoots: z
      .array(z.enum(["src", "assets", "tests", "output"]))
      .min(1)
      .max(4),
    reviewedCommands: z
      .array(
        z.strictObject({
          commandId: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/u),
          cwd: z.union([z.literal("."), specialistWorkspacePath]).default("."),
        }),
      )
      .max(50),
    expectedArtifacts: z
      .array(
        z.strictObject({
          path: outputPath,
          mimeType: z.string().trim().min(1).max(255),
        }),
      )
      .max(200)
      .default([]),
    dependencyPolicy: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("none") }),
      z.strictObject({
        mode: z.literal("frozen-lockfile"),
        lockfilePath: specialistWorkspacePath,
        lockfileDigest: sha256Digest,
      }),
    ]),
    egressPolicyDigest: policyDigest,
    toolGrantIds: z.array(z.string().min(1).max(256)).max(64),
    limits: z.strictObject({
      maximumInputBytes: z.number().int().positive().max(2 * 1024 ** 3),
      maximumOutputBytes: z.number().int().positive().max(2 * 1024 ** 3),
      maximumCommands: z.number().int().positive().max(1_000),
      deadline: z.iso.datetime({ offset: true }),
    }),
    reviewRequired: z.literal(true),
  })
  .superRefine((manifest, context) => {
    if (manifest.reviewedCommands.length > manifest.limits.maximumCommands) {
      context.addIssue({
        code: "custom",
        path: ["reviewedCommands"],
        message: "reviewed command count exceeds the immutable job limit",
      });
    }
    const reserved = new Set([
      "output/review.patch",
      "output/worker.log",
      "output/result.json",
    ]);
    const seen = new Set<string>();
    manifest.expectedArtifacts.forEach((artifact, index) => {
      if (reserved.has(artifact.path) || seen.has(artifact.path)) {
        context.addIssue({
          code: "custom",
          path: ["expectedArtifacts", index, "path"],
          message: "specialist artifact paths must be unique and cannot use reserved outputs",
        });
      }
      seen.add(artifact.path);
    });
  });
export type SpecialistWorkerManifestV1 = z.infer<
  typeof specialistWorkerManifestV1Schema
>;

export const specialistWorkerOutputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  worker: specialistWorkerIdSchema,
  jobId: z.string().min(1).max(256),
  sourceWorkspaceSnapshot: sandboxWorkspaceSnapshotRefSchema,
  resultWorkspaceSnapshot: sandboxWorkspaceSnapshotRefSchema,
  sourceRevisionDigest: sha256Digest,
  patch: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/review.patch"),
    mimeType: z.literal("text/x-diff"),
  }),
  log: sandboxWorkerOutputFileSchema.extend({
    path: z.literal("output/worker.log"),
    mimeType: z.literal("text/plain"),
  }),
  artifacts: z.array(sandboxWorkerOutputFileSchema).max(1_000),
  commands: z
    .array(
      z.strictObject({
        commandId: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/u),
        exitCode: z.number().int().min(0).max(255),
        stdoutTruncated: z.boolean(),
        stderrTruncated: z.boolean(),
      }),
    )
    .max(1_000),
  externalChangeProposals: z
    .array(
      z.strictObject({
        approvalRequestId: z.string().min(1).max(256),
        kind: z.string().min(1).max(128),
        summary: z.string().min(1).max(1_000),
      }),
    )
    .max(100),
  reviewRequired: z.literal(true),
  sessionHistoryImported: z.literal(false),
});
export type SpecialistWorkerOutputV1 = z.infer<
  typeof specialistWorkerOutputV1Schema
>;
