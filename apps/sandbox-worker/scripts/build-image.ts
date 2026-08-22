import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";

export const WORKER_IMAGE_PROFILES = Object.freeze([
  "browser",
  "media",
  "manim",
  "latex",
  "slides",
] as const);
export type WorkerImageProfile = (typeof WORKER_IMAGE_PROFILES)[number];

export interface WorkerImageBuildInput {
  readonly profile: WorkerImageProfile;
  readonly profileVersion: string;
  readonly builderBase: string;
  readonly runtimeBase: string;
  readonly tag: string;
  readonly execute: boolean;
}

export interface WorkerImageBuildPlan extends WorkerImageBuildInput {
  readonly schemaVersion: 1;
  readonly buildInputDigest: `sha256:${string}`;
  readonly dockerfile: string;
  readonly context: string;
  readonly command: readonly string[];
}

const pinnedImage = /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:\/[a-z0-9._-]+)+(?::[a-zA-Z0-9][a-zA-Z0-9._-]{0,127})?@sha256:[a-f0-9]{64}$/u;
const localTag = /^[a-z0-9][a-z0-9._/-]*(?::[0-9]+)?(?:\/[a-z0-9._-]+)*:[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const profileVersion = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

export function parseBuildImageCli(argv: readonly string[]): WorkerImageBuildInput {
  const execute = argv.at(-1) === "--execute";
  const values = execute ? argv.slice(0, -1) : [...argv];
  const names = [
    "profile",
    "profile-version",
    "builder-base",
    "runtime-base",
    "tag",
  ] as const;
  if (values.length !== names.length * 2) throw new Error("WORKER_IMAGE_ARGUMENTS_INVALID");
  names.forEach((name, index) => {
    if (values[index * 2] !== `--${name}` || !values[index * 2 + 1]) {
      throw new Error("WORKER_IMAGE_ARGUMENTS_INVALID");
    }
  });
  const parsed = Object.freeze({
    profile: values[1]!,
    profileVersion: values[3]!,
    builderBase: values[5]!,
    runtimeBase: values[7]!,
    tag: values[9]!,
  });
  const selectedProfile = WORKER_IMAGE_PROFILES.find(
    (profile) => profile === parsed.profile,
  );
  if (!selectedProfile) {
    throw new Error("WORKER_IMAGE_PROFILE_INVALID");
  }
  if (!profileVersion.test(parsed.profileVersion)) {
    throw new Error("WORKER_IMAGE_VERSION_INVALID");
  }
  if (!pinnedImage.test(parsed.builderBase) || !pinnedImage.test(parsed.runtimeBase)) {
    throw new Error("WORKER_IMAGE_BASE_NOT_PINNED");
  }
  if (!localTag.test(parsed.tag) || parsed.tag.includes("@")) {
    throw new Error("WORKER_IMAGE_TAG_INVALID");
  }
  return Object.freeze({
    profile: selectedProfile,
    profileVersion: parsed.profileVersion,
    builderBase: parsed.builderBase,
    runtimeBase: parsed.runtimeBase,
    tag: parsed.tag,
    execute,
  });
}

export async function createWorkerImageBuildPlan(
  input: WorkerImageBuildInput,
  workspaceRoot = resolve(import.meta.dir, "../../.."),
): Promise<WorkerImageBuildPlan> {
  const dockerfile = "apps/sandbox-worker/docker/worker.Dockerfile";
  const buildInputDigest = await computeWorkerBuildInputDigest(workspaceRoot);
  const command = Object.freeze([
    "docker",
    "build",
    "--file",
    dockerfile,
    "--build-arg",
    `BUN_BUILD_IMAGE=${input.builderBase}`,
    "--build-arg",
    `WORKER_RUNTIME_IMAGE=${input.runtimeBase}`,
    "--build-arg",
    `WORKER_PROFILE=${input.profile}`,
    "--build-arg",
    `WORKER_PROFILE_VERSION=${input.profileVersion}`,
    "--build-arg",
    `BUILD_INPUT_DIGEST=${buildInputDigest}`,
    "--label",
    `org.avermate.sandbox.input-digest=${buildInputDigest}`,
    "--tag",
    input.tag,
    ".",
  ]);
  return Object.freeze({
    schemaVersion: 1 as const,
    ...input,
    buildInputDigest,
    dockerfile,
    context: ".",
    command,
  });
}

export async function computeWorkerBuildInputDigest(
  workspaceRoot: string,
): Promise<`sha256:${string}`> {
  const fixed = [
    "package.json",
    "bun.lock",
    "apps/sandbox-worker/package.json",
    "apps/sandbox-worker/tsconfig.json",
    "apps/sandbox-worker/docker/worker.Dockerfile",
    "packages/agent-contracts/package.json",
    "packages/agent-contracts/tsconfig.json",
  ];
  const discovered = await Promise.all([
    filesUnder(workspaceRoot, "apps/sandbox-worker/src"),
    filesUnder(workspaceRoot, "packages/agent-contracts/src"),
    filesUnder(workspaceRoot, "patches"),
  ]);
  return digestFiles(workspaceRoot, [...fixed, ...discovered.flat()].sort());
}

export async function digestFiles(
  root: string,
  relativePaths: readonly string[],
): Promise<`sha256:${string}`> {
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const relativePath of [...new Set(relativePaths)].sort()) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._@%+-]+)*$/u.test(normalized)) {
      throw new Error("WORKER_IMAGE_INPUT_PATH_INVALID");
    }
    const absolute = resolve(root, ...normalized.split("/"));
    const fromRoot = relative(root, absolute);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new Error("WORKER_IMAGE_INPUT_PATH_INVALID");
    }
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) {
      throw new Error("WORKER_IMAGE_INPUT_FILE_INVALID");
    }
    totalBytes += info.size;
    if (totalBytes > 256 * 1024 * 1024) {
      throw new Error("WORKER_IMAGE_INPUT_LIMIT_EXCEEDED");
    }
    const bytes = await readFile(absolute);
    hash.update(normalized);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function filesUnder(root: string, relativeDirectory: string): Promise<string[]> {
  const directory = resolve(root, ...relativeDirectory.split("/"));
  const pending = [directory];
  const files: string[] = [];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      visited += 1;
      if (visited > 10_000 || entry.isSymbolicLink()) {
        throw new Error("WORKER_IMAGE_INPUT_TREE_INVALID");
      }
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      if (entry.isFile()) {
        files.push(posix.normalize(relative(root, absolute).replaceAll("\\", "/")));
      }
    }
  }
  return files.sort();
}

async function main() {
  const input = parseBuildImageCli(Bun.argv.slice(2));
  const workspaceRoot = resolve(import.meta.dir, "../../..");
  const plan = await createWorkerImageBuildPlan(input, workspaceRoot);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!input.execute) return;
  const child = Bun.spawn(plan.command, {
    cwd: workspaceRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`WORKER_IMAGE_BUILD_FAILED:${exitCode}`);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "WORKER_IMAGE_BUILD_FAILED");
    process.exitCode = 1;
  });
}
