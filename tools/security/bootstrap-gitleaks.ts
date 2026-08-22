import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const GITLEAKS_VERSION = "8.24.3";
const RELEASE_ROOT = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`;
const CHECKSUM_FILE = path.join(import.meta.dir, "gitleaks-checksums.txt");

export const SUPPORTED_ARTIFACTS = {
  "darwin-arm64": `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`,
  "darwin-x64": `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`,
  "linux-arm64": `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`,
  "linux-ia32": `gitleaks_${GITLEAKS_VERSION}_linux_x32.tar.gz`,
  "linux-x64": `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
  "win32-ia32": `gitleaks_${GITLEAKS_VERSION}_windows_x32.zip`,
  "win32-x64": `gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`,
} as const satisfies Readonly<Record<string, string>>;

export function assertPinnedVersion(version: string): void {
  if (version !== GITLEAKS_VERSION || /latest/i.test(version)) {
    throw new Error(`Gitleaks must remain pinned to ${GITLEAKS_VERSION}.`);
  }
}

export function parseChecksums(contents: string): Map<string, string> {
  const checksums = new Map<string, string>();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-f0-9]{64})\s{2}([^/\\]+)$/.exec(line);
    if (!match) throw new Error("Malformed Gitleaks checksum metadata.");
    const [, checksum, artifact] = match;
    if (
      !artifact.includes(`_${GITLEAKS_VERSION}_`) ||
      /latest/i.test(artifact)
    ) {
      throw new Error(
        "Gitleaks checksum metadata contains a different version.",
      );
    }
    if (checksums.has(artifact)) {
      throw new Error("Duplicate Gitleaks checksum metadata.");
    }
    checksums.set(artifact, checksum);
  }

  if (checksums.size === 0) {
    throw new Error("Gitleaks checksum metadata is empty.");
  }
  return checksums;
}

export function requireArtifactChecksum(
  checksums: ReadonlyMap<string, string>,
  artifact: string,
): string {
  const checksum = checksums.get(artifact);
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error(`Missing official checksum for ${artifact}.`);
  }
  return checksum;
}

export function verifyArchiveChecksum(
  bytes: Uint8Array,
  expectedChecksum: string,
): void {
  if (sha256(bytes) !== expectedChecksum) {
    throw new Error("Gitleaks archive checksum mismatch.");
  }
}

export function resolveArtifact(
  platform = process.platform,
  architecture = process.arch,
): string {
  assertPinnedVersion(GITLEAKS_VERSION);
  const key = `${platform}-${architecture}`;
  const artifact = Object.entries(SUPPORTED_ARTIFACTS).find(
    ([candidate]) => candidate === key,
  )?.[1];
  if (!artifact) {
    throw new Error(
      `Gitleaks ${GITLEAKS_VERSION} has no pinned artifact for this platform.`,
    );
  }
  return artifact;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    // SAFETY: Node filesystem failures expose `code`; all other thrown values
    // simply take the non-ENOENT branch and are rethrown.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runQuiet(
  command: string[],
): Promise<{ code: number; output: string }> {
  try {
    const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { code, output: `${stdout}\n${stderr}`.trim() };
  } catch {
    return { code: 127, output: "" };
  }
}

async function verifyExecutable(executable: string): Promise<void> {
  const result = await runQuiet([executable, "version"]);
  const detected = result.output.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (result.code !== 0 || detected !== GITLEAKS_VERSION) {
    throw new Error(
      `Cached Gitleaks executable is not version ${GITLEAKS_VERSION}.`,
    );
  }
}

async function extractArchive(
  archive: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const tarResult = await runQuiet(["tar", "-xf", archive, "-C", destination]);
  if (tarResult.code === 0) return;

  if (archive.endsWith(".zip")) {
    const script =
      "& { param($Archive,$Destination) " +
      "Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force }";
    let result = await runQuiet([
      "pwsh",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      "-Archive",
      archive,
      "-Destination",
      destination,
    ]);
    if (result.code !== 0) {
      result = await runQuiet([
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
        "-Archive",
        archive,
        "-Destination",
        destination,
      ]);
    }
    if (result.code !== 0) {
      throw new Error("Unable to extract the pinned Gitleaks archive.");
    }
    return;
  }

  throw new Error("Unable to extract the pinned Gitleaks archive.");
}

function cacheRoot(): string {
  const root = path.resolve(
    process.env.GITLEAKS_CACHE_DIR ??
      path.join(os.tmpdir(), "avermate-security-tools", "gitleaks"),
  );
  const workspace = path.resolve(process.cwd());
  const relativeToWorkspace = path.relative(workspace, root);
  if (
    !relativeToWorkspace ||
    (relativeToWorkspace !== ".." &&
      !relativeToWorkspace.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeToWorkspace))
  ) {
    throw new Error("Gitleaks cache must remain outside the workspace.");
  }
  return root;
}

function assertCacheChild(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Unsafe Gitleaks cache path.");
  }
}

export async function ensureGitleaks(): Promise<string> {
  assertPinnedVersion(GITLEAKS_VERSION);
  const artifact = resolveArtifact();
  const checksums = parseChecksums(await readFile(CHECKSUM_FILE, "utf8"));
  const expectedChecksum = requireArtifactChecksum(checksums, artifact);

  const root = cacheRoot();
  const platformKey = `${process.platform}-${process.arch}`;
  const archive = path.join(root, artifact);
  const installation = path.join(root, GITLEAKS_VERSION, platformKey);
  const executable = path.join(
    installation,
    process.platform === "win32" ? "gitleaks.exe" : "gitleaks",
  );
  for (const target of [archive, installation, executable]) {
    assertCacheChild(root, target);
  }

  if (await exists(executable)) {
    await verifyExecutable(executable);
    return executable;
  }

  await mkdir(root, { recursive: true });
  if (await exists(archive)) {
    const archiveBytes = new Uint8Array(await readFile(archive));
    verifyArchiveChecksum(archiveBytes, expectedChecksum);
  } else {
    const url = `${RELEASE_ROOT}/${artifact}`;
    if (/latest/i.test(url))
      throw new Error("Gitleaks latest fallback is forbidden.");
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `Unable to retrieve pinned Gitleaks ${GITLEAKS_VERSION}.`,
      );
    }
    const archiveBytes = new Uint8Array(await response.arrayBuffer());
    verifyArchiveChecksum(archiveBytes, expectedChecksum);
    await writeFile(archive, archiveBytes, { flag: "wx" });
  }

  const temporary = `${installation}.extract-${process.pid}-${Date.now()}`;
  assertCacheChild(root, temporary);
  await rm(temporary, { recursive: true, force: true });
  try {
    await extractArchive(archive, temporary);
    if (process.platform !== "win32") {
      await chmod(path.join(temporary, "gitleaks"), 0o755);
    }
    await mkdir(path.dirname(installation), { recursive: true });
    await rename(temporary, installation);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  await verifyExecutable(executable);
  return executable;
}

if (import.meta.main) {
  await ensureGitleaks();
  console.log(`Gitleaks ${GITLEAKS_VERSION} ready.`);
}
