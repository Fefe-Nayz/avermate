import {
  corpusDerivativeWorkerManifestV1Schema,
  corpusDerivativeWorkerOutputV1Schema,
  type CorpusDerivativeWorkerManifestV1,
  type CorpusDerivativeWorkerOutputV1,
} from "@avermate/agent-contracts";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import {
  INPUT_MANIFEST_PATH,
  OUTPUT_ROOT,
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

const PDFINFO = "/usr/bin/pdfinfo";
const PDFSEPARATE = "/usr/bin/pdfseparate";
const PDFTOPPM = "/usr/bin/pdftoppm";
const MAGICK = "/usr/bin/magick";
const FFPROBE = "/usr/bin/ffprobe";
const FFMPEG = "/usr/bin/ffmpeg";
const RESULT_PATH = `${OUTPUT_ROOT}/derivatives.json`;

export interface CorpusDerivativesCli {
  readonly input: string;
  readonly manifest: string;
}

export function corpusDerivativesCli(
  argv: readonly string[],
): CorpusDerivativesCli {
  const parsed = parseExactOptions(argv, ["input", "manifest"]);
  if (
    parsed.input !== INPUT_MANIFEST_PATH ||
    parsed.manifest !== RESULT_PATH
  ) {
    throw new Error("CORPUS_DERIVATIVE_WORKER_PATH_INVALID");
  }
  return Object.freeze({
    input: parsed.input,
    manifest: parsed.manifest,
  });
}

type PdfGeometry = {
  widthPoints: number;
  heightPoints: number;
  rotationDegrees: 0 | 90 | 180 | 270;
};

function parsePositiveNumber(value: string | undefined, code: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

export function parsePdfPageCount(stdout: string) {
  const pages = Number(/^Pages:\s+(\d+)\s*$/imu.exec(stdout)?.[1]);
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 10_000) {
    throw new Error("PDF_DERIVATIVE_PAGE_COUNT_INVALID");
  }
  return pages;
}

export function parsePdfGeometry(stdout: string, page: number): PdfGeometry {
  const escapedPage = String(page).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const size = new RegExp(
    `^Page\\s+${escapedPage}\\s+size:\\s*([0-9.]+)\\s+x\\s+([0-9.]+)\\s+pts`,
    "imu",
  ).exec(stdout);
  const genericSize = /^Page size:\s*([0-9.]+)\s+x\s+([0-9.]+)\s+pts/imu.exec(
    stdout,
  );
  const rotation = new RegExp(
    `^Page\\s+${escapedPage}\\s+rot:\\s*(0|90|180|270)\\s*$`,
    "imu",
  ).exec(stdout);
  const genericRotation = /^Page rot:\s*(0|90|180|270)\s*$/imu.exec(stdout);
  const widthPoints = parsePositiveNumber(
    size?.[1] ?? genericSize?.[1],
    "PDF_DERIVATIVE_WIDTH_INVALID",
  );
  const heightPoints = parsePositiveNumber(
    size?.[2] ?? genericSize?.[2],
    "PDF_DERIVATIVE_HEIGHT_INVALID",
  );
  const rotationDegrees = Number(
    rotation?.[1] ?? genericRotation?.[1] ?? 0,
  );
  if (![0, 90, 180, 270].includes(rotationDegrees)) {
    throw new Error("PDF_DERIVATIVE_ROTATION_INVALID");
  }
  return {
    widthPoints,
    heightPoints,
    rotationDegrees: rotationDegrees as PdfGeometry["rotationDegrees"],
  };
}

function fixed(value: number, digits: number) {
  return String(value).padStart(digits, "0");
}

async function pdfDerivatives(
  manifest: CorpusDerivativeWorkerManifestV1 & {
    request: Extract<CorpusDerivativeWorkerManifestV1["request"], { kind: "pdf" }>;
  },
  runner: CommandRunner,
  root: string,
): Promise<CorpusDerivativeWorkerOutputV1> {
  const sourcePath = workspacePath(manifest.source.path, root);
  const inspection = await runner(PDFINFO, [sourcePath], {
    cwd: root,
    timeoutMs: 20_000,
  });
  requireCommandSuccess(inspection, "pdf-derivative-inspection");
  const totalPages = parsePdfPageCount(inspection.stdout);
  const units = [];
  for (const unit of manifest.request.units) {
    if (unit.page > totalPages) {
      throw new Error("PDF_DERIVATIVE_PAGE_OUT_OF_RANGE");
    }
    const page = fixed(unit.page, 5);
    const splitTemplate = join(root, "tmp", `split-${page}-%d.pdf`);
    requireCommandSuccess(
      await runner(
        PDFSEPARATE,
        [
          "-f",
          String(unit.page),
          "-l",
          String(unit.page),
          sourcePath,
          splitTemplate,
        ],
        { cwd: root, timeoutMs: 20_000 },
      ),
      "pdf-page-split",
    );
    const pageRelative = `output/page-${page}.pdf`;
    const pagePath = workspacePath(pageRelative, root);
    await rename(join(root, "tmp", `split-${page}-${unit.page}.pdf`), pagePath);
    const geometryResult = await runner(
      PDFINFO,
      ["-f", String(unit.page), "-l", String(unit.page), "-box", sourcePath],
      { cwd: root, timeoutMs: 10_000 },
    );
    requireCommandSuccess(geometryResult, "pdf-page-geometry");
    const geometry = parsePdfGeometry(geometryResult.stdout, unit.page);
    const imagePrefix = join(root, "tmp", `render-${page}`);
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
          String(manifest.request.maximumDimension),
          "-png",
          pagePath,
          imagePrefix,
        ],
        { cwd: root, timeoutMs: 30_000 },
      ),
      "pdf-page-render",
    );
    const imageRelative = `output/page-${page}.png`;
    await rename(`${imagePrefix}.png`, workspacePath(imageRelative, root));
    units.push({
      unitId: unit.unitId,
      page: unit.page,
      ...geometry,
      pdf: await outputFile(root, pageRelative, "application/pdf", 100 * 1024 ** 2),
      image: await outputFile(root, imageRelative, "image/png", 32 * 1024 ** 2),
    });
  }
  return corpusDerivativeWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "corpus-derivatives.v1",
    kind: "pdf",
    totalPages,
    units,
  });
}

function imageArguments(input: {
  sourcePath: string;
  outputPath: string;
  maximumDimension: number;
}) {
  return Object.freeze([
    "-limit",
    "memory",
    "256MiB",
    "-limit",
    "map",
    "512MiB",
    "-limit",
    "disk",
    "512MiB",
    "-limit",
    "thread",
    "1",
    input.sourcePath,
    "-auto-orient",
    "-thumbnail",
    `${input.maximumDimension}x${input.maximumDimension}>`,
    "-strip",
    input.outputPath,
  ]);
}

function parseImageGeometry(stdout: string) {
  const match = /^(\d+)\s+(\d+)$/u.exec(stdout.trim());
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4_096 ||
    height > 4_096
  ) {
    throw new Error("IMAGE_DERIVATIVE_GEOMETRY_INVALID");
  }
  return { width, height };
}

async function imageDerivative(
  manifest: CorpusDerivativeWorkerManifestV1 & {
    request: Extract<CorpusDerivativeWorkerManifestV1["request"], { kind: "image" }>;
  },
  runner: CommandRunner,
  root: string,
): Promise<CorpusDerivativeWorkerOutputV1> {
  const sourcePath = workspacePath(manifest.source.path, root);
  const imagePath = workspacePath("output/image.png", root);
  requireCommandSuccess(
    await runner(
      MAGICK,
      imageArguments({
        sourcePath,
        outputPath: imagePath,
        maximumDimension: manifest.request.maximumDimension,
      }),
      { cwd: root, timeoutMs: 30_000 },
    ),
    "image-derivative-render",
  );
  const inspection = await runner(
    MAGICK,
    ["identify", "-format", "%w %h", imagePath],
    { cwd: root, timeoutMs: 5_000 },
  );
  requireCommandSuccess(inspection, "image-derivative-identify");
  const geometry = parseImageGeometry(inspection.stdout);
  return corpusDerivativeWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "corpus-derivatives.v1",
    kind: "image",
    unitId: manifest.request.unitId,
    ...geometry,
    image: await outputFile(root, "output/image.png", "image/png", 32 * 1024 ** 2),
  });
}

type MediaProbe = {
  durationMs: number;
  hasAudio: boolean;
  hasVideo: boolean;
};

async function probeMedia(
  sourcePath: string,
  runner: CommandRunner,
  root: string,
): Promise<MediaProbe> {
  const result = await runner(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      sourcePath,
    ],
    { cwd: root, timeoutMs: 20_000, stdoutBytes: 256 * 1024 },
  );
  requireCommandSuccess(result, "media-derivative-probe");
  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string }>;
  };
  const durationMs = Math.round(Number(parsed.format?.duration) * 1_000);
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > 8 * 60 * 60_000
  ) {
    throw new Error("MEDIA_DERIVATIVE_DURATION_INVALID");
  }
  return {
    durationMs,
    hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio")),
    hasVideo: Boolean(parsed.streams?.some((stream) => stream.codec_type === "video")),
  };
}

export function audioDerivativeArguments(input: {
  sourcePath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
}) {
  return Object.freeze([
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-i",
    input.sourcePath,
    "-ss",
    (input.startMs / 1_000).toFixed(3),
    "-t",
    ((input.endMs - input.startMs) / 1_000).toFixed(3),
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "48k",
    input.outputPath,
  ]);
}

export function videoDerivativeArguments(input: {
  sourcePath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  maximumDimension: number;
  hasAudio: boolean;
}) {
  return Object.freeze([
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-i",
    input.sourcePath,
    "-ss",
    (input.startMs / 1_000).toFixed(3),
    "-t",
    ((input.endMs - input.startMs) / 1_000).toFixed(3),
    "-map",
    "0:v:0",
    ...(input.hasAudio ? ["-map", "0:a:0"] : []),
    "-vf",
    `scale=${input.maximumDimension}:${input.maximumDimension}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=12`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    ...(input.hasAudio
      ? ["-c:a", "aac", "-b:a", "96k", "-ar", "48000"]
      : ["-an"]),
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);
}

async function timedDerivatives(
  manifest: CorpusDerivativeWorkerManifestV1 & {
    request: Extract<
      CorpusDerivativeWorkerManifestV1["request"],
      { kind: "audio" | "video" }
    >;
  },
  runner: CommandRunner,
  root: string,
): Promise<CorpusDerivativeWorkerOutputV1> {
  const sourcePath = workspacePath(manifest.source.path, root);
  const probe = await probeMedia(sourcePath, runner, root);
  if (
    (manifest.request.kind === "audio" && !probe.hasAudio) ||
    (manifest.request.kind === "video" && !probe.hasVideo)
  ) {
    throw new Error("MEDIA_DERIVATIVE_STREAM_MISSING");
  }
  const units = [];
  for (const [index, unit] of manifest.request.units.entries()) {
    if (unit.endMs > probe.durationMs + 1_000) {
      throw new Error("MEDIA_DERIVATIVE_WINDOW_OUT_OF_RANGE");
    }
    const extension = manifest.request.kind === "audio" ? "mp3" : "mp4";
    const relativePath = `output/${manifest.request.kind}-${fixed(index, 3)}.${extension}`;
    const outputPath = workspacePath(relativePath, root);
    const argv =
      manifest.request.kind === "audio"
        ? audioDerivativeArguments({
            sourcePath,
            outputPath,
            startMs: unit.startMs,
            endMs: unit.endMs,
          })
        : videoDerivativeArguments({
            sourcePath,
            outputPath,
            startMs: unit.startMs,
            endMs: unit.endMs,
            maximumDimension: manifest.request.maximumDimension,
            hasAudio: probe.hasAudio,
          });
    requireCommandSuccess(
      await runner(FFMPEG, argv, { cwd: root, timeoutMs: 3 * 60_000 }),
      `${manifest.request.kind}-derivative-render`,
    );
    units.push({
      unitId: unit.unitId,
      index,
      startMs: unit.startMs,
      endMs: unit.endMs,
      file: await outputFile(
        root,
        relativePath,
        manifest.request.kind === "audio" ? "audio/mpeg" : "video/mp4",
        100 * 1024 ** 2,
      ),
    });
  }
  return corpusDerivativeWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "corpus-derivatives.v1",
    kind: manifest.request.kind,
    durationMs: probe.durationMs,
    units,
  });
}

export async function produceCorpusDerivatives(
  manifest: CorpusDerivativeWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
): Promise<CorpusDerivativeWorkerOutputV1> {
  const sourcePath = workspacePath(manifest.source.path, root);
  await verifyInputFile({
    absolutePath: sourcePath,
    expectedDigest: manifest.source.digest,
    expectedBytes: manifest.source.byteSize,
  });
  if (manifest.request.kind === "pdf") {
    return pdfDerivatives(
      manifest as CorpusDerivativeWorkerManifestV1 & {
        request: Extract<
          CorpusDerivativeWorkerManifestV1["request"],
          { kind: "pdf" }
        >;
      },
      runner,
      root,
    );
  }
  if (manifest.request.kind === "image") {
    return imageDerivative(
      manifest as CorpusDerivativeWorkerManifestV1 & {
        request: Extract<
          CorpusDerivativeWorkerManifestV1["request"],
          { kind: "image" }
        >;
      },
      runner,
      root,
    );
  }
  if (manifest.request.kind === "media-probe") {
    const probe = await probeMedia(sourcePath, runner, root);
    if (
      (manifest.request.modality === "audio" && !probe.hasAudio) ||
      (manifest.request.modality === "video" && !probe.hasVideo)
    ) {
      throw new Error("MEDIA_DERIVATIVE_STREAM_MISSING");
    }
    return corpusDerivativeWorkerOutputV1Schema.parse({
      schemaVersion: 1,
      worker: "corpus-derivatives.v1",
      kind: "media-probe",
      modality: manifest.request.modality,
      durationMs: probe.durationMs,
    });
  }
  return timedDerivatives(
    manifest as CorpusDerivativeWorkerManifestV1 & {
      request: Extract<
        CorpusDerivativeWorkerManifestV1["request"],
        { kind: "audio" | "video" }
      >;
    },
    runner,
    root,
  );
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = corpusDerivativesCli(argv);
  await prepareWorkspace();
  const manifest = await readJsonManifest(
    cli.input,
    corpusDerivativeWorkerManifestV1Schema,
  );
  await writeJsonOutput(
    cli.manifest,
    await produceCorpusDerivatives(manifest),
    8 * 1024 * 1024,
  );
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "CORPUS_DERIVATIVE_WORKER_FAILED",
    );
    process.exitCode = 1;
  });
}
