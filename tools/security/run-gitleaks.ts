import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureGitleaks } from "./bootstrap-gitleaks";
import { collectWorkspaceCandidates } from "./candidates";

type ScanMode = "history" | "workspace";
const GITLEAKS_CONFIG = path.join(import.meta.dir, "gitleaks.toml");

interface GitleaksFinding {
  Commit?: unknown;
  File?: unknown;
  RuleID?: unknown;
  StartLine?: unknown;
}

async function materializeWorkspace(
  root: string,
  destination: string,
  candidates: string[],
): Promise<void> {
  for (const candidate of candidates) {
    const source = path.join(root, candidate);
    const sourceStat = await lstat(source);
    if (sourceStat.isSymbolicLink()) {
      throw new Error(`Refusing symbolic-link candidate: ${candidate}`);
    }
    if (!sourceStat.isFile()) continue;

    const target = path.join(destination, candidate);
    const targetRelative = path.relative(destination, target);
    if (targetRelative === ".." || targetRelative.startsWith(`..${path.sep}`)) {
      throw new Error("Unsafe workspace snapshot path.");
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function drain(
  process: Bun.Subprocess<"pipe", "pipe", "pipe">,
): Promise<number> {
  const [, , code] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).arrayBuffer(),
    process.exited,
  ]);
  return code;
}

async function readReport(reportPath: string): Promise<GitleaksFinding[]> {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    return Array.isArray(report) ? report : [];
  } catch (error) {
    // SAFETY: Node filesystem failures expose `code`; non-filesystem errors are
    // converted to the static redacted error below.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Unable to read redacted Gitleaks report.");
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Gitleaks JSON is parsed and normalized here
function safeReportPath(file: unknown, snapshot?: string): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Gitleaks JSON is parsed at this I/O boundary
  if (typeof file !== "string" || !file) return "<unknown-file>";
  let candidate = file;
  if (snapshot && path.isAbsolute(candidate)) {
    candidate = path.relative(snapshot, candidate);
  }
  candidate = candidate.replaceAll("\\", "/");
  return candidate === ".." || candidate.startsWith("../")
    ? "<outside-snapshot>"
    : candidate;
}

// oxlint-disable anti-slop/no-runtime-typeof -- Gitleaks JSON is parsed and normalized at this I/O boundary
function printRedactedFindings(
  findings: GitleaksFinding[],
  snapshot?: string,
): void {
  for (const finding of findings) {
    const file = safeReportPath(finding.File, snapshot);
    const line =
      typeof finding.StartLine === "number" && finding.StartLine > 0
        ? `:${finding.StartLine}`
        : "";
    const rule =
      typeof finding.RuleID === "string" && finding.RuleID
        ? finding.RuleID
        : "unknown-rule";
    const commit =
      typeof finding.Commit === "string" && finding.Commit
        ? ` commit=${finding.Commit.slice(0, 12)}`
        : "";
    console.error(`[secret] ${file}${line} rule=${rule}${commit}`);
  }
}
// oxlint-enable anti-slop/no-runtime-typeof

export async function runGitleaks(
  mode: ScanMode,
  rootInput = process.cwd(),
): Promise<void> {
  const root = path.resolve(rootInput);
  const executable = await ensureGitleaks();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "avermate-gitleaks-"));
  const reportPath = path.join(temporary, "report.json");
  let snapshot: string | undefined;

  try {
    const common = [
      "--no-banner",
      "--no-color",
      "--redact=100",
      `--config=${GITLEAKS_CONFIG}`,
      "--report-format=json",
      `--report-path=${reportPath}`,
    ];
    let command: string[];
    let countDescription: string;

    if (mode === "workspace") {
      const candidates = await collectWorkspaceCandidates({ root });
      if (candidates.length === 0) {
        console.log("Gitleaks workspace scan passed (0 candidate files). ");
        return;
      }
      snapshot = path.join(temporary, "workspace");
      await mkdir(snapshot, { recursive: true });
      await materializeWorkspace(root, snapshot, candidates);
      command = [executable, "dir", ...common, snapshot];
      countDescription = `${candidates.length} candidate files`;
    } else {
      command = [executable, "git", ...common, "--log-opts=--all", root];
      countDescription = "all reachable commits";
    }

    const code = await drain(
      Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" }),
    );
    const findings = await readReport(reportPath);

    if (code === 1 || findings.length > 0) {
      printRedactedFindings(findings, snapshot);
      throw new Error(
        `Gitleaks ${mode} scan found ${findings.length} issue(s).`,
      );
    }
    if (code !== 0) {
      throw new Error(
        `Gitleaks ${mode} scan failed without exposing tool output.`,
      );
    }
    console.log(`Gitleaks ${mode} scan passed (${countDescription}).`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "workspace" && mode !== "history") {
    console.error(
      "Usage: bun tools/security/run-gitleaks.ts <workspace|history>",
    );
    process.exit(2);
  }
  try {
    await runGitleaks(mode);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Gitleaks scan failed.",
    );
    process.exit(1);
  }
}
