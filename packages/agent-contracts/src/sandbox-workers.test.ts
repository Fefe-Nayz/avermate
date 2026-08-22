import { describe, expect, test } from "bun:test";
import {
  browserCaptureWorkerManifestV1Schema,
  latexWorkerManifestV1Schema,
  manimWorkerManifestV1Schema,
  mediaSegmentWorkerOutputV1Schema,
  mediaTimelineRenderWorkerManifestV1Schema,
} from "./sandbox-workers";

const digest = `sha256:${"a".repeat(64)}`;

describe("versioned sandbox worker manifests", () => {
  test("accepts a bounded browser capture request and rejects extra flags", () => {
    const manifest = {
      schemaVersion: 1,
      worker: "browser-capture.v1",
      request: {
        schemaVersion: 1,
        url: "https://example.test/course",
        wait: { kind: "dom-settled", maxMs: 1_000 },
        maxNavigations: 2,
        maxRequests: 20,
        maxResponseBytes: 1_000_000,
        capture: ["readable-html", "metadata"],
      },
      egressPolicyDigest: digest,
    };
    expect(browserCaptureWorkerManifestV1Schema.parse(manifest).worker).toBe(
      "browser-capture.v1",
    );
    expect(
      browserCaptureWorkerManifestV1Schema.safeParse({
        ...manifest,
        command: "curl metadata.internal",
      }).success,
    ).toBe(false);
  });

  test("rejects traversal in LaTeX source paths", () => {
    expect(
      latexWorkerManifestV1Schema.safeParse({
        schemaVersion: 1,
        worker: "latex-build.v1",
        source: {
          path: "input/../secret.tex",
          digest,
          byteSize: 100,
        },
        engine: "tectonic",
        shellEscape: false,
        maximumPages: 10,
      }).success,
    ).toBe(false);
  });

  test("requires contiguous media segment output", () => {
    expect(
      mediaSegmentWorkerOutputV1Schema.safeParse({
        schemaVersion: 1,
        worker: "media-segment.v1",
        durationMs: 2_000,
        segments: [
          {
            index: 0,
            startMs: 1,
            endMs: 2_000,
            file: {
              path: "output/segment-000.mp3",
              digest,
              byteSize: 100,
              mimeType: "audio/mpeg",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("binds timeline assets to exact immutable revision digests", () => {
    const timeline = {
      schemaVersion: 1,
      width: 1_920,
      height: 1_080,
      fps: 30,
      scenes: [
        {
          id: "scene-1",
          startMs: 0,
          durationMs: 2_000,
          visual: {
            artifactRevisionId: "visual-rev",
            digest: "b".repeat(64),
            pageOrSlide: 1,
          },
          captions: [],
          transition: "cut",
          citations: [],
        },
      ],
    };
    const base = {
      schemaVersion: 1,
      worker: "media-timeline-render.v1",
      timeline,
      assets: [
        {
          artifactRevisionId: "visual-rev",
          digest: `sha256:${"b".repeat(64)}`,
          byteSize: 1_024,
          path: "input/assets/visual.png",
          mimeType: "image/png",
        },
      ],
      videoCodec: "h264",
      audioCodec: "aac",
      maximumOutputBytes: 10_000_000,
    };
    expect(mediaTimelineRenderWorkerManifestV1Schema.safeParse(base).success).toBe(
      true,
    );
    expect(
      mediaTimelineRenderWorkerManifestV1Schema.safeParse({
        ...base,
        assets: [{ ...base.assets[0], digest }],
      }).success,
    ).toBe(false);
  });

  test("Manim accepts data-only scenes and rejects unknown object kinds", () => {
    const base = {
      schemaVersion: 1,
      worker: "manim-build.v1",
      scene: {
        schemaVersion: 1,
        durationMs: 1_000,
        background: "#000000",
        objects: [
          {
            id: "title",
            kind: "text",
            text: "Avermate",
            x: 0,
            y: 0,
            color: "#ffffff",
          },
        ],
        animations: [],
      },
      width: 1_920,
      height: 1_080,
      fps: 30,
    };
    expect(manimWorkerManifestV1Schema.safeParse(base).success).toBe(true);
    expect(
      manimWorkerManifestV1Schema.safeParse({
        ...base,
        scene: {
          ...base.scene,
          objects: [{ ...base.scene.objects[0], kind: "python" }],
        },
      }).success,
    ).toBe(false);
  });
});
