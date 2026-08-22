import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CorpusDerivativeWorkerManifestV1,
  LatexWorkerManifestV1,
  LocalOcrWorkerManifestV1,
  LocalTranscriptionWorkerManifestV1,
  MaterialPreviewWorkerManifestV1,
  MediaSegmentWorkerManifestV1,
  VideoAudioExtractWorkerManifestV2,
} from "@avermate/agent-contracts";
import { browserCaptureCli } from "./browser-capture";
import {
  corpusDerivativesCli,
  parsePdfGeometry,
  produceCorpusDerivatives,
} from "./corpus-derivatives";
import { buildLatex, latexBuildCli, tectonicArguments } from "./latex-build";
import {
  localOcrCli,
  parseImageDimensions,
  runLocalOcrWorker,
} from "./local-ocr";
import {
  localTranscriptionCli,
  parseMediaDuration,
  runLocalTranscriptionWorker,
  whisperArguments,
} from "./local-transcription";
import {
  extractSegments,
  extractVideoAudioSegments,
  materialPreviewArguments,
  mediaBuildCli,
  mediaSegmentArguments,
  renderMaterialPreviewWorker,
  timelineFfmpegArguments,
  audioSegmentTranscodeArguments,
  youtubeDownloadArguments,
} from "./media-build";
import { manimBuildCli, renderManimPython } from "./manim-build";
import { slidesBuildCli } from "./slides-build";
import { runCommand, type CommandRunner } from "./runtime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("sandbox worker CLI and fixed argument vectors", () => {
  test("accepts only the reviewed absolute entrypoint paths", () => {
    expect(
      corpusDerivativesCli([
        "--input",
        "/workspace/input/request.json",
        "--manifest",
        "/workspace/output/derivatives.json",
      ]).manifest,
    ).toBe("/workspace/output/derivatives.json");
    expect(() =>
      corpusDerivativesCli([
        "--input",
        "/workspace/input/request.json",
        "--manifest",
        "/tmp/derivatives.json",
      ]),
    ).toThrow("CORPUS_DERIVATIVE_WORKER_PATH_INVALID");
    expect(
      browserCaptureCli([
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/workspace/output/render.json",
      ]).output,
    ).toBe("/workspace/output/render.json");
    expect(() =>
      browserCaptureCli([
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/tmp/result.json",
      ]),
    ).toThrow("BROWSER_CAPTURE_PATH_INVALID");
    expect(() =>
      latexBuildCli([
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/workspace/output/document.pdf",
        "--manifest",
        "/workspace/output/build.json",
        "--shell-escape",
        "true",
      ]),
    ).toThrow("WORKER_ARGUMENT_VECTOR_INVALID");
    expect(
      slidesBuildCli([
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/workspace/output/slides.pdf",
        "--manifest",
        "/workspace/output/build.json",
      ]).manifest,
    ).toBe("/workspace/output/build.json");
    expect(
      manimBuildCli([
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/workspace/output/scene.mp4",
        "--manifest",
        "/workspace/output/render.json",
      ]).output,
    ).toBe("/workspace/output/scene.mp4");
    expect(
      localOcrCli([
        "--input",
        "/workspace/input/request.json",
        "--manifest",
        "/workspace/output/ocr.json",
      ]).manifest,
    ).toBe("/workspace/output/ocr.json");
    expect(
      localTranscriptionCli([
        "--input",
        "/workspace/input/request.json",
        "--manifest",
        "/workspace/output/transcription.json",
      ]).manifest,
    ).toBe("/workspace/output/transcription.json");
  });

  test("pins local STT to one offline model path and rejects duration overflow", () => {
    const manifest: LocalTranscriptionWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "local-transcription.v1",
      source: {
        path: "input/source",
        digest: `sha256:${"a".repeat(64)}`,
        byteSize: 100,
        mimeType: "audio/mpeg",
      },
      modelId: "selfhost/whisper-large-v3-turbo-q5_0",
      modelRevision: "whisper-large-v3-turbo-q5_0-2026-08",
      maximumSeconds: 60,
      timestamps: "segment",
    };
    const argv = whisperArguments(manifest);
    expect(argv).toContain("/models/whisper-large-v3-turbo-q5_0.bin");
    expect(argv).not.toContain("http");
    expect(() => parseMediaDuration("63.1", 60)).toThrow(
      "LOCAL_TRANSCRIPTION_DURATION_LIMIT_EXCEEDED",
    );
  });

  test("builds YouTube-only download arguments without caller flags", () => {
    const argv = youtubeDownloadArguments({
      schemaVersion: 1,
      worker: "video-audio-extract.v1",
      request: {
        schemaVersion: 1,
        canonicalUrl: "https://youtu.be/dQw4w9WgXcQ",
        provider: "youtube",
        maxDurationSeconds: 600,
        maxDownloadBytes: 10_000_000,
        outputCodec: "wav-pcm-s16le",
      },
      requestedLanguage: "fr",
      consentRevision: "v1",
      egressPolicyDigest: digest(new TextEncoder().encode("policy")),
    });
    expect(argv.at(-1)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(argv).toContain("--no-playlist");
    expect(argv).not.toContain("--exec");
    expect(() =>
      youtubeDownloadArguments({
        schemaVersion: 1,
        worker: "video-audio-extract.v1",
        request: {
          schemaVersion: 1,
          canonicalUrl: "https://example.test/video",
          provider: "youtube",
          maxDurationSeconds: 600,
          maxDownloadBytes: 10_000_000,
          outputCodec: "wav-pcm-s16le",
        },
        requestedLanguage: "fr",
        consentRevision: "v1",
        egressPolicyDigest: digest(new TextEncoder().encode("policy")),
      }),
    ).toThrow("VIDEO_PROVIDER_NOT_ALLOWED");
  });

  test("pins segmented transcription audio to mono MP3 and reviewed paths", () => {
    const manifest: VideoAudioExtractWorkerManifestV2 = {
      schemaVersion: 2,
      worker: "video-audio-extract.v2",
      request: {
        schemaVersion: 2,
        canonicalUrl: "https://youtu.be/dQw4w9WgXcQ",
        provider: "youtube",
        maxDurationSeconds: 600,
        maxDownloadBytes: 10_000_000,
        outputCodec: "mp3-mono-16khz",
        segmentSeconds: 600,
        maximumSegmentBytes: 32 * 1024 * 1024,
      },
      requestedLanguage: "fr",
      consentRevision: "v1",
      egressPolicyDigest: digest(new TextEncoder().encode("policy")),
    };
    const argv = audioSegmentTranscodeArguments(
      manifest,
      "/workspace/tmp/source.webm",
    );
    expect(argv).toContain("libmp3lame");
    expect(argv).toContain("48k");
    expect(argv.at(-1)).toBe(
      "/workspace/output/audio-segment-%03d.mp3",
    );
    expect(
      mediaBuildCli([
        "extract-video-audio-segments",
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/workspace/output",
        "--manifest",
        "/workspace/output/extraction-segments.json",
      ]).operation,
    ).toBe("extract-video-audio-segments");
  });

  test("derives timeline filters only from validated immutable assets", () => {
    const argv = timelineFfmpegArguments({
      schemaVersion: 1,
      worker: "media-timeline-render.v1",
      timeline: {
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
              artifactRevisionId: "visual-1",
              digest: "a".repeat(64),
              pageOrSlide: 1,
            },
            captions: [],
            transition: "cut",
            citations: [],
          },
        ],
      },
      assets: [
        {
          artifactRevisionId: "visual-1",
          digest: `sha256:${"a".repeat(64)}`,
          byteSize: 10,
          path: "input/assets/visual.png",
          mimeType: "image/png",
        },
      ],
      videoCodec: "h264",
      audioCodec: "aac",
      maximumOutputBytes: 10_000_000,
    });
    expect(argv).toContain("libx264");
    expect(argv).toContain("/workspace/input/assets/visual.png");
    expect(argv.at(-1)).toBe("/workspace/output/video.mp4");
  });

  test("renders hostile Manim text only as a quoted Python string", () => {
    const text = 'x"); __import__("os").system("id"); #';
    const python = renderManimPython({
      schemaVersion: 1,
      durationMs: 1_000,
      background: "#000000",
      objects: [
        {
          id: "title",
          kind: "text",
          text,
          x: 0,
          y: 0,
          color: "#ffffff",
        },
      ],
      animations: [],
    });
    expect(python).toContain(JSON.stringify(text));
    expect(python).not.toContain(`Text(${text}`);
  });

  test("adds moving objects before their first animation and keeps appearing objects hidden", () => {
    const python = renderManimPython({
      schemaVersion: 1,
      durationMs: 1_000,
      background: "#000000",
      objects: [
        { id: "moving", kind: "text", text: "Move", x: 0, y: 0, color: "#ffffff" },
        { id: "appearing", kind: "text", text: "Appear", x: 0, y: 0, color: "#ffffff" },
      ],
      animations: [
        { objectId: "moving", effect: "move", startMs: 0, durationMs: 500, to: [1, 1] },
        { objectId: "appearing", effect: "fade-in", startMs: 0, durationMs: 500 },
      ],
    });
    expect(python).toContain('self.add(objects["moving"])');
    expect(python).not.toContain('self.add(objects["appearing"])');
  });

  test("keeps Linux output paths stable and rejects environment overrides", async () => {
    const manifest: MediaSegmentWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "media-segment.v1",
      source: {
        path: "input/source",
        digest: `sha256:${"a".repeat(64)}`,
        byteSize: 10,
        mimeType: "audio/mpeg",
      },
      segmentSeconds: 60,
      maxDurationSeconds: 300,
      outputCodec: "mp3-mono-16khz",
    };
    expect(mediaSegmentArguments(manifest).at(-1)).toBe(
      "/workspace/output/segment-%03d.mp3",
    );
    await expect(
      runCommand("/usr/bin/true", [], {
        environment: { PATH: "/attacker-controlled" },
      }),
    ).rejects.toThrow("WORKER_ENVIRONMENT_INVALID");
  });

  test("keeps material preview tool limits and output fixed", () => {
    const argv = materialPreviewArguments({
      sourcePath: "/workspace/input/source",
      imagePath: "/workspace/input/source",
      outputPath: "/workspace/output/preview.webp",
      maximumDimension: 512,
    });
    expect(argv).toContain("128MiB");
    expect(argv.at(-1)).toBe("/workspace/output/preview.webp");
  });

  test("parses media subcommands without accepting free-form commands", () => {
    expect(
      mediaBuildCli([
        "extract-segments",
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/workspace/output",
        "--manifest",
        "/workspace/output/segments.json",
      ]).operation,
    ).toBe("extract-segments");
    expect(() =>
      mediaBuildCli([
        "shell",
        "--input",
        "/workspace/input/request.json",
        "--output",
        "/workspace/output",
        "--manifest",
        "/workspace/output/segments.json",
      ]),
    ).toThrow("MEDIA_OPERATION_INVALID");
  });
});

describe("deterministic worker fixtures", () => {
  test("OCRs bounded PDF pages offline with exact page locators", async () => {
    const root = await workspace();
    const source = new TextEncoder().encode("pdf-ocr-fixture");
    await writeFile(join(root, "input", "source"), source);
    const manifest: LocalOcrWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "local-ocr.v1",
      source: {
        path: "input/source",
        digest: digest(source),
        byteSize: source.byteLength,
        mimeType: "application/pdf",
      },
      language: "fra+eng",
      maximumPages: 2,
      maximumPixelsPerPage: 2_000_000,
      maximumTotalPixels: 4_000_000,
      modelId: "tesseract-ocr",
      modelRevision: "tesseract-5.5.1-fra-eng",
    };
    const commands: string[][] = [];
    const runner: CommandRunner = async (executable, argv) => {
      commands.push([executable, ...argv]);
      if (executable.endsWith("pdfinfo")) {
        return result({ stdout: "Pages: 2\n" });
      }
      if (executable.endsWith("pdftoppm")) {
        await writeFile(`${argv.at(-1)}.png`, "png-page");
        return result();
      }
      if (argv[0] === "identify") return result({ stdout: "1000 1400" });
      return result({ stdout: `Texte page ${commands.filter(([name]) => name?.endsWith("tesseract")).length}` });
    };
    const output = await runLocalOcrWorker(manifest, runner, root);
    expect(output.pages.map((page) => page.providerIndex)).toEqual([0, 1]);
    expect(output.pages[1]?.markdown).toContain("page 2");
    expect(output.networkAccess).toBe(false);
    expect(parseImageDimensions("1000 1400")).toEqual({
      width: 1000,
      height: 1400,
    });
    expect(commands.every(([executable]) => executable?.startsWith("/usr/bin/"))).toBe(true);
  });

  test("transcribes an object-staged audio source with verbose timestamps", async () => {
    const root = await workspace();
    const source = new TextEncoder().encode("audio-fixture");
    await writeFile(join(root, "input", "source"), source);
    const manifest: LocalTranscriptionWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "local-transcription.v1",
      source: {
        path: "input/source",
        digest: digest(source),
        byteSize: source.byteLength,
        mimeType: "audio/mpeg",
      },
      modelId: "selfhost/whisper-large-v3-turbo-q5_0",
      modelRevision: "whisper-large-v3-turbo-q5_0-2026-08",
      language: "fr",
      maximumSeconds: 60,
      timestamps: "segment",
    };
    const commands: string[][] = [];
    const runner: CommandRunner = async (executable, argv) => {
      commands.push([executable, ...argv]);
      if (executable.endsWith("ffprobe")) return result({ stdout: "12.5\n" });
      await writeFile(
        join(root, "tmp", "whisper-result.json"),
        JSON.stringify({
          result: { language: "fr" },
          transcription: [
            { offsets: { from: 0, to: 5_000 }, text: "Bonjour" },
            { offsets: { from: 5_000, to: 12_500 }, text: "la classe" },
          ],
        }),
      );
      return result();
    };
    const output = await runLocalTranscriptionWorker(manifest, runner, root);
    expect(output).toMatchObject({
      text: "Bonjour la classe",
      language: "fr",
      durationMs: 12_500,
      networkAccess: false,
    });
    expect(output.segments).toHaveLength(2);
    expect(commands[1]).toEqual([
      "/usr/bin/whisper-cli",
      ...whisperArguments(manifest, root),
    ]);
  });

  test("splits and renders the exact requested PDF page with immutable geometry", async () => {
    const root = await workspace();
    const source = new TextEncoder().encode("pdf-fixture");
    await writeFile(join(root, "input", "source"), source);
    const manifest: CorpusDerivativeWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "corpus-derivatives.v1",
      source: {
        path: "input/source",
        digest: digest(source),
        byteSize: source.byteLength,
        mimeType: "application/pdf",
      },
      request: {
        kind: "pdf",
        maximumDimension: 1_024,
        units: [{ unitId: "chunk-7", page: 7 }],
      },
    };
    const commands: string[][] = [];
    const runner: CommandRunner = async (executable, argv) => {
      commands.push([executable, ...argv]);
      if (executable.endsWith("pdfinfo")) {
        return result({
          stdout: argv.length === 1
            ? "Pages:          8\n"
            : "Page    7 size: 612 x 792 pts\nPage    7 rot: 90\n",
        });
      }
      if (executable.endsWith("pdfseparate")) {
        const template = argv.at(-1)!;
        await writeFile(template.replace("%d", "7"), "%PDF-1.4\n%%EOF\n");
        return result();
      }
      const prefix = argv.at(-1)!;
      await writeFile(`${prefix}.png`, "PNG-fixture");
      return result();
    };
    const output = await produceCorpusDerivatives(manifest, runner, root);
    expect(output.kind).toBe("pdf");
    if (output.kind !== "pdf") throw new Error("Expected PDF derivatives");
    expect(output.units[0]).toMatchObject({
      unitId: "chunk-7",
      page: 7,
      rotationDegrees: 90,
      widthPoints: 612,
      heightPoints: 792,
    });
    expect(commands.some(([executable]) => executable?.endsWith("pdfseparate"))).toBe(true);
    expect(
      parsePdfGeometry(
        "Page    7 size: 612 x 792 pts\nPage    7 rot: 270\n",
        7,
      ).rotationDegrees,
    ).toBe(270);
  });

  test("discovers media duration without producing a synthetic derivative", async () => {
    const root = await workspace();
    const source = new TextEncoder().encode("video-fixture");
    await writeFile(join(root, "input", "source"), source);
    const manifest: CorpusDerivativeWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "corpus-derivatives.v1",
      source: {
        path: "input/source",
        digest: digest(source),
        byteSize: source.byteLength,
        mimeType: "video/mp4",
      },
      request: { kind: "media-probe", modality: "video" },
    };
    const commands: string[][] = [];
    const runner: CommandRunner = async (executable, argv) => {
      commands.push([executable, ...argv]);
      return result({
        stdout: JSON.stringify({
          format: { duration: "250.000" },
          streams: [
            { codec_type: "video" },
            { codec_type: "audio" },
          ],
        }),
      });
    };
    const output = await produceCorpusDerivatives(manifest, runner, root);
    expect(output).toEqual({
      schemaVersion: 1,
      worker: "corpus-derivatives.v1",
      kind: "media-probe",
      modality: "video",
      durationMs: 250_000,
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.[0]).toBe("/usr/bin/ffprobe");
    expect(await readdir(join(root, "output"))).toEqual([]);
  });

  test("builds a LaTeX fixture through an injected fixed-command runner", async () => {
    const root = await workspace();
    const source = new TextEncoder().encode("\\documentclass{article}");
    await writeFile(join(root, "input", "main.tex"), source);
    const manifest: LatexWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "latex-build.v1",
      source: {
        path: "input/main.tex",
        digest: digest(source),
        byteSize: source.byteLength,
      },
      engine: "tectonic",
      shellEscape: false,
      maximumPages: 2,
    };
    const commands: string[][] = [];
    const runner: CommandRunner = async (executable, argv) => {
      commands.push([executable, ...argv]);
      if (executable.endsWith("tectonic")) {
        await writeFile(join(root, "output", "main.pdf"), "%PDF-1.7\n%%EOF\n");
        await writeFile(join(root, "output", "main.log"), "ok");
        return result();
      }
      return result({ stdout: "Pages: 1\n" });
    };
    const output = await buildLatex(manifest, runner, root);
    expect(output.pageCount).toBe(1);
    expect(commands[0]).toEqual([
      "/usr/bin/tectonic",
      ...tectonicArguments(manifest, root),
    ]);
  });

  test("segments a media fixture and publishes contiguous descriptors", async () => {
    const root = await workspace();
    const source = new TextEncoder().encode("media-fixture");
    await writeFile(join(root, "input", "source"), source);
    const manifest: MediaSegmentWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "media-segment.v1",
      source: {
        path: "input/source",
        digest: digest(source),
        byteSize: source.byteLength,
        mimeType: "audio/mpeg",
      },
      segmentSeconds: 60,
      maxDurationSeconds: 300,
      outputCodec: "mp3-mono-16khz",
    };
    const runner: CommandRunner = async (executable) => {
      if (executable.endsWith("ffprobe")) {
        return result({
          stdout: JSON.stringify({
            format: { duration: "90" },
            streams: [{ codec_type: "audio", codec_name: "mp3", channels: 2 }],
          }),
        });
      }
      await writeFile(join(root, "output", "segment-000.mp3"), "ID3first");
      await writeFile(join(root, "output", "segment-001.mp3"), "ID3second");
      return result();
    };
    const output = await extractSegments(manifest, runner, root);
    expect(output.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([
      [0, 60_000],
      [60_000, 90_000],
    ]);
  });

  test("downloads video audio into ordered provider-safe MP3 segments", async () => {
    const root = await workspace();
    const manifest: VideoAudioExtractWorkerManifestV2 = {
      schemaVersion: 2,
      worker: "video-audio-extract.v2",
      request: {
        schemaVersion: 2,
        canonicalUrl: "https://youtu.be/dQw4w9WgXcQ",
        provider: "youtube",
        maxDurationSeconds: 300,
        maxDownloadBytes: 10_000_000,
        outputCodec: "mp3-mono-16khz",
        segmentSeconds: 60,
        maximumSegmentBytes: 32 * 1024 * 1024,
      },
      requestedLanguage: "fr",
      consentRevision: "v1",
      egressPolicyDigest: digest(new TextEncoder().encode("policy")),
    };
    const runner: CommandRunner = async (executable, argv) => {
      if (executable.endsWith("yt-dlp")) {
        await writeFile(join(root, "tmp", "source.webm"), "webm-fixture");
        return result();
      }
      if (executable.endsWith("ffmpeg")) {
        await writeFile(
          join(root, "output", "audio-segment-000.mp3"),
          "ID3first",
        );
        await writeFile(
          join(root, "output", "audio-segment-001.mp3"),
          "ID3second",
        );
        return result();
      }
      const target = String(argv.at(-1));
      const duration = target.endsWith("audio-segment-000.mp3")
        ? "60"
        : target.endsWith("audio-segment-001.mp3")
          ? "30"
          : "90";
      return result({
        stdout: JSON.stringify({
          format: { duration },
          streams: [
            {
              codec_type: "audio",
              codec_name: target.endsWith("source.webm") ? "opus" : "mp3",
              channels: target.endsWith("source.webm") ? 2 : 1,
              sample_rate: target.endsWith("source.webm") ? "48000" : "16000",
            },
          ],
        }),
      });
    };
    const output = await extractVideoAudioSegments(manifest, runner, root);
    expect(output.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([
      [0, 60_000],
      [60_000, 90_000],
    ]);
    expect(output.segments.every((segment) => segment.audio.byteSize < 32 * 1024 * 1024)).toBe(true);
  });

  test("renders a bounded preview fixture without exposing command injection", async () => {
    const root = await workspace();
    const source = new TextEncoder().encode("PNG-fixture");
    await writeFile(join(root, "input", "source"), source);
    const manifest: MaterialPreviewWorkerManifestV1 = {
      schemaVersion: 1,
      worker: "material-preview.v1",
      source: {
        path: "input/source",
        digest: digest(source),
        byteSize: source.byteLength,
        mimeType: "image/png",
      },
      maximumDimension: 512,
    };
    const runner: CommandRunner = async (_executable, argv) => {
      if (argv[0] === "identify") return result({ stdout: "512 256" });
      await writeFile(join(root, "output", "preview.webp"), "RIFFxxxxWEBPfixture");
      return result();
    };
    const output = await renderMaterialPreviewWorker(manifest, runner, root);
    expect([output.width, output.height]).toEqual([512, 256]);
  });
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "avermate-worker-test-"));
  roots.push(root);
  await Promise.all([
    mkdir(join(root, "input")),
    mkdir(join(root, "output")),
    mkdir(join(root, "tmp")),
  ]);
  return root;
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function result(
  overrides: Partial<Awaited<ReturnType<CommandRunner>>> = {},
): Awaited<ReturnType<CommandRunner>> {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}
