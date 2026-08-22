import {
  MAX_PYTHON_FIGURE_BYTES,
  MAX_PYTHON_FIGURES,
  MAX_PYTHON_STREAM_BYTES,
  MAX_PYTHON_TOTAL_FIGURE_BYTES,
  type PythonPackage,
} from "./python-run-policy"

export type PythonRunPhase =
  "loading-runtime" | "loading-packages" | "ready" | "running"

export interface PythonRunResult {
  stdout: string
  stderr: string
  figures: string[]
  durationMs: number
}

export interface PythonWorkerInitializeMessage {
  type: "initialize"
  source: string
  packages: PythonPackage[]
  port: MessagePort
}

export type PythonWorkerCommand = { type: "execute" }

export type PythonWorkerMessage =
  | { type: "phase"; phase: PythonRunPhase }
  | { type: "result"; result: PythonRunResult }
  | {
      type: "failure"
      kind: "initialization" | "execution"
      message: string
    }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" &&
    new TextEncoder().encode(value).byteLength <= maximum
    ? value
    : null
}

function validFigure(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("data:image/png;base64,")
  ) {
    return false
  }
  // A base64 string is larger than its decoded payload, so this bound is
  // intentionally conservative and is checked again against the total.
  return value.length <= Math.ceil((MAX_PYTHON_FIGURE_BYTES * 4) / 3) + 64
}

export function parsePythonWorkerMessage(
  value: unknown
): PythonWorkerMessage | null {
  if (!isPlainRecord(value) || typeof value.type !== "string") return null
  if (value.type === "phase") {
    return value.phase === "loading-runtime" ||
      value.phase === "loading-packages" ||
      value.phase === "ready" ||
      value.phase === "running"
      ? { type: "phase", phase: value.phase }
      : null
  }
  if (value.type === "failure") {
    const message = boundedText(value.message, 4_096)
    if (
      !message ||
      (value.kind !== "initialization" && value.kind !== "execution")
    ) {
      return null
    }
    return { type: "failure", kind: value.kind, message }
  }
  if (value.type !== "result" || !isPlainRecord(value.result)) return null
  const stdout = boundedText(value.result.stdout, MAX_PYTHON_STREAM_BYTES)
  const stderr = boundedText(value.result.stderr, MAX_PYTHON_STREAM_BYTES)
  const figures = value.result.figures
  const durationMs = value.result.durationMs
  if (
    stdout === null ||
    stderr === null ||
    !Array.isArray(figures) ||
    figures.length > MAX_PYTHON_FIGURES ||
    !figures.every(validFigure) ||
    figures.reduce((total, figure) => total + figure.length, 0) >
      Math.ceil((MAX_PYTHON_TOTAL_FIGURE_BYTES * 4) / 3) + 256 ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > 24 * 60 * 60_000
  ) {
    return null
  }
  return {
    type: "result",
    result: {
      stdout,
      stderr,
      figures: [...figures],
      durationMs,
    },
  }
}
