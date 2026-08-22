import {
  slidesWorkerManifestV1Schema,
  slidesWorkerOutputV1Schema,
  type SlidesWorkerManifestV1,
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

const LIBREOFFICE = "/usr/bin/libreoffice";
const PDFINFO = "/usr/bin/pdfinfo";

export function slidesBuildCli(argv: readonly string[]) {
  const parsed = parseExactOptions(argv, ["input", "output", "manifest"]);
  if (
    parsed.input !== INPUT_MANIFEST_PATH ||
    parsed.output !== `${OUTPUT_ROOT}/slides.pdf` ||
    parsed.manifest !== `${OUTPUT_ROOT}/build.json`
  ) {
    throw new Error("SLIDES_WORKER_PATH_INVALID");
  }
  return Object.freeze({
    input: parsed.input,
    output: parsed.output,
    manifest: parsed.manifest,
  });
}

export function libreOfficeArguments(
  manifest: SlidesWorkerManifestV1,
  root = "/workspace",
): readonly string[] {
  return Object.freeze([
    "--headless",
    "--nologo",
    "--nodefault",
    "--nolockcheck",
    "--norestore",
    "--convert-to",
    "pdf:impress_pdf_Export",
    "--outdir",
    join(root, "output"),
    workspacePath(manifest.source.path, root),
  ]);
}

export async function buildSlides(
  manifest: SlidesWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  const sourcePath = workspacePath(manifest.source.path, root);
  await verifyInputFile({
    absolutePath: sourcePath,
    expectedDigest: manifest.source.digest,
    expectedBytes: manifest.source.byteSize,
  });
  const conversion = await runner(
    LIBREOFFICE,
    libreOfficeArguments(manifest, root),
    {
      cwd: root,
      timeoutMs: 120_000,
      stdoutBytes: 64 * 1024,
      stderrBytes: 64 * 1024,
      environment: { SAL_USE_VCLPLUGIN: "svp" },
    },
  );
  requireCommandSuccess(conversion, "slides-build");
  const generatedPath = join(root, "output", "source.pdf");
  const outputPath = join(root, "output", "slides.pdf");
  await rename(generatedPath, outputPath);
  const inspection = await runner(PDFINFO, [outputPath], {
    cwd: root,
    timeoutMs: 10_000,
    stdoutBytes: 64 * 1024,
  });
  requireCommandSuccess(inspection, "slides-inspection");
  const match = /^Pages:\s*(\d+)\s*$/imu.exec(inspection.stdout);
  const slideCount = Number(match?.[1]);
  if (
    !Number.isSafeInteger(slideCount) ||
    slideCount < 1 ||
    slideCount > manifest.maximumSlides
  ) {
    throw new Error("SLIDES_PAGE_LIMIT_EXCEEDED");
  }
  return slidesWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "slides-build.v1",
    pdf: await outputFile(root, "output/slides.pdf", "application/pdf", 512 * 1024 * 1024),
    slideCount,
  });
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = slidesBuildCli(argv);
  await prepareWorkspace();
  const manifest = await readJsonManifest(cli.input, slidesWorkerManifestV1Schema);
  const result = await buildSlides(manifest);
  await writeJsonOutput(cli.manifest, result);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "SLIDES_BUILD_FAILED");
    process.exitCode = 1;
  });
}

