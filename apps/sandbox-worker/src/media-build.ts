import {
  materialPreviewWorkerManifestV1Schema,
  materialPreviewWorkerOutputV1Schema,
  mediaSegmentWorkerManifestV1Schema,
  mediaSegmentWorkerOutputV1Schema,
  mediaTimelineRenderWorkerManifestV1Schema,
  mediaTimelineRenderWorkerOutputV1Schema,
  videoAudioExtractWorkerManifestV1Schema,
  videoAudioExtractWorkerOutputV1Schema,
  type MaterialPreviewWorkerManifestV1,
  type MediaSegmentWorkerManifestV1,
  type MediaTimelineRenderWorkerManifestV1,
  type VideoAudioExtractWorkerManifestV1,
} from "@avermate/agent-contracts";
import { readdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  INPUT_MANIFEST_PATH,
  OUTPUT_ROOT,
  TMP_ROOT,
  type CommandRunner,
  outputFile,
  parseExactOptions,
  prepareWorkspace,
  readJsonManifest,
  requireCommandSuccess,
  runCommand,
  verifyInputFile,
  workspacePath,
  writeJsonOutput,
} from "./runtime";

const FFMPEG = "/usr/bin/ffmpeg";
const FFPROBE = "/usr/bin/ffprobe";
const YT_DLP = "/usr/bin/yt-dlp";
const MAGICK = "/usr/bin/magick";
const PDFTOPPM = "/usr/bin/pdftoppm";

export type MediaBuildOperation =
  | "extract-video-audio"
  | "extract-segments"
  | "render-timeline"
  | "material-preview";

export interface MediaBuildCli {
  readonly operation: MediaBuildOperation;
  readonly input: string;
  readonly output: string;
  readonly manifest: string;
}

const operationOutputs = {
  "extract-video-audio": `${OUTPUT_ROOT}/audio.wav`,
  "extract-segments": OUTPUT_ROOT,
  "render-timeline": `${OUTPUT_ROOT}/video.mp4`,
  "material-preview": `${OUTPUT_ROOT}/preview.webp`,
} satisfies Record<MediaBuildOperation, string>;

const operationManifests = {
  "extract-video-audio": `${OUTPUT_ROOT}/extraction.json`,
  "extract-segments": `${OUTPUT_ROOT}/segments.json`,
  "render-timeline": `${OUTPUT_ROOT}/render.json`,
  "material-preview": `${OUTPUT_ROOT}/preview.json`,
} satisfies Record<MediaBuildOperation, string>;

export function mediaBuildCli(argv: readonly string[]): MediaBuildCli {
  const operation = argv[0] as MediaBuildOperation | undefined;
  if (!operation || !(operation in operationOutputs)) {
    throw new Error("MEDIA_OPERATION_INVALID");
  }
  const parsed = parseExactOptions(argv.slice(1), ["input", "output", "manifest"]);
  if (
    parsed.input !== INPUT_MANIFEST_PATH ||
    parsed.output !== operationOutputs[operation] ||
    parsed.manifest !== operationManifests[operation]
  ) {
    throw new Error("MEDIA_WORKER_PATH_INVALID");
  }
  return Object.freeze({
    operation,
    input: parsed.input,
    output: parsed.output,
    manifest: parsed.manifest,
  });
}

export function youtubeDownloadArguments(
  manifest: VideoAudioExtractWorkerManifestV1,
): readonly string[] {
  const canonicalUrl = canonicalYoutubeUrl(manifest.request.canonicalUrl);
  return Object.freeze([
    "--no-config",
    "--no-playlist",
    "--no-warnings",
    "--no-call-home",
    "--no-write-info-json",
    "--no-write-thumbnail",
    "--no-write-subs",
    "--no-cookies-from-browser",
    "--max-filesize",
    String(manifest.request.maxDownloadBytes),
    "--match-filter",
    `duration <= ${manifest.request.maxDurationSeconds} & !is_live`,
    "--format",
    "bestaudio[protocol^=https]/bestaudio",
    "--output",
    `${TMP_ROOT}/source.%(ext)s`,
    "--",
    canonicalUrl,
  ]);
}

export function audioTranscodeArguments(sourcePath: string): readonly string[] {
  assertDiscoveredMediaPath(sourcePath);
  return Object.freeze([
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    `${OUTPUT_ROOT}/audio.wav`,
  ]);
}

export function mediaSegmentArguments(
  manifest: MediaSegmentWorkerManifestV1,
  root = "/workspace",
): readonly string[] {
  const source = workspacePath(manifest.source.path, root);
  return Object.freeze([
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-t",
    String(manifest.maxDurationSeconds),
    "-i",
    source,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "48k",
    "-f",
    "segment",
    "-segment_time",
    String(manifest.segmentSeconds),
    "-reset_timestamps",
    "1",
    root.startsWith("/")
      ? posix.join(root, "output", "segment-%03d.mp3")
      : join(root, "output", "segment-%03d.mp3"),
  ]);
}

export function materialPreviewArguments(input: {
  sourcePath: string;
  imagePath: string;
  outputPath: string;
  maximumDimension: number;
  root?: string;
}): readonly string[] {
  assertWorkspaceAbsolute(input.sourcePath, input.root);
  assertWorkspaceAbsolute(input.imagePath, input.root);
  assertWorkspaceAbsolute(input.outputPath, input.root);
  return Object.freeze([
    "-limit",
    "memory",
    "128MiB",
    "-limit",
    "map",
    "256MiB",
    "-limit",
    "disk",
    "256MiB",
    "-limit",
    "thread",
    "1",
    input.imagePath,
    "-auto-orient",
    "-thumbnail",
    `${input.maximumDimension}x${input.maximumDimension}>`,
    "-strip",
    "-quality",
    "82",
    input.outputPath,
  ]);
}

export function timelineFfmpegArguments(
  manifest: MediaTimelineRenderWorkerManifestV1,
  root = "/workspace",
): readonly string[] {
  const assets = exactTimelineAssets(manifest);
  const argv: string[] = ["-nostdin", "-hide_banner", "-loglevel", "error"];
  const filters: string[] = [];
  const durations: number[] = [];
  manifest.timeline.scenes.forEach((scene, index) => {
    const seconds = scene.durationMs / 1_000;
    durations.push(seconds);
    const visual = assets.get(assetKey(scene.visual.artifactRevisionId, scene.visual.digest));
    if (!visual) throw new Error("TIMELINE_VISUAL_ASSET_MISSING");
    argv.push(
      "-loop",
      "1",
      "-framerate",
      String(manifest.timeline.fps),
      "-t",
      seconds.toFixed(3),
      "-i",
      workspacePath(visual.path, root),
    );
    if (scene.narration) {
      const narration = assets.get(
        assetKey(scene.narration.artifactRevisionId, scene.narration.digest),
      );
      if (!narration) throw new Error("TIMELINE_NARRATION_ASSET_MISSING");
      argv.push("-i", workspacePath(narration.path, root));
    } else {
      argv.push(
        "-f",
        "lavfi",
        "-t",
        seconds.toFixed(3),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
    }
    filters.push(
      `[${index * 2}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=${manifest.timeline.fps},trim=duration=${seconds.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
      `[${index * 2 + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${seconds.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });

  let videoLabel = "v0";
  let audioLabel = "a0";
  let currentDuration = durations[0] ?? 0;
  for (let index = 1; index < manifest.timeline.scenes.length; index += 1) {
    const transition = manifest.timeline.scenes[index]?.transition;
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    if (transition === "crossfade") {
      const fade = Math.min(
        0.5,
        (durations[index - 1] ?? 0) / 4,
        (durations[index] ?? 0) / 4,
      );
      const offset = Math.max(0, currentDuration - fade);
      filters.push(
        `[${videoLabel}][v${index}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[${nextVideo}]`,
        `[${audioLabel}][a${index}]acrossfade=d=${fade.toFixed(3)}[${nextAudio}]`,
      );
      currentDuration += (durations[index] ?? 0) - fade;
    } else {
      filters.push(
        `[${videoLabel}][v${index}]concat=n=2:v=1:a=0[${nextVideo}]`,
        `[${audioLabel}][a${index}]concat=n=2:v=0:a=1[${nextAudio}]`,
      );
      currentDuration += durations[index] ?? 0;
    }
    videoLabel = nextVideo;
    audioLabel = nextAudio;
  }
  const totalSeconds =
    manifest.timeline.scenes.reduce((sum, scene) => sum + scene.durationMs, 0) /
    1_000;
  const padding = Math.max(0, totalSeconds - currentDuration);
  filters.push(
    `[${videoLabel}]tpad=stop_mode=clone:stop_duration=${padding.toFixed(3)},trim=duration=${totalSeconds.toFixed(3)}[vout]`,
    `[${audioLabel}]apad=pad_dur=${padding.toFixed(3)},atrim=duration=${totalSeconds.toFixed(3)}[aout]`,
  );
  argv.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(manifest.timeline.fps),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-t",
    totalSeconds.toFixed(3),
    workspacePath("output/video.mp4", root),
  );
  return Object.freeze(argv);
}

export async function extractVideoAudio(
  manifest: VideoAudioExtractWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  requireCommandSuccess(
    await runner(YT_DLP, youtubeDownloadArguments(manifest), {
      cwd: root,
      timeoutMs: 10 * 60_000,
    }),
    "youtube-download",
  );
  const entries = (await readdir(join(root, "tmp")))
    .filter((name) => /^source\.[a-zA-Z0-9]{1,12}$/u.test(name))
    .sort();
  if (entries.length !== 1) throw new Error("VIDEO_SOURCE_FILE_INVALID");
  const sourcePath = join(root, "tmp", entries[0]!);
  requireCommandSuccess(
    await runner(FFMPEG, audioTranscodeArguments(sourcePath), {
      cwd: root,
      timeoutMs: 5 * 60_000,
    }),
    "audio-transcode",
  );
  const probe = await probeMedia(join(root, "output", "audio.wav"), runner, root);
  if (
    probe.durationMs > manifest.request.maxDurationSeconds * 1_000 ||
    probe.audioCodec !== "pcm_s16le" ||
    probe.channels !== 1 ||
    probe.sampleRate !== 16_000
  ) {
    throw new Error("EXTRACTED_AUDIO_PROPERTIES_INVALID");
  }
  const result = videoAudioExtractWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "video-audio-extract.v1",
    audio: await outputFile(root, "output/audio.wav", "audio/wav", manifest.request.maxDownloadBytes),
    durationMs: probe.durationMs,
    codec: "pcm_s16le",
    sampleRate: 16_000,
    channels: 1,
  });
  return result;
}

export async function extractSegments(
  manifest: MediaSegmentWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  const sourcePath = workspacePath(manifest.source.path, root);
  await verifyInputFile({
    absolutePath: sourcePath,
    expectedDigest: manifest.source.digest,
    expectedBytes: manifest.source.byteSize,
  });
  const sourceProbe = await probeMedia(sourcePath, runner, root);
  if (
    sourceProbe.durationMs > manifest.maxDurationSeconds * 1_000 ||
    sourceProbe.streamCount < 1 ||
    !sourceProbe.audioCodec
  ) {
    throw new Error("MEDIA_SOURCE_PROPERTIES_INVALID");
  }
  requireCommandSuccess(
    await runner(FFMPEG, mediaSegmentArguments(manifest, root), {
      cwd: root,
      timeoutMs: 15 * 60_000,
    }),
    "media-segment",
  );
  const names = (await readdir(join(root, "output")))
    .filter((name) => /^segment-\d{3}\.mp3$/u.test(name))
    .sort();
  if (names.length < 1 || names.length > 1_000) {
    throw new Error("MEDIA_SEGMENT_COUNT_INVALID");
  }
  const segments = await Promise.all(
    names.map(async (name, index) => {
      const startMs = index * manifest.segmentSeconds * 1_000;
      const endMs = Math.min(
        sourceProbe.durationMs,
        (index + 1) * manifest.segmentSeconds * 1_000,
      );
      return {
        index,
        startMs,
        endMs,
        file: await outputFile(
          root,
          `output/${name}`,
          "audio/mpeg",
          128 * 1024 * 1024,
        ),
      };
    }),
  );
  return mediaSegmentWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "media-segment.v1",
    durationMs: sourceProbe.durationMs,
    segments,
  });
}

export async function renderMaterialPreviewWorker(
  manifest: MaterialPreviewWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  const sourcePath = workspacePath(manifest.source.path, root);
  await verifyInputFile({
    absolutePath: sourcePath,
    expectedDigest: manifest.source.digest,
    expectedBytes: manifest.source.byteSize,
  });
  let imagePath = sourcePath;
  if (manifest.source.mimeType === "application/pdf") {
    const prefix = join(root, "tmp", "preview-source");
    requireCommandSuccess(
      await runner(
        PDFTOPPM,
        [
          "-f",
          "1",
          "-l",
          "1",
          "-singlefile",
          "-scale-to",
          String(manifest.maximumDimension),
          "-png",
          sourcePath,
          prefix,
        ],
        { cwd: root, timeoutMs: 20_000 },
      ),
      "pdf-preview",
    );
    imagePath = `${prefix}.png`;
  }
  const outputPath = join(root, "output", "preview.webp");
  requireCommandSuccess(
    await runner(
      MAGICK,
      materialPreviewArguments({
        sourcePath,
        imagePath,
        outputPath,
        maximumDimension: manifest.maximumDimension,
        root,
      }),
      { cwd: root, timeoutMs: 20_000 },
    ),
    "image-preview",
  );
  const identify = await runner(
    MAGICK,
    ["identify", "-format", "%w %h", outputPath],
    { cwd: root, timeoutMs: 5_000 },
  );
  requireCommandSuccess(identify, "image-identify");
  const match = /^(\d+)\s+(\d+)$/u.exec(identify.stdout.trim());
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > manifest.maximumDimension ||
    height > manifest.maximumDimension
  ) {
    throw new Error("PREVIEW_DIMENSIONS_INVALID");
  }
  return materialPreviewWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "material-preview.v1",
    preview: await outputFile(root, "output/preview.webp", "image/webp", 8 * 1024 * 1024),
    width,
    height,
  });
}

export async function renderTimeline(
  manifest: MediaTimelineRenderWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  await Promise.all(
    manifest.assets.map(async (asset) => {
      await verifyInputFile({
        absolutePath: workspacePath(asset.path, root),
        expectedDigest: asset.digest,
        expectedBytes: asset.byteSize,
      });
    }),
  );
  await writeFile(join(root, "output", "captions.vtt"), timelineVtt(manifest), {
    flag: "wx",
    mode: 0o600,
  });
  requireCommandSuccess(
    await runner(FFMPEG, timelineFfmpegArguments(manifest, root), {
      cwd: root,
      timeoutMs: 15 * 60_000,
      stderrBytes: 4 * 1024 * 1024,
    }),
    "timeline-render",
  );
  const videoPath = join(root, "output", "video.mp4");
  requireCommandSuccess(
    await runner(
      FFMPEG,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1920:1080",
        join(root, "output", "poster.png"),
      ],
      { cwd: root, timeoutMs: 30_000 },
    ),
    "poster-render",
  );
  const probe = await probeMedia(videoPath, runner, root);
  const expectedDuration = manifest.timeline.scenes.reduce(
    (sum, scene) => sum + scene.durationMs,
    0,
  );
  if (
    Math.abs(probe.durationMs - expectedDuration) > 1_000 ||
    probe.width !== 1_920 ||
    probe.height !== 1_080 ||
    probe.videoCodec !== "h264" ||
    probe.audioCodec !== "aac"
  ) {
    throw new Error("TIMELINE_OUTPUT_PROPERTIES_INVALID");
  }
  return mediaTimelineRenderWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "media-timeline-render.v1",
    video: await outputFile(
      root,
      "output/video.mp4",
      "video/mp4",
      manifest.maximumOutputBytes,
    ),
    captions: await outputFile(
      root,
      "output/captions.vtt",
      "text/vtt",
      16 * 1024 * 1024,
    ),
    poster: await outputFile(root, "output/poster.png", "image/png", 32 * 1024 * 1024),
    durationMs: expectedDuration,
    width: 1_920,
    height: 1_080,
    fps: manifest.timeline.fps,
    videoCodec: "h264",
    audioCodec: "aac",
  });
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = mediaBuildCli(argv);
  await prepareWorkspace();
  const result = await (async () => {
    switch (cli.operation) {
      case "extract-video-audio":
        return extractVideoAudio(
          await readJsonManifest(cli.input, videoAudioExtractWorkerManifestV1Schema),
        );
      case "extract-segments":
        return extractSegments(
          await readJsonManifest(cli.input, mediaSegmentWorkerManifestV1Schema),
        );
      case "render-timeline":
        return renderTimeline(
          await readJsonManifest(
            cli.input,
            mediaTimelineRenderWorkerManifestV1Schema,
            8 * 1024 * 1024,
          ),
        );
      case "material-preview":
        return renderMaterialPreviewWorker(
          await readJsonManifest(cli.input, materialPreviewWorkerManifestV1Schema),
        );
    }
  })();
  await writeJsonOutput(cli.manifest, await result, 8 * 1024 * 1024);
}

function canonicalYoutubeUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? null;
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    const short = /^\/shorts\/([a-zA-Z0-9_-]{11})$/u.exec(url.pathname);
    if (short) id = short[1] ?? null;
  }
  if (!id || !/^[a-zA-Z0-9_-]{11}$/u.test(id)) {
    throw new Error("VIDEO_PROVIDER_NOT_ALLOWED");
  }
  return `https://www.youtube.com/watch?v=${id}`;
}

function assertDiscoveredMediaPath(path: string): void {
  if (!/^\/workspace\/tmp\/source\.[a-zA-Z0-9]{1,12}$/u.test(path)) {
    throw new Error("VIDEO_INPUT_PATH_INVALID");
  }
}

function assertWorkspaceAbsolute(path: string, root = "/workspace"): void {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/u, "");
  const normalizedPath = path.replaceAll("\\", "/");
  if (
    !normalizedPath.startsWith(`${normalizedRoot}/`) ||
    !/\/(?:input|output|tmp)\/[a-zA-Z0-9._/-]+$/u.test(normalizedPath) ||
    normalizedPath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
}

function assetKey(revisionId: string, digest: string): string {
  return `${revisionId}\0${digest.startsWith("sha256:") ? digest : `sha256:${digest}`}`;
}

function exactTimelineAssets(manifest: MediaTimelineRenderWorkerManifestV1) {
  return new Map(
    manifest.assets.map((asset) => [
      assetKey(asset.artifactRevisionId, asset.digest),
      asset,
    ]),
  );
}

function timelineVtt(manifest: MediaTimelineRenderWorkerManifestV1): string {
  const cues = manifest.timeline.scenes.flatMap((scene) =>
    scene.captions.map((cue) => ({
      id: `${scene.id}-${cue.id}`,
      startMs: scene.startMs + cue.startMs,
      endMs: scene.startMs + cue.endMs,
      text: cue.text,
    })),
  );
  return `WEBVTT\n\n${cues
    .map(
      (cue) =>
        `${cue.id}\n${vttTimestamp(cue.startMs)} --> ${vttTimestamp(cue.endMs)}\n${cue.text.replaceAll("-->", "→")}\n`,
    )
    .join("\n")}`;
}

function vttTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

interface MediaProbe {
  readonly durationMs: number;
  readonly streamCount: number;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly channels: number | null;
  readonly sampleRate: number | null;
}

async function probeMedia(
  absolutePath: string,
  runner: CommandRunner,
  root = "/workspace",
): Promise<MediaProbe> {
  assertWorkspaceAbsolute(absolutePath, root);
  const result = await runner(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,codec_type,width,height,channels,sample_rate",
      "-of",
      "json",
      absolutePath,
    ],
    { timeoutMs: 15_000, stdoutBytes: 256 * 1024 },
  );
  requireCommandSuccess(result, "media-probe");
  const value = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const durationSeconds = Number(value.format?.duration);
  const streams = Array.isArray(value.streams) ? value.streams.slice(0, 64) : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationMs = Math.round(durationSeconds * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new Error("MEDIA_DURATION_INVALID");
  }
  return Object.freeze({
    durationMs,
    streamCount: streams.length,
    videoCodec: stringOrNull(video?.codec_name),
    audioCodec: stringOrNull(audio?.codec_name),
    width: positiveIntegerOrNull(video?.width),
    height: positiveIntegerOrNull(video?.height),
    channels: positiveIntegerOrNull(audio?.channels),
    sampleRate: positiveIntegerOrNull(audio?.sample_rate),
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length <= 64 ? value : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "MEDIA_BUILD_FAILED");
    process.exitCode = 1;
  });
}
