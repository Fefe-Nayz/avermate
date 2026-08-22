import { z } from "zod";
import { sourceLocatorV1Schema } from "./corpus";

const opaqueId = z.string().trim().min(1).max(256);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const imageDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const boundedUrl = z.url().max(4_096);

export const ingestionStrategySchema = z.enum([
  "static-html",
  "browser-render",
  "pdf",
  "youtube",
]);
export type IngestionStrategy = z.infer<typeof ingestionStrategySchema>;

/** Stable, non-secret reasons shared by jobs, tools and Web presentation. */
export const ingestionReasonCodeSchema = z.enum([
  "static_empty",
  "dynamic_required",
  "blocked_destination",
  "authentication_required",
  "content_too_large",
  "publisher_denied",
  "unsupported_content",
  "captions_unavailable",
  "permission_required",
  "extractor_blocked",
  "duration_limit",
  "transcription_unavailable",
  "upstream_changed",
  "placement_unavailable",
  "capability_disabled",
  "request_limit",
  "cancelled",
  "internal_failure",
]);
export type IngestionReasonCode = z.infer<typeof ingestionReasonCodeSchema>;

export const ingestionLimitsSchema = z.strictObject({
  maxNavigations: z.number().int().min(1).max(16).default(8),
  maxRequests: z.number().int().min(1).max(500).default(250),
  maxResponseBytes: z
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .default(16 * 1024 * 1024),
  deadlineMs: z.number().int().min(100).max(120_000).default(20_000),
  maxOrigins: z.number().int().min(1).max(32).default(8),
});
export type IngestionLimits = z.infer<typeof ingestionLimitsSchema>;

export const ingestionRequestSchema = z.strictObject({
  sourceId: opaqueId,
  canonicalUrl: boundedUrl,
  strategy: ingestionStrategySchema,
  limits: ingestionLimitsSchema,
  policyRef: opaqueId,
  language: z.string().trim().min(2).max(35).optional(),
});
export type IngestionRequest = z.infer<typeof ingestionRequestSchema>;

export const capturedAssetSchema = z.strictObject({
  assetId: opaqueId,
  fileId: opaqueId,
  originalUrl: boundedUrl,
  locator: sourceLocatorV1Schema.optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
  digest: sha256Hex,
  attribution: z.string().trim().max(1_000).nullable().default(null),
  storagePlacement: z.enum(["core", "node"]),
  captureState: z.enum(["stored", "blocked", "missing"]),
});
export type CapturedAsset = z.infer<typeof capturedAssetSchema>;

export const ingestionCitationSchema = z.strictObject({
  locator: sourceLocatorV1Schema,
  textDigest: sha256Hex.optional(),
});
export type IngestionCitation = z.infer<typeof ingestionCitationSchema>;

export const ingestionDiagnosticsSchema = z.strictObject({
  strategy: ingestionStrategySchema,
  rendererBuildDigest: imageDigest.nullable().default(null),
  redirectChain: z.array(boundedUrl).max(16),
  requestCount: z.number().int().nonnegative().max(500),
  inputBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  language: z.string().max(35).nullable().default(null),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  reasonCode: ingestionReasonCodeSchema.nullable().default(null),
});
export type IngestionDiagnostics = z.infer<typeof ingestionDiagnosticsSchema>;

export const ingestionResultSchema = z.strictObject({
  finalUrl: boundedUrl,
  title: z.string().trim().min(1).max(160),
  markdown: z.string().max(2 * 1024 * 1024),
  assets: z.array(capturedAssetSchema).max(250),
  citations: z.array(ingestionCitationSchema).max(20_000),
  diagnostics: ingestionDiagnosticsSchema,
});
export type IngestionResult = z.infer<typeof ingestionResultSchema>;

export const browserRenderWorkerInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  url: boundedUrl,
  wait: z.strictObject({
    kind: z.literal("dom-settled"),
    maxMs: z.number().int().min(100).max(15_000),
  }),
  maxNavigations: z.number().int().min(1).max(16),
  maxRequests: z.number().int().min(1).max(500),
  maxResponseBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  capture: z
    .array(z.enum(["readable-html", "metadata", "selected-images"]))
    .min(1)
    .max(3),
});
export type BrowserRenderWorkerInput = z.infer<
  typeof browserRenderWorkerInputSchema
>;

export const browserRenderWorkerOutputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  finalUrl: boundedUrl,
  redirectChain: z.array(boundedUrl).max(16),
  title: z.string().trim().min(1).max(160),
  language: z.string().trim().max(35).nullable(),
  readableHtml: z.string().max(5 * 1024 * 1024),
  requestCount: z.number().int().nonnegative().max(500),
  responseBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
  selectedImages: z
    .array(
      z.strictObject({
        url: boundedUrl,
        alt: z.string().max(500).default(""),
        locator: sourceLocatorV1Schema.optional(),
      }),
    )
    .max(250),
});
export type BrowserRenderWorkerOutput = z.infer<
  typeof browserRenderWorkerOutputSchema
>;

export const videoTranscriptSegmentSchema = z
  .strictObject({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().trim().min(1).max(8_000),
  })
  .refine(({ startMs, endMs }) => endMs > startMs, {
    message: "video transcript ranges must be non-empty",
  });
export type VideoTranscriptSegment = z.infer<
  typeof videoTranscriptSegmentSchema
>;

export const videoSourceResultSchema = z.strictObject({
  strategy: z.enum(["platform-captions", "extracted-audio"]),
  canonicalUrl: boundedUrl,
  mediaId: opaqueId,
  title: z.string().trim().min(1).max(160),
  channel: z.string().trim().max(160).nullable(),
  requestedLanguage: z.string().trim().min(2).max(35),
  selectedLanguage: z.string().trim().min(2).max(35),
  languageMismatch: z.boolean(),
  durationMs: z.number().int().positive().nullable(),
  adapterId: opaqueId,
  adapterVersion: z.string().trim().min(1).max(128),
  transcriptProvider: opaqueId.nullable(),
  transcriptModel: z.string().trim().min(1).max(256).nullable(),
  segments: z.array(videoTranscriptSegmentSchema).min(1).max(100_000),
});
export type VideoSourceResult = z.infer<typeof videoSourceResultSchema>;

export const videoAudioExtractWorkerInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  canonicalUrl: boundedUrl,
  provider: z.literal("youtube"),
  maxDurationSeconds: z.number().int().min(1).max(4 * 60 * 60),
  maxDownloadBytes: z.number().int().min(1).max(2 * 1024 ** 3),
  outputCodec: z.literal("wav-pcm-s16le"),
});
export type VideoAudioExtractWorkerInput = z.infer<
  typeof videoAudioExtractWorkerInputSchema
>;

export const generatedArtifactKindSchema = z.enum([
  "markdown",
  "latex-source",
  "pdf",
  "slides-source",
  "pptx",
  "quiz",
  "audio",
  "image",
  "anki",
  "html",
  "video-timeline",
  "video",
  "thumbnail",
]);
export type GeneratedArtifactKind = z.infer<
  typeof generatedArtifactKindSchema
>;

export const modelRunReferenceSchema = z.strictObject({
  runId: opaqueId,
  provider: opaqueId,
  model: z.string().trim().min(1).max(256),
  promptVersion: z.string().trim().min(1).max(128),
  usageRef: opaqueId.nullable().default(null),
});
export type ModelRunReference = z.infer<typeof modelRunReferenceSchema>;

export const generatedArtifactManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: generatedArtifactKindSchema,
    artifactId: opaqueId,
    artifactRevisionId: opaqueId,
    revision: z.number().int().positive(),
    parentArtifactRevisionIds: z.array(opaqueId).max(100),
    sourceVersionIds: z.array(opaqueId).max(5_000),
    workflow: z.strictObject({ id: opaqueId, version: z.number().int().positive() }),
    modelRuns: z.array(modelRunReferenceSchema).max(1_000),
    renderer: z.strictObject({
      profile: z.string().trim().min(1).max(128),
      imageDigest: imageDigest.nullable(),
      toolVersions: z.record(z.string().min(1).max(128), z.string().max(256)),
      reproducibility: z.enum(["full", "best-effort"]),
    }),
    output: z.strictObject({
      fileId: opaqueId.optional(),
      digest: sha256Hex,
      bytes: z.number().int().nonnegative().optional(),
      mime: z.string().trim().min(1).max(255),
    }),
  })
  .superRefine((manifest, context) => {
    if (new Set(manifest.parentArtifactRevisionIds).size !== manifest.parentArtifactRevisionIds.length) {
      context.addIssue({ code: "custom", path: ["parentArtifactRevisionIds"], message: "parent revisions must be unique" });
    }
    if (manifest.parentArtifactRevisionIds.includes(manifest.artifactRevisionId)) {
      context.addIssue({ code: "custom", path: ["parentArtifactRevisionIds"], message: "an artifact revision cannot parent itself" });
    }
  });
export type GeneratedArtifactManifestV1 = z.infer<
  typeof generatedArtifactManifestV1Schema
>;

export const artifactCitationReferenceV1Schema = z.strictObject({
  contentVersionReferenceId: opaqueId,
  sourceVersionId: opaqueId,
  chunkId: opaqueId.optional(),
  referenceKey: sha256Hex,
});
export type ArtifactCitationReferenceV1 = z.infer<
  typeof artifactCitationReferenceV1Schema
>;

export const captionCueSchema = z
  .strictObject({
    id: opaqueId,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().trim().min(1).max(2_000),
  })
  .refine(({ startMs, endMs }) => endMs > startMs, {
    message: "caption ranges must be non-empty",
  });
export type CaptionCue = z.infer<typeof captionCueSchema>;

export const videoTimelineV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    width: z.literal(1_920),
    height: z.literal(1_080),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
    scenes: z
      .array(
        z.strictObject({
          id: opaqueId,
          startMs: z.number().int().nonnegative(),
          durationMs: z.number().int().positive().max(60 * 60_000),
          visual: z.strictObject({
            artifactRevisionId: opaqueId,
            digest: sha256Hex,
            pageOrSlide: z.number().int().positive(),
          }),
          narration: z
            .strictObject({
              artifactRevisionId: opaqueId,
              digest: sha256Hex,
              clipId: opaqueId,
            })
            .optional(),
          captions: z.array(captionCueSchema).max(10_000),
          transition: z.enum(["cut", "crossfade"]),
          citations: z.array(artifactCitationReferenceV1Schema).max(1_000),
        }),
      )
      .min(1)
      .max(1_000),
  })
  .superRefine((timeline, context) => {
    const ids = new Set<string>();
    let expectedStart = 0;
    for (const [index, scene] of timeline.scenes.entries()) {
      if (ids.has(scene.id)) {
        context.addIssue({ code: "custom", path: ["scenes", index, "id"], message: "scene IDs must be unique" });
      }
      ids.add(scene.id);
      if (scene.startMs !== expectedStart) {
        context.addIssue({ code: "custom", path: ["scenes", index, "startMs"], message: "scenes must form a gap-free deterministic timeline" });
      }
      expectedStart = scene.startMs + scene.durationMs;
      for (const [cueIndex, cue] of scene.captions.entries()) {
        if (cue.endMs > scene.durationMs) {
          context.addIssue({ code: "custom", path: ["scenes", index, "captions", cueIndex], message: "caption cue exceeds its scene" });
        }
      }
    }
  });
export type VideoTimelineV1 = z.infer<typeof videoTimelineV1Schema>;

export const artifactWorkflowStatusSchema = z.enum([
  "planned",
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "superseded",
]);
export type ArtifactWorkflowStatus = z.infer<
  typeof artifactWorkflowStatusSchema
>;

export const artifactWorkflowStageSchema = z.strictObject({
  id: opaqueId,
  runId: opaqueId,
  key: z.string().trim().min(1).max(128),
  position: z.number().int().nonnegative(),
  status: artifactWorkflowStatusSchema,
  attempt: z.number().int().nonnegative(),
  inputDigest: sha256Hex,
  outputArtifactRevisionId: opaqueId.nullable(),
  jobId: opaqueId.nullable(),
  placement: z.enum(["core", "node", "unavailable"]),
  progress: z.strictObject({
    processed: z.number().nonnegative(),
    total: z.number().positive(),
    unit: z.string().trim().min(1).max(64),
    message: z.string().trim().max(500).nullable(),
  }),
  reasonCode: ingestionReasonCodeSchema.nullable(),
});
export type ArtifactWorkflowStage = z.infer<
  typeof artifactWorkflowStageSchema
>;

export const advancedMediaCapabilitySchema = z.enum([
  "dynamicWebRendering",
  "videoAudioExtraction",
  "mediaTimelineRendering",
  "manimRendering",
  "generatedThumbnails",
]);
export type AdvancedMediaCapability = z.infer<
  typeof advancedMediaCapabilitySchema
>;

export const advancedMediaProfileSchema = z.enum([
  "web-render.v1",
  "video-audio-extract.v1",
  "ffmpeg-render.v1",
  "manim.v1",
]);
export type AdvancedMediaProfile = z.infer<
  typeof advancedMediaProfileSchema
>;
