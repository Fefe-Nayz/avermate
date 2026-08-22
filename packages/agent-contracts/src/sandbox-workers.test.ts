import { describe, expect, test } from "bun:test";
import {
  browserCaptureWorkerManifestV1Schema,
  corpusDerivativeWorkerManifestV1Schema,
  corpusDerivativeWorkerOutputV1Schema,
  latexWorkerManifestV1Schema,
  localOcrWorkerManifestV1Schema,
  localOcrWorkerOutputV1Schema,
  localTranscriptionWorkerManifestV1Schema,
  localTranscriptionWorkerOutputV1Schema,
  manimWorkerManifestV1Schema,
  mediaSegmentWorkerOutputV1Schema,
  mediaTimelineRenderWorkerManifestV1Schema,
  specialistWorkerManifestV1Schema,
  videoAudioExtractWorkerOutputV2Schema,
} from "./sandbox-workers";
import { nodeArtifactWorkerRequestV1Schema } from "./node-artifact-workers";

const digest = `sha256:${"a".repeat(64)}`;

describe("versioned sandbox worker manifests", () => {
  test("binds offline OCR and STT outputs to the exact source and model revision", () => {
    const ocrManifest = {
      schemaVersion: 1,
      worker: "local-ocr.v1",
      source: {
        path: "input/source",
        digest,
        byteSize: 1_024,
        mimeType: "application/pdf",
      },
      language: "fra+eng",
      maximumPages: 300,
      maximumPixelsPerPage: 16_777_216,
      maximumTotalPixels: 1_000_000_000,
      modelId: "tesseract-ocr",
      modelRevision: "tesseract-5.5.1-fra-eng",
    } as const;
    expect(localOcrWorkerManifestV1Schema.parse(ocrManifest).maximumPages).toBe(
      300,
    );
    expect(
      localOcrWorkerOutputV1Schema.safeParse({
        schemaVersion: 1,
        worker: "local-ocr.v1",
        sourceDigest: digest,
        modelId: "tesseract-ocr",
        modelRevision: "tesseract-5.5.1-fra-eng",
        engine: "tesseract+poppler",
        networkAccess: false,
        pageCount: 1,
        pages: [
          { providerIndex: 0, markdown: "Texte", width: 1000, height: 1400 },
        ],
      }).success,
    ).toBe(true);

    const transcriptionManifest = {
      schemaVersion: 1,
      worker: "local-transcription.v1",
      source: {
        path: "input/source",
        digest,
        byteSize: 256_000,
        mimeType: "audio/mpeg",
      },
      modelId: "selfhost/whisper-large-v3-turbo-q5_0",
      modelRevision: "whisper-large-v3-turbo-q5_0-2026-08",
      language: "fr",
      maximumSeconds: 600,
      timestamps: "segment",
    } as const;
    expect(
      localTranscriptionWorkerManifestV1Schema.parse(transcriptionManifest)
        .timestamps,
    ).toBe("segment");
    expect(
      localTranscriptionWorkerOutputV1Schema.safeParse({
        schemaVersion: 1,
        worker: "local-transcription.v1",
        sourceDigest: digest,
        modelId: transcriptionManifest.modelId,
        modelRevision: transcriptionManifest.modelRevision,
        engine: "whisper.cpp",
        networkAccess: false,
        text: "Bonjour",
        language: "fr",
        durationMs: 1_000,
        segments: [{ startMs: 0, endMs: 1_000, text: "Bonjour" }],
      }).success,
    ).toBe(true);
    expect(
      localTranscriptionWorkerOutputV1Schema.safeParse({
        schemaVersion: 1,
        worker: "local-transcription.v1",
        sourceDigest: digest,
        modelId: transcriptionManifest.modelId,
        modelRevision: transcriptionManifest.modelRevision,
        engine: "whisper.cpp",
        networkAccess: false,
        text: "stale",
        language: "fr",
        durationMs: 1_000,
        segments: [{ startMs: 3_100, endMs: 3_200, text: "stale" }],
      }).success,
    ).toBe(false);
  });

  test("binds corpus derivative work to exact bounded pages and media windows", () => {
    const pdf = {
      schemaVersion: 1,
      worker: "corpus-derivatives.v1",
      source: {
        path: "input/source",
        digest,
        byteSize: 1_024,
        mimeType: "application/pdf",
      },
      request: {
        kind: "pdf",
        maximumDimension: 1_536,
        units: [{ unitId: "chunk-1", page: 3 }],
      },
    } as const;
    expect(corpusDerivativeWorkerManifestV1Schema.parse(pdf).request.kind).toBe(
      "pdf",
    );
    expect(
      corpusDerivativeWorkerManifestV1Schema.safeParse({
        ...pdf,
        source: { ...pdf.source, mimeType: "video/mp4" },
      }).success,
    ).toBe(false);
    expect(
      corpusDerivativeWorkerManifestV1Schema.safeParse({
        ...pdf,
        source: { ...pdf.source, mimeType: "audio/mpeg" },
        request: {
          kind: "audio",
          units: [{ unitId: "chunk-1", startMs: 0, endMs: 180_001 }],
        },
      }).success,
    ).toBe(false);
    expect(
      corpusDerivativeWorkerManifestV1Schema.safeParse({
        ...pdf,
        request: {
          ...pdf.request,
          units: [
            { unitId: "chunk-1", page: 3 },
            { unitId: "chunk-2", page: 3 },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test("probes only a media stream matching the owned source MIME type", () => {
    const probe = {
      schemaVersion: 1,
      worker: "corpus-derivatives.v1",
      source: {
        path: "input/source",
        digest,
        byteSize: 1_024,
        mimeType: "video/mp4",
      },
      request: { kind: "media-probe", modality: "video" },
    } as const;
    expect(corpusDerivativeWorkerManifestV1Schema.safeParse(probe).success).toBe(
      true,
    );
    expect(
      corpusDerivativeWorkerManifestV1Schema.safeParse({
        ...probe,
        request: { kind: "media-probe", modality: "audio" },
      }).success,
    ).toBe(false);
    expect(
      corpusDerivativeWorkerOutputV1Schema.safeParse({
        schemaVersion: 1,
        worker: "corpus-derivatives.v1",
        kind: "media-probe",
        modality: "video",
        durationMs: 250_000,
      }).success,
    ).toBe(true);
  });

  test("requires exact derivative output paths and one-page geometry", () => {
    expect(
      corpusDerivativeWorkerOutputV1Schema.safeParse({
        schemaVersion: 1,
        worker: "corpus-derivatives.v1",
        kind: "pdf",
        totalPages: 3,
        units: [
          {
            unitId: "chunk-1",
            page: 3,
            rotationDegrees: 0,
            widthPoints: 612,
            heightPoints: 792,
            pdf: {
              path: "output/page-00003.pdf",
              digest,
              byteSize: 512,
              mimeType: "application/pdf",
            },
            image: {
              path: "output/page-00003.png",
              digest,
              byteSize: 256,
              mimeType: "image/png",
            },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      corpusDerivativeWorkerOutputV1Schema.safeParse({
        schemaVersion: 1,
        worker: "corpus-derivatives.v1",
        kind: "image",
        unitId: "chunk-1",
        width: 10,
        height: 10,
        image: {
          path: "output/../escape.png",
          digest,
          byteSize: 100,
          mimeType: "image/png",
        },
      }).success,
    ).toBe(false);
  });

  test("bounds specialist workers to reviewed commands and logical snapshots", () => {
    const manifest = {
      schemaVersion: 1,
      worker: "opencode",
      operation: "revise-artifact",
      jobId: "job-1",
      ownerId: "owner-1",
      sourceWorkspaceSnapshot: {
        provider: "opensandbox",
        digest,
        format: "tar.zst-v1",
      },
      sourceRevisionDigest: digest,
      instruction: "Add a labelled axis to the reviewed visualization.",
      writableRoots: ["src", "tests", "output"],
      reviewedCommands: [
        { commandId: "unit", cwd: "." },
      ],
      dependencyPolicy: { mode: "none" },
      egressPolicyDigest: digest,
      toolGrantIds: [],
      limits: {
        maximumInputBytes: 1_000,
        maximumOutputBytes: 2_000,
        maximumCommands: 1,
        deadline: new Date(Date.now() + 60_000).toISOString(),
      },
      reviewRequired: true,
    } as const;
    expect(specialistWorkerManifestV1Schema.parse(manifest).worker).toBe(
      "opencode",
    );
    expect(
      specialistWorkerManifestV1Schema.safeParse({
        ...manifest,
        reviewedCommands: [
          {
            commandId: "escape",
            cwd: "../",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      specialistWorkerManifestV1Schema.safeParse({
        ...manifest,
        reviewedCommands: [
          { commandId: "one", cwd: "." },
          { commandId: "two", cwd: "." },
        ],
      }).success,
    ).toBe(false);
  });
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

  test("caps and orders Node transcription audio segments", () => {
    const output = {
      schemaVersion: 2,
      worker: "video-audio-extract.v2",
      durationMs: 90_000,
      codec: "mp3",
      bitrateKbps: 48,
      sampleRate: 16_000,
      channels: 1,
      segments: [
        {
          index: 0,
          startMs: 0,
          endMs: 60_000,
          audio: {
            path: "output/audio-segment-000.mp3",
            digest,
            byteSize: 500_000,
            mimeType: "audio/mpeg",
          },
        },
        {
          index: 1,
          startMs: 60_000,
          endMs: 90_000,
          audio: {
            path: "output/audio-segment-001.mp3",
            digest,
            byteSize: 250_000,
            mimeType: "audio/mpeg",
          },
        },
      ],
    } as const;
    expect(videoAudioExtractWorkerOutputV2Schema.safeParse(output).success).toBe(
      true,
    );
    expect(
      videoAudioExtractWorkerOutputV2Schema.safeParse({
        ...output,
        segments: [
          {
            ...output.segments[0],
            audio: {
              ...output.segments[0].audio,
              byteSize: 32 * 1024 * 1024 + 1,
            },
          },
        ],
        durationMs: 60_000,
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

describe("Node artifact worker envelope", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const source = {
    object: { ownerId: "owner-a", namespace: "materials", key: "source-a" },
    digest,
    byteSize: 128,
    mimeType: "image/png",
  };

  test("binds the single Node manifest to every exact staged worker input", () => {
    expect(
      nodeArtifactWorkerRequestV1Schema.parse({
        schemaVersion: 1,
        worker: "material-preview.v1",
        execution: { threadId: "thread-a", branchId: "branch-a" },
        manifest: {
          schemaVersion: 1,
          worker: "material-preview.v1",
          source: {
            path: "input/source",
            digest,
            byteSize: 128,
            mimeType: "image/png",
          },
          maximumDimension: 512,
        },
        inputs: [{ path: "input/source", artifact: source }],
      }).inputs,
    ).toHaveLength(1);
  });

  test("requires the exact binary source for local OCR and transcription", () => {
    const request = {
      schemaVersion: 1 as const,
      worker: "local-transcription.v1" as const,
      execution: { threadId: "recording-a", branchId: "segment-a" },
      manifest: {
        schemaVersion: 1 as const,
        worker: "local-transcription.v1" as const,
        source: {
          path: "input/source" as const,
          digest,
          byteSize: 128,
          mimeType: "audio/mpeg" as const,
        },
        modelId: "selfhost/whisper-large-v3-turbo-q5_0",
        modelRevision: "whisper-large-v3-turbo-q5_0-2026-08",
        maximumSeconds: 60,
        timestamps: "segment" as const,
      },
      inputs: [
        {
          path: "input/source",
          artifact: { ...source, mimeType: "audio/mpeg" },
        },
      ],
    };
    expect(nodeArtifactWorkerRequestV1Schema.parse(request).inputs).toHaveLength(
      1,
    );
    expect(() =>
      nodeArtifactWorkerRequestV1Schema.parse({ ...request, inputs: [] }),
    ).toThrow();
  });

  test("rejects omitted, extra, or descriptor-divergent nested inputs", () => {
    const base = {
      schemaVersion: 1 as const,
      worker: "material-preview.v1" as const,
      execution: { threadId: "thread-a", branchId: "branch-a" },
      manifest: {
        schemaVersion: 1 as const,
        worker: "material-preview.v1" as const,
        source: {
          path: "input/source" as const,
          digest,
          byteSize: 128,
          mimeType: "image/png" as const,
        },
        maximumDimension: 512,
      },
    };
    expect(() =>
      nodeArtifactWorkerRequestV1Schema.parse({ ...base, inputs: [] }),
    ).toThrow();
    expect(() =>
      nodeArtifactWorkerRequestV1Schema.parse({
        ...base,
        inputs: [
          {
            path: "input/source",
            artifact: { ...source, byteSize: 127 },
          },
        ],
      }),
    ).toThrow();
  });
});
