import { z } from "zod";
import {
  browserRenderWorkerInputSchema,
  videoAudioExtractWorkerInputSchema,
  videoTimelineV1Schema,
} from "./media";

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
