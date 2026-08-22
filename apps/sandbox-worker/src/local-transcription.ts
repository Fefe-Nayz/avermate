import {
  localTranscriptionWorkerManifestV1Schema,
  localTranscriptionWorkerOutputV1Schema,
  type LocalTranscriptionWorkerManifestV1,
} from "@avermate/agent-contracts";
import { readFile } from "node:fs/promises";
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

const FFPROBE = "/usr/bin/ffprobe";
const WHISPER = "/usr/bin/whisper-cli";
const MODEL_PATH = "/models/whisper-large-v3-turbo-q5_0.bin";
const RESULT_PATH = `${OUTPUT_ROOT}/transcription.json`;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;

export function localTranscriptionCli(argv: readonly string[]) {
  const parsed = parseExactOptions(argv, ["input", "manifest"]);
  if (parsed.input !== INPUT_MANIFEST_PATH || parsed.manifest !== RESULT_PATH) {
    throw new Error("LOCAL_TRANSCRIPTION_WORKER_PATH_INVALID");
  }
  return Object.freeze({ input: parsed.input, manifest: parsed.manifest });
}

export function whisperArguments(
  manifest: LocalTranscriptionWorkerManifestV1,
  root = "/workspace",
) {
  return Object.freeze([
    "-m",
    MODEL_PATH,
    "-f",
    workspacePath(manifest.source.path, root),
    "-oj",
    "-of",
    join(root, "tmp", "whisper-result"),
    "-l",
    manifest.language ?? "auto",
    "-np",
  ]);
}

export function parseMediaDuration(stdout: string, maximumSeconds: number) {
  const seconds = Number(stdout.trim());
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > maximumSeconds + 2
  ) {
    throw new Error("LOCAL_TRANSCRIPTION_DURATION_LIMIT_EXCEEDED");
  }
  return Math.round(seconds * 1_000);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.replaceAll("\0", "").trim();
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
    throw new Error("LOCAL_TRANSCRIPTION_TEXT_LIMIT_EXCEEDED");
  }
  return text;
}

export function parseWhisperJson(
  value: unknown,
  manifest: LocalTranscriptionWorkerManifestV1,
  durationMs: number,
) {
  const root = record(value);
  if (!root) throw new Error("LOCAL_TRANSCRIPTION_RESULT_INVALID");
  const rawSegments = Array.isArray(root.transcription)
    ? root.transcription
    : Array.isArray(root.segments)
      ? root.segments
      : [];
  if (rawSegments.length > 20_000) {
    throw new Error("LOCAL_TRANSCRIPTION_SEGMENT_LIMIT_EXCEEDED");
  }
  const segments = rawSegments.map((raw, index) => {
    const segment = record(raw);
    const offsets = record(segment?.offsets);
    const start = offsets?.from ?? segment?.start;
    const end = offsets?.to ?? segment?.end;
    const startMs =
      typeof start === "number" && Number.isFinite(start)
        ? Math.round(offsets ? start : start * 1_000)
        : Number.NaN;
    const endMs =
      typeof end === "number" && Number.isFinite(end)
        ? Math.round(offsets ? end : end * 1_000)
        : Number.NaN;
    const text = boundedText(segment?.text);
    if (
      !Number.isSafeInteger(startMs) ||
      !Number.isSafeInteger(endMs) ||
      startMs < 0 ||
      endMs < startMs ||
      endMs > durationMs + 2_000 ||
      !text
    ) {
      throw new Error(`LOCAL_TRANSCRIPTION_SEGMENT_INVALID:${index}`);
    }
    return { startMs, endMs, text };
  });
  const joined = segments.map((segment) => segment.text).join(" ").trim();
  const text = boundedText(root.text) || boundedText(joined);
  if (!text) throw new Error("LOCAL_TRANSCRIPTION_EMPTY");
  const result = record(root.result);
  const languageCandidate = result?.language ?? root.language ?? manifest.language;
  const language =
    typeof languageCandidate === "string" &&
    languageCandidate.trim().length >= 2 &&
    languageCandidate.trim().length <= 35
      ? languageCandidate.trim().toLowerCase().replaceAll("_", "-")
      : "unknown";
  return {
    text,
    language,
    segments:
      segments.length > 0
        ? segments
        : [{ startMs: 0, endMs: Math.max(1, durationMs), text }],
  };
}

export async function runLocalTranscriptionWorker(
  manifest: LocalTranscriptionWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  const sourcePath = workspacePath(manifest.source.path, root);
  await verifyInputFile({
    absolutePath: sourcePath,
    expectedDigest: manifest.source.digest,
    expectedBytes: manifest.source.byteSize,
  });
  const probe = await runner(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      sourcePath,
    ],
    { cwd: root, timeoutMs: 20_000, stdoutBytes: 128, stderrBytes: 16 * 1024 },
  );
  requireCommandSuccess(probe, "local-transcription-probe");
  const durationMs = parseMediaDuration(probe.stdout, manifest.maximumSeconds);
  const execution = await runner(WHISPER, whisperArguments(manifest, root), {
    cwd: root,
    timeoutMs: Math.min(2 * 60 * 60_000, Math.max(60_000, durationMs * 4)),
    stdoutBytes: 64 * 1024,
    stderrBytes: 64 * 1024,
  });
  requireCommandSuccess(execution, "local-transcription");
  const raw = await readFile(join(root, "tmp", "whisper-result.json"));
  if (raw.byteLength < 2 || raw.byteLength > MAX_RESULT_BYTES) {
    throw new Error("LOCAL_TRANSCRIPTION_RESULT_SIZE_INVALID");
  }
  const parsed = parseWhisperJson(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
    manifest,
    durationMs,
  );
  return localTranscriptionWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "local-transcription.v1",
    sourceDigest: manifest.source.digest,
    modelId: manifest.modelId,
    modelRevision: manifest.modelRevision,
    engine: "whisper.cpp",
    networkAccess: false,
    durationMs,
    ...parsed,
  });
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = localTranscriptionCli(argv);
  await prepareWorkspace();
  const manifest = await readJsonManifest(
    cli.input,
    localTranscriptionWorkerManifestV1Schema,
  );
  const result = await runLocalTranscriptionWorker(manifest);
  await writeJsonOutput(cli.manifest, result, MAX_RESULT_BYTES);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "LOCAL_TRANSCRIPTION_FAILED",
    );
    process.exitCode = 1;
  });
}
