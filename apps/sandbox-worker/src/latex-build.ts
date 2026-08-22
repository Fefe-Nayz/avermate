import {
  latexWorkerManifestV1Schema,
  latexWorkerOutputV1Schema,
  type LatexWorkerManifestV1,
} from "@avermate/agent-contracts";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
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
  safeDiagnostic,
  verifyInputFile,
  workspacePath,
  writeJsonOutput,
} from "./runtime";

const TECTONIC = "/usr/bin/tectonic";
const PDFINFO = "/usr/bin/pdfinfo";

export function latexBuildCli(argv: readonly string[]) {
  const parsed = parseExactOptions(argv, ["input", "output", "manifest"]);
  if (
    parsed.input !== INPUT_MANIFEST_PATH ||
    parsed.output !== `${OUTPUT_ROOT}/document.pdf` ||
    parsed.manifest !== `${OUTPUT_ROOT}/build.json`
  ) {
    throw new Error("LATEX_WORKER_PATH_INVALID");
  }
  return Object.freeze({
    input: parsed.input,
    output: parsed.output,
    manifest: parsed.manifest,
  });
}

export function tectonicArguments(
  manifest: LatexWorkerManifestV1,
  root = "/workspace",
): readonly string[] {
  const sourcePath = workspacePath(manifest.source.path, root);
  if (extname(sourcePath).toLowerCase() !== ".tex") {
    throw new Error("LATEX_SOURCE_PATH_INVALID");
  }
  return Object.freeze([
    "--untrusted",
    "--only-cached",
    "--keep-logs",
    "--chatter",
    "minimal",
    "--outdir",
    join(root, "output"),
    sourcePath,
  ]);
}

export async function buildLatex(
  manifest: LatexWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  const sourcePath = workspacePath(manifest.source.path, root);
  await verifyInputFile({
    absolutePath: sourcePath,
    expectedDigest: manifest.source.digest,
    expectedBytes: manifest.source.byteSize,
  });
  const compile = await runner(TECTONIC, tectonicArguments(manifest, root), {
    cwd: root,
    timeoutMs: 120_000,
    stdoutBytes: 64 * 1024,
    stderrBytes: 64 * 1024,
    environment: {
      TECTONIC_CACHE_DIR: "/opt/avermate/tectonic-cache",
    },
  });
  requireCommandSuccess(compile, "latex-build");

  const stem = basename(sourcePath, extname(sourcePath));
  const generatedPdf = join(root, "output", `${stem}.pdf`);
  const generatedLog = join(root, "output", `${stem}.log`);
  const outputPdf = join(root, "output", "document.pdf");
  if (generatedPdf !== outputPdf) await rename(generatedPdf, outputPdf);
  const compilerLog = await readFile(generatedLog, "utf8").catch(() => "");
  const boundedLog = [compile.stdout, compile.stderr, compilerLog]
    .filter(Boolean)
    .map((value) => safeDiagnostic(value, 20_000))
    .join("\n")
    .slice(0, 64 * 1024);
  await writeFile(join(root, "output", "build.log"), boundedLog || "Tectonic succeeded\n", {
    flag: "wx",
    mode: 0o600,
  });

  const inspection = await runner(PDFINFO, [outputPdf], {
    cwd: root,
    timeoutMs: 10_000,
    stdoutBytes: 64 * 1024,
  });
  requireCommandSuccess(inspection, "pdf-inspection");
  const match = /^Pages:\s*(\d+)\s*$/imu.exec(inspection.stdout);
  const pageCount = Number(match?.[1]);
  if (
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > manifest.maximumPages
  ) {
    throw new Error("LATEX_PAGE_LIMIT_EXCEEDED");
  }
  return latexWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "latex-build.v1",
    pdf: await outputFile(root, "output/document.pdf", "application/pdf", 256 * 1024 * 1024),
    log: await outputFile(root, "output/build.log", "text/plain", 64 * 1024),
    pageCount,
    engine: "tectonic",
  });
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = latexBuildCli(argv);
  await prepareWorkspace();
  const manifest = await readJsonManifest(cli.input, latexWorkerManifestV1Schema);
  const result = await buildLatex(manifest);
  await writeJsonOutput(cli.manifest, result);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "LATEX_BUILD_FAILED");
    process.exitCode = 1;
  });
}

