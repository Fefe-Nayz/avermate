import {
  localOcrWorkerManifestV1Schema,
  localOcrWorkerOutputV1Schema,
  type LocalOcrWorkerManifestV1,
} from "@avermate/agent-contracts";
import { join } from "node:path";
import {
  INPUT_MANIFEST_PATH,
  OUTPUT_ROOT,
  type CommandRunner,
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
const PDFTOPPM = "/usr/bin/pdftoppm";
const MAGICK = "/usr/bin/magick";
const TESSERACT = "/usr/bin/tesseract";
const RESULT_PATH = `${OUTPUT_ROOT}/ocr.json`;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export function localOcrCli(argv: readonly string[]) {
  const parsed = parseExactOptions(argv, ["input", "manifest"]);
  if (parsed.input !== INPUT_MANIFEST_PATH || parsed.manifest !== RESULT_PATH) {
    throw new Error("LOCAL_OCR_WORKER_PATH_INVALID");
  }
  return Object.freeze({ input: parsed.input, manifest: parsed.manifest });
}

export function parseOcrPdfPageCount(stdout: string) {
  const pageCount = Number(/^Pages:\s*(\d+)\s*$/imu.exec(stdout)?.[1]);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error("LOCAL_OCR_PAGE_COUNT_INVALID");
  }
  return pageCount;
}

export function parseImageDimensions(stdout: string) {
  const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(stdout);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error("LOCAL_OCR_IMAGE_DIMENSIONS_INVALID");
  }
  return { width, height };
}

function pageName(index: number) {
  return `ocr-page-${String(index + 1).padStart(4, "0")}`;
}

async function inspectImage(
  imagePath: string,
  runner: CommandRunner,
  root: string,
) {
  const result = await runner(MAGICK, ["identify", "-format", "%w %h", imagePath], {
    cwd: root,
    timeoutMs: 15_000,
    stdoutBytes: 128,
    stderrBytes: 8 * 1024,
  });
  requireCommandSuccess(result, "local-ocr-image-inspection");
  return parseImageDimensions(result.stdout);
}

async function recognizePage(input: {
  imagePath: string;
  language: string;
  runner: CommandRunner;
  root: string;
}) {
  const result = await input.runner(
    TESSERACT,
    [input.imagePath, "stdout", "-l", input.language, "--psm", "3"],
    {
      cwd: input.root,
      timeoutMs: 2 * 60_000,
      stdoutBytes: 512 * 1024,
      stderrBytes: 64 * 1024,
    },
  );
  requireCommandSuccess(result, "local-ocr-page");
  if (result.stdout.includes("[output truncated]")) {
    throw new Error("LOCAL_OCR_PAGE_TEXT_LIMIT_EXCEEDED");
  }
  return result.stdout.replaceAll("\0", "").trim();
}

async function renderPdfPage(input: {
  sourcePath: string;
  page: number;
  runner: CommandRunner;
  root: string;
}) {
  const prefix = join(input.root, "tmp", pageName(input.page - 1));
  const result = await input.runner(
    PDFTOPPM,
    [
      "-f",
      String(input.page),
      "-l",
      String(input.page),
      "-singlefile",
      "-scale-to",
      "4096",
      "-png",
      input.sourcePath,
      prefix,
    ],
    { cwd: input.root, timeoutMs: 60_000, stderrBytes: 64 * 1024 },
  );
  requireCommandSuccess(result, "local-ocr-pdf-render");
  return `${prefix}.png`;
}

async function normalizeImage(input: {
  sourcePath: string;
  runner: CommandRunner;
  root: string;
}) {
  const temporary = join(input.root, "tmp", "ocr-image.png");
  const result = await input.runner(
    MAGICK,
    [
      input.sourcePath,
      "-auto-orient",
      "-resize",
      "4096x4096>",
      "-strip",
      temporary,
    ],
    { cwd: input.root, timeoutMs: 60_000, stderrBytes: 64 * 1024 },
  );
  requireCommandSuccess(result, "local-ocr-image-normalization");
  return temporary;
}

export async function runLocalOcrWorker(
  manifest: LocalOcrWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  const sourcePath = workspacePath(manifest.source.path, root);
  await verifyInputFile({
    absolutePath: sourcePath,
    expectedDigest: manifest.source.digest,
    expectedBytes: manifest.source.byteSize,
  });

  let pageCount = 1;
  if (manifest.source.mimeType === "application/pdf") {
    const inspection = await runner(PDFINFO, [sourcePath], {
      cwd: root,
      timeoutMs: 20_000,
      stdoutBytes: 64 * 1024,
      stderrBytes: 64 * 1024,
    });
    requireCommandSuccess(inspection, "local-ocr-pdf-inspection");
    pageCount = parseOcrPdfPageCount(inspection.stdout);
  }
  if (pageCount > manifest.maximumPages) {
    throw new Error("LOCAL_OCR_PAGE_LIMIT_EXCEEDED");
  }

  const pages = [];
  let totalPixels = 0;
  let totalTextBytes = 0;
  for (let providerIndex = 0; providerIndex < pageCount; providerIndex += 1) {
    const imagePath =
      manifest.source.mimeType === "application/pdf"
        ? await renderPdfPage({
            sourcePath,
            page: providerIndex + 1,
            runner,
            root,
          })
        : await normalizeImage({ sourcePath, runner, root });
    const dimensions = await inspectImage(imagePath, runner, root);
    const pixels = dimensions.width * dimensions.height;
    totalPixels += pixels;
    if (
      !Number.isSafeInteger(pixels) ||
      pixels > manifest.maximumPixelsPerPage ||
      totalPixels > manifest.maximumTotalPixels
    ) {
      throw new Error("LOCAL_OCR_PIXEL_LIMIT_EXCEEDED");
    }
    const markdown = await recognizePage({
      imagePath,
      language: manifest.language,
      runner,
      root,
    });
    totalTextBytes += new TextEncoder().encode(markdown).byteLength;
    if (totalTextBytes > MAX_MARKDOWN_BYTES) {
      throw new Error("LOCAL_OCR_TEXT_LIMIT_EXCEEDED");
    }
    pages.push({ providerIndex, markdown, ...dimensions });
  }

  return localOcrWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "local-ocr.v1",
    sourceDigest: manifest.source.digest,
    modelId: manifest.modelId,
    modelRevision: manifest.modelRevision,
    engine: "tesseract+poppler",
    networkAccess: false,
    pageCount,
    pages,
  });
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = localOcrCli(argv);
  await prepareWorkspace();
  const manifest = await readJsonManifest(
    cli.input,
    localOcrWorkerManifestV1Schema,
  );
  const result = await runLocalOcrWorker(manifest);
  await writeJsonOutput(cli.manifest, result, 3 * 1024 * 1024);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "LOCAL_OCR_FAILED");
    process.exitCode = 1;
  });
}
