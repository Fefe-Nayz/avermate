import { describe, expect, test } from "bun:test";
import { manifestFromLegacyDocumentArtifact } from "./artifact-manifest";
import { BrowserRenderDispatcher } from "./browser-renderer";
import { validateManimSceneDsl } from "./manim-dsl";
import {
  markdownIngestionCitations,
  referencedArticleImages,
  StaticHtmlIngestionAdapter,
} from "./static-html";
import {
  buildFfmpegTimelineArgv,
  captionsFromTimeline,
  validateVideoTimeline,
} from "./timeline";
import {
  BrowserNetworkPolicySession,
  PublicIngestionUrlPolicy,
} from "./url-policy";
import {
  VideoSourceAdapter,
  type PlatformCaptionProvider,
} from "./video-source-adapter";
import { SandboxedVideoAudioExtractionDispatcher } from "./video-audio-dispatcher";
import {
  ffmpegAudioTranscodeArgumentVector,
  youtubeDlArgumentVector,
} from "./workers/video-audio-argv";

const digest = "b".repeat(64);
const timeline = {
  schemaVersion: 1 as const,
  width: 1_920 as const,
  height: 1_080 as const,
  fps: 30 as const,
  scenes: [
    {
      id: "scene-1",
      startMs: 0,
      durationMs: 2_000,
      visual: {
        artifactRevisionId: "slides-r1",
        digest,
        pageOrSlide: 1,
      },
      captions: [
        { id: "cue-1", startMs: 100, endMs: 800, text: "A safe caption" },
      ],
      transition: "cut" as const,
      citations: [],
    },
  ],
};

describe("advanced source ingestion", () => {
  test("re-resolves public URLs and rejects private destinations", async () => {
    const publicPolicy = new PublicIngestionUrlPolicy({
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      allowHttp: false,
    });
    expect(
      await publicPolicy.validate("https://school.example/course", "main-navigation"),
    ).toMatchObject({ origin: "https://school.example" });

    const privatePolicy = new PublicIngestionUrlPolicy({
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await expect(
      privatePolicy.validate("https://school.example/course", "subresource"),
    ).rejects.toMatchObject({ reasonCode: "blocked_destination" });
  });

  test("enforces per-render request and origin limits", async () => {
    const policy = new PublicIngestionUrlPolicy({
      resolve: async () => [{ address: "8.8.4.4", family: 4 }],
    });
    const session = new BrowserNetworkPolicySession(policy, {
      maxRequests: 2,
      maxOrigins: 1,
    });
    await session.authorize("https://a.example/page", "main-navigation");
    await session.authorize("https://a.example/image.png", "subresource");
    await expect(
      session.authorize("https://a.example/third", "subresource"),
    ).rejects.toMatchObject({ reasonCode: "request_limit" });
    expect(session.snapshot().requestCount).toBe(2);
  });

  test("captures only images in the readable article and emits exact line locators", async () => {
    const articleText =
      "This is the course article body with enough meaningful words for readability extraction and exact source citations. ".repeat(
        4,
      );
    const html = `<html><head><title>Lesson</title></head><body><img src="https://cdn.example/tracker.png" width="1" height="1"><article><h1>Lesson</h1><p>${articleText}</p><img src="/diagram.png" alt="Diagram"></article></body></html>`;
    expect(referencedArticleImages(html, "https://school.example/course")).toEqual([
      {
        sourceUrl: "https://school.example/diagram.png",
        alt: "Diagram",
      },
    ]);
    const clock = new Date("2026-08-22T10:00:00.000Z");
    const adapter = new StaticHtmlIngestionAdapter({
      now: () => clock,
      fetchArticle: async () => ({
        body: new TextEncoder().encode(html),
        html,
        finalUrl: "https://school.example/course",
        contentType: "text/html",
      }),
      captureImages: async () => ({
        assets: [],
        assetHrefBySourceUrl: new Map([
          ["https://school.example/diagram.png", "asset://source-image-1"],
        ]),
      }),
    });
    const result = await adapter.ingest({
      sourceId: "source-1",
      canonicalUrl: "https://school.example/course",
      strategy: "static-html",
      policyRef: "public-url.v1",
      language: "fr",
      limits: {
        maxNavigations: 8,
        maxRequests: 250,
        maxResponseBytes: 5_000_000,
        maxOutputBytes: 10_000_000,
        deadlineMs: 20_000,
        maxOrigins: 8,
      },
    });
    expect(result.markdown).toContain("asset://source-image-1");
    expect(result.markdown).not.toContain("tracker.png");
    expect(result.citations[0]?.locator.kind).toBe("markdown");
    expect(markdownIngestionCitations("# A\n\nFirst.\n\n## B\n\nSecond.")).toEqual([
      expect.objectContaining({
        locator: expect.objectContaining({ headingPath: ["A"], startLine: 3 }),
      }),
      expect.objectContaining({
        locator: expect.objectContaining({ headingPath: ["A", "B"], startLine: 7 }),
      }),
    ]);
  });
});

describe("captions-first video adapter", () => {
  const captions: PlatformCaptionProvider = {
    id: "fixture-captions",
    version: "1",
    async load() {
      return {
        canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        mediaId: "abcdefghijk",
        title: "Lesson",
        channel: "Teacher",
        durationMs: 10_000,
        chapters: [],
        markdown: "Transcript",
        wordCount: 1,
        truncated: false,
        tracks: [
          {
            language: "en",
            source: "publisher",
            segments: [{ startMs: 0, endMs: 1_000, text: "Hello" }],
          },
          {
            language: "fr-FR",
            source: "publisher",
            segments: [{ startMs: 0, endMs: 1_000, text: "Bonjour" }],
          },
        ],
      };
    },
  };

  test("selects platform captions before any audio extraction", async () => {
    let fallbackCalls = 0;
    const adapter = new VideoSourceAdapter(captions, {
      async enqueue() {
        fallbackCalls += 1;
        return { jobId: "job-1", placement: "node" };
      },
    });
    const result = await adapter.ingest({
      ownerId: "user-1",
      threadId: "thread-1",
      branchId: "branch-1",
      sourceVersionId: "version-1",
      url: "https://youtu.be/abcdefghijk",
      preferredLanguage: "fr",
      requestAudioFallback: true,
      consentRevision: "notice-v1",
      idempotencyKey: "captions-first",
    });
    expect(result.status).toBe("ready");
    expect(result.status === "ready" && result.source.selectedLanguage).toBe(
      "fr-fr",
    );
    expect(fallbackCalls).toBe(0);
  });

  test("requires explicit consent before the opt-in audio branch", async () => {
    const unavailable: PlatformCaptionProvider = {
      ...captions,
      async load() {
        return { ...(await captions.load({ canonicalUrl: "", preferredLanguage: "fr" })), tracks: [] };
      },
    };
    const adapter = new VideoSourceAdapter(unavailable, {
      async enqueue() {
        return { jobId: "job-1", placement: "node" };
      },
    });
    await expect(
      adapter.ingest({
        ownerId: "user-1",
        threadId: "thread-1",
        branchId: "branch-1",
        sourceVersionId: "version-1",
        url: "https://youtu.be/abcdefghijk",
        preferredLanguage: "fr",
        requestAudioFallback: true,
        idempotencyKey: "audio-fallback",
      }),
    ).rejects.toMatchObject({ reasonCode: "permission_required" });
  });
});

describe("media artifacts and sandbox boundaries", () => {
  test("builds deterministic argv without a shell or caller flags", () => {
    const request = {
      schemaVersion: 1,
      canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      provider: "youtube",
      maxDurationSeconds: 3_600,
      maxDownloadBytes: 100_000_000,
      outputCodec: "wav-pcm-s16le",
    } as const;
    const youtube = youtubeDlArgumentVector(request);
    expect(youtube.at(-1)).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    expect(youtube.join(" ")).not.toContain("sh -c");
    expect(() =>
      ffmpegAudioTranscodeArgumentVector("/tmp/../../etc/passwd"),
    ).toThrow("VIDEO_INPUT_PATH_INVALID");
  });

  test("validates timeline revision digests and produces caption/render manifests", async () => {
    const validated = await validateVideoTimeline({
      ownerId: "user-1",
      ownerArtifactRevisionId: "timeline-r1",
      timeline,
      resolver: {
        async artifactRevision(ownerId, id) {
          return { id, ownerId, digest, kind: "image" };
        },
        async citation() {
          return null;
        },
      },
    });
    expect(validated.durationMs).toBe(2_000);
    expect(captionsFromTimeline(timeline, "vtt")).toContain(
      "00:00:00.100 --> 00:00:00.800",
    );
    const argv = buildFfmpegTimelineArgv(timeline);
    expect(argv.at(-1)).toBe("/workspace/output/video.mp4");
    expect(argv).not.toContain("sh");
    await expect(
      validateVideoTimeline({
        ownerId: "user-1",
        ownerArtifactRevisionId: "timeline-r1",
        timeline,
        resolver: {
          async artifactRevision(ownerId, id) {
            return { id, ownerId, digest: "c".repeat(64), kind: "image" };
          },
          async citation() {
            return null;
          },
        },
      }),
    ).rejects.toThrow(/digest/u);
  });

  test("accepts reviewed Manim data only and preserves honest legacy provenance", () => {
    expect(
      validateManimSceneDsl({
        schemaVersion: 1,
        durationMs: 1_000,
        background: "#000000",
        objects: [
          { id: "title", kind: "text", text: "x²", x: 0, y: 0, color: "#ffffff" },
        ],
        animations: [
          { objectId: "title", effect: "appear", startMs: 0, durationMs: 500 },
        ],
      }).digest,
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      validateManimSceneDsl({ schemaVersion: 1, durationMs: 1_000, python: "import os" }),
    ).toThrow();

    for (const [kind, mimeType] of [
      ["pdf", "application/pdf"],
      ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["audio", "audio/mpeg"],
      ["image", "image/png"],
      ["anki", "application/octet-stream"],
      ["html", "text/html"],
    ] as const) {
      const legacy = manifestFromLegacyDocumentArtifact({
        id: `old-${kind}`,
        kind,
        sourceDocumentId: "document-1",
        sourceRevision: 2,
        fileId: `file-${kind}`,
        byteDigest: digest,
        byteSize: 123,
        mimeType,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      });
      expect(legacy.manifest.kind).toBe(kind);
      expect(legacy.manifest.output.digest).toBe(digest);
      expect(legacy.manifest.renderer).toMatchObject({
        imageDigest: null,
        reproducibility: "best-effort",
      });
    }
  });

  test("fails browser/media dispatch closed before any unavailable runtime call", async () => {
    const browser = new BrowserRenderDispatcher({
      admission: {} as never,
      manifestStore: {} as never,
      urlPolicy: {} as never,
      egress: {} as never,
      profile: { id: "browser", enabled: false } as never,
    });
    await expect(
      browser.enqueue({
        ownerId: "user-1",
        threadId: "thread-1",
        branchId: "branch-1",
        sourceId: "source-1",
        canonicalUrl: "https://school.example",
        policyRef: "policy-v1",
        idempotencyKey: "browser-disabled",
      }),
    ).rejects.toMatchObject({ reasonCode: "placement_unavailable" });

    const media = new SandboxedVideoAudioExtractionDispatcher({
      placement: "hosted",
      hostedManagedEnabled: false,
      admission: {} as never,
      manifestStore: {} as never,
      egress: {} as never,
      profile: {} as never,
    });
    await expect(
      media.enqueue({
        ownerId: "user-1",
        threadId: "thread-1",
        branchId: "branch-1",
        sourceVersionId: "version-1",
        canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        requestedLanguage: "fr",
        consentRevision: "notice-v1",
        idempotencyKey: "hosted-disabled",
      }),
    ).rejects.toMatchObject({ reasonCode: "capability_disabled" });
  });
});
