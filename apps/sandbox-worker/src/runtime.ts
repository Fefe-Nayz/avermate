import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import type { SandboxWorkerOutputFile } from "@avermate/agent-contracts";

export const WORKSPACE_ROOT = "/workspace";
export const INPUT_MANIFEST_PATH = "/workspace/input/request.json";
export const OUTPUT_ROOT = "/workspace/output";
export const TMP_ROOT = "/workspace/tmp";

export interface ValueSchema<T> {
  parse(value: unknown): T;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type CommandRunner = (
  executable: string,
  argv: readonly string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    stdoutBytes?: number;
    stderrBytes?: number;
    signal?: AbortSignal;
    environment?: Readonly<Record<string, string>>;
  },
) => Promise<CommandResult>;

export function parseExactOptions(
  argv: readonly string[],
  names: readonly string[],
): Readonly<Record<string, string>> {
  if (argv.length !== names.length * 2) {
    throw new Error("WORKER_ARGUMENT_VECTOR_INVALID");
  }
  const result: Record<string, string> = {};
  names.forEach((name, index) => {
    const flag = `--${name}`;
    if (argv[index * 2] !== flag) {
      throw new Error("WORKER_ARGUMENT_VECTOR_INVALID");
    }
    const value = argv[index * 2 + 1];
    if (!value || value.startsWith("-")) {
      throw new Error("WORKER_ARGUMENT_VECTOR_INVALID");
    }
    result[name] = value;
  });
  return Object.freeze(result);
}

export function workspacePath(
  relativePath: string,
  root = WORKSPACE_ROOT,
): string {
  if (
    !/^(?:input|output|tmp)\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/u.test(
      relativePath,
    ) ||
    relativePath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  const posixRoot = root.startsWith("/");
  const absoluteRoot = posixRoot ? posix.resolve(root) : resolve(root);
  const target = posixRoot
    ? posix.resolve(absoluteRoot, ...relativePath.split("/"))
    : resolve(absoluteRoot, ...relativePath.split("/"));
  const fromRoot = posixRoot
    ? posix.relative(absoluteRoot, target)
    : relative(absoluteRoot, target);
  const parentPrefix = posixRoot ? "../" : `..${sep}`;
  if (
    !fromRoot ||
    fromRoot === ".." ||
    fromRoot.startsWith(parentPrefix)
  ) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  return target;
}

export async function prepareWorkspace(root = WORKSPACE_ROOT): Promise<void> {
  await Promise.all([
    mkdir(resolve(root, "input"), { recursive: true }),
    mkdir(resolve(root, "output"), { recursive: true }),
    mkdir(resolve(root, "tmp"), { recursive: true }),
  ]);
}

export async function readJsonManifest<T>(
  absolutePath: string,
  schema: ValueSchema<T>,
  maxBytes = 1024 * 1024,
): Promise<T> {
  const info = await stat(absolutePath);
  if (!info.isFile() || info.size < 2 || info.size > maxBytes) {
    throw new Error("WORKER_MANIFEST_SIZE_INVALID");
  }
  const bytes = await readFile(absolutePath);
  if (bytes.byteLength !== info.size) {
    throw new Error("WORKER_MANIFEST_CHANGED_DURING_READ");
  }
  return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

export async function writeJsonOutput(
  absolutePath: string,
  value: unknown,
  maxBytes = 1024 * 1024,
): Promise<void> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  if (bytes.byteLength > maxBytes) throw new Error("WORKER_OUTPUT_JSON_TOO_LARGE");
  await writeFile(absolutePath, bytes, { flag: "wx", mode: 0o600 });
}

export async function sha256File(
  absolutePath: string,
  maxBytes: number,
): Promise<{ digest: `sha256:${string}`; byteSize: number }> {
  const info = await stat(absolutePath);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) {
    throw new Error("WORKER_FILE_SIZE_INVALID");
  }
  const hash = createHash("sha256");
  let byteSize = 0;
  const stream = Bun.file(absolutePath).stream();
  const reader = stream.getReader();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    byteSize += part.value.byteLength;
    if (byteSize > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("WORKER_FILE_SIZE_INVALID");
    }
    hash.update(part.value);
  }
  if (byteSize !== info.size) throw new Error("WORKER_FILE_CHANGED_DURING_READ");
  return { digest: `sha256:${hash.digest("hex")}`, byteSize };
}

export async function verifyInputFile(input: {
  absolutePath: string;
  expectedDigest: string;
  expectedBytes: number;
}): Promise<void> {
  const actual = await sha256File(input.absolutePath, input.expectedBytes);
  if (
    actual.byteSize !== input.expectedBytes ||
    actual.digest !== input.expectedDigest
  ) {
    throw new Error("WORKER_INPUT_DIGEST_MISMATCH");
  }
}

export async function outputFile(
  root: string,
  relativePath: string,
  mimeType: string,
  maximumBytes: number,
): Promise<SandboxWorkerOutputFile> {
  const value = await sha256File(workspacePath(relativePath, root), maximumBytes);
  return Object.freeze({ path: relativePath, mimeType, ...value });
}

export async function runCommand(
  executable: string,
  argv: readonly string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    stdoutBytes?: number;
    stderrBytes?: number;
    signal?: AbortSignal;
    environment?: Readonly<Record<string, string>>;
  } = {},
): Promise<CommandResult> {
  if (!executable.startsWith("/") || argv.some((value) => value.includes("\0"))) {
    throw new Error("WORKER_COMMAND_INVALID");
  }
  const environment = options.environment ?? {};
  const allowedEnvironmentNames = new Set([
    "SAL_USE_VCLPLUGIN",
    "TECTONIC_CACHE_DIR",
  ]);
  if (
    Object.keys(environment).some(
      (name) => !allowedEnvironmentNames.has(name),
    )
  ) {
    throw new Error("WORKER_ENVIRONMENT_INVALID");
  }
  options.signal?.throwIfAborted();
  const child = Bun.spawn([executable, ...argv], {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...environment,
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: TMP_ROOT,
      TMPDIR: TMP_ROOT,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      SOURCE_DATE_EPOCH: "0",
    },
  });
  let timedOut = false;
  const terminate = () => child.kill("SIGKILL");
  options.signal?.addEventListener("abort", terminate, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 60_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      boundedText(child.stdout, options.stdoutBytes ?? 1024 * 1024),
      boundedText(child.stderr, options.stderrBytes ?? 1024 * 1024),
    ]);
    options.signal?.throwIfAborted();
    return Object.freeze({ exitCode, stdout, stderr, timedOut });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", terminate);
  }
}

export function requireCommandSuccess(
  result: CommandResult,
  safeName: string,
): void {
  if (result.timedOut) throw new Error(`${safeName.toUpperCase()}_TIMEOUT`);
  if (result.exitCode !== 0) {
    throw new Error(`${safeName.toUpperCase()}_FAILED:${safeDiagnostic(result.stderr)}`);
  }
}

export function safeDiagnostic(value: string, maximum = 2_000): string {
  return value
    .replace(/https?:\/\/\S+/giu, "[url]")
    .replace(/[A-Za-z0-9_-]{80,}/gu, "[redacted]")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

async function boundedText(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let retained = 0;
  let text = "";
  let truncated = false;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    const remaining = Math.max(0, maximum - retained);
    if (remaining > 0) {
      const kept = part.value.subarray(0, remaining);
      retained += kept.byteLength;
      text += decoder.decode(kept, { stream: true });
    }
    if (part.value.byteLength > remaining) truncated = true;
  }
  text += decoder.decode();
  return `${text.trim()}${truncated ? "\n[output truncated]" : ""}`;
}
