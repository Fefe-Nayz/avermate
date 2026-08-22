import { lstat } from "node:fs/promises";
import path from "node:path";

const ZERO_SHA = /^0+$/;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

export interface CandidateOptions {
  root?: string;
  baseSha?: string | undefined;
}

async function runGit(root: string, args: string[]): Promise<Uint8Array> {
  const process = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).bytes(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Git candidate discovery failed (${args[0]}).`);
  }

  return stdout;
}

function parseNullSeparated(output: Uint8Array): string[] {
  return new TextDecoder().decode(output).split("\0").filter(Boolean);
}

function normalizeCandidate(root: string, candidate: string): string {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute).replaceAll("\\", "/");

  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    relative === ".." ||
    relative.startsWith("../") ||
    relative.startsWith(".git/")
  ) {
    throw new Error("Git returned an unsafe candidate path.");
  }

  return relative;
}

async function assertCommitExists(root: string, sha: string): Promise<void> {
  if (!COMMIT_SHA.test(sha)) {
    throw new Error("AVERMATE_SECURITY_BASE_SHA must be a commit SHA.");
  }

  await runGit(root, ["cat-file", "-e", `${sha}^{commit}`]);
}

async function addGitPaths(
  root: string,
  candidates: Set<string>,
  args: string[],
): Promise<void> {
  for (const candidate of parseNullSeparated(await runGit(root, args))) {
    candidates.add(normalizeCandidate(root, candidate));
  }
}

/**
 * Returns only files Git considers versionable: changed tracked files, staged
 * files, and untracked files not covered by an ignore rule. In CI, baseSha also
 * adds the committed PR/push range. Ignored databases, uploads, and env files
 * are therefore never opened by the security tools.
 */
export async function collectWorkspaceCandidates(
  options: CandidateOptions = {},
): Promise<string[]> {
  const root = path.resolve(options.root ?? process.cwd());
  const baseSha = options.baseSha ?? process.env.AVERMATE_SECURITY_BASE_SHA;
  const candidates = new Set<string>();

  if (baseSha) {
    if (ZERO_SHA.test(baseSha)) {
      await addGitPaths(root, candidates, ["ls-files", "-z"]);
    } else {
      await assertCommitExists(root, baseSha);
      await addGitPaths(root, candidates, [
        "diff",
        "--name-only",
        "--diff-filter=ACMRTUXB",
        "-z",
        `${baseSha}...HEAD`,
      ]);
    }
  }

  await addGitPaths(root, candidates, [
    "diff",
    "--name-only",
    "--diff-filter=ACMRTUXB",
    "-z",
  ]);
  await addGitPaths(root, candidates, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMRTUXB",
    "-z",
  ]);
  await addGitPaths(root, candidates, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);

  const existing: string[] = [];
  for (const candidate of [...candidates].sort()) {
    try {
      const stat = await lstat(path.join(root, candidate));
      if (stat.isDirectory()) continue;
      existing.push(candidate);
    } catch (error) {
      // SAFETY: Node filesystem failures expose `code`; all other thrown values
      // are conservatively rethrown instead of being treated as a missing file.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return existing;
}
