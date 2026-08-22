"use client"

import {
  packagesForPythonSource,
  PYTHON_BOOT_TIMEOUT_MS,
  PYODIDE_RUNTIME_BASE_URL,
  pythonSourceIssue,
  safePythonTimeout,
} from "./python-run-policy"
import {
  parsePythonWorkerMessage,
  type PythonRunPhase,
  type PythonRunResult,
  type PythonWorkerInitializeMessage,
} from "./python-run-protocol"

type Timer = ReturnType<typeof setTimeout>

interface WorkerPort {
  close(): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: unknown): void
  start(): void
}

interface WorkerChannel {
  port1: WorkerPort
  port2: WorkerPort
}

interface PythonWorker {
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void
  ): void
  postMessage(message: unknown, transfer: Transferable[]): void
  terminate(): void
}

export type PythonRunErrorKind =
  | "aborted"
  | "initialization"
  | "execution"
  | "protocol"
  | "timeout"
  | "validation"

export class PythonRunError extends Error {
  override readonly name = "PythonRunError"

  constructor(
    readonly kind: PythonRunErrorKind,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
  }
}

export interface PythonRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  onPhase?: (phase: PythonRunPhase) => void
  dependencies?: {
    bootTimeoutMs?: number
    channelFactory?: () => WorkerChannel
    workerFactory?: () => PythonWorker
  }
}

function defaultWorkerFactory(): PythonWorker {
  return new Worker(`${PYODIDE_RUNTIME_BASE_URL}pyodide-run.worker.mjs`, {
    type: "module",
    name: "avermate-python-run",
    credentials: "omit",
  })
}

function defaultChannelFactory(): WorkerChannel {
  return new MessageChannel()
}

/**
 * Execute one block in a disposable worker. The worker is intentionally not
 * pooled: termination is the only dependable wall-clock interrupt for
 * synchronous Python/WASM and it also erases the block's temporary filesystem.
 * Results intentionally remain component state: a reader action must never
 * mutate somebody else's document or upload untrusted execution output. A
 * future persisted result needs an explicit author/editor save operation with
 * a source-revision precondition, not an automatic callback from this runner.
 */
export function runPythonInBrowser(
  source: string,
  options: PythonRunOptions = {}
): Promise<PythonRunResult> {
  const issue = pythonSourceIssue(source)
  if (issue) return Promise.reject(new PythonRunError("validation", issue))
  if (options.signal?.aborted) {
    return Promise.reject(
      new PythonRunError("aborted", "Python execution was cancelled")
    )
  }

  const worker = (options.dependencies?.workerFactory ?? defaultWorkerFactory)()
  const channel = (
    options.dependencies?.channelFactory ?? defaultChannelFactory
  )()
  const timeoutMs = safePythonTimeout(options.timeoutMs)
  const bootTimeoutMs = Math.max(
    timeoutMs,
    options.dependencies?.bootTimeoutMs ?? PYTHON_BOOT_TIMEOUT_MS
  )

  return new Promise((resolve, reject) => {
    let finished = false
    let executionStarted = false
    let executionTimer: Timer | null = null
    let bootTimer: Timer | null = null

    const cleanup = () => {
      if (bootTimer) clearTimeout(bootTimer)
      if (executionTimer) clearTimeout(executionTimer)
      options.signal?.removeEventListener("abort", onAbort)
      channel.port1.onmessage = null
      channel.port1.close()
      channel.port2.close()
      worker.terminate()
    }
    const fail = (error: PythonRunError) => {
      if (finished) return
      finished = true
      cleanup()
      reject(error)
    }
    const succeed = (result: PythonRunResult) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(result)
    }
    const onAbort = () => {
      fail(new PythonRunError("aborted", "Python execution was cancelled"))
    }

    channel.port1.onmessage = (event) => {
      const message = parsePythonWorkerMessage(event.data)
      if (!message) {
        fail(
          new PythonRunError(
            "protocol",
            "The Python worker returned an invalid response"
          )
        )
        return
      }
      if (message.type === "phase") {
        options.onPhase?.(message.phase)
        if (message.phase === "ready" && !executionStarted) {
          executionStarted = true
          if (bootTimer) clearTimeout(bootTimer)
          executionTimer = setTimeout(
            () =>
              fail(
                new PythonRunError(
                  "timeout",
                  `Python execution exceeded ${timeoutMs / 1_000} seconds`
                )
              ),
            timeoutMs
          )
          channel.port1.postMessage({ type: "execute" })
        }
        return
      }
      if (message.type === "failure") {
        fail(new PythonRunError(message.kind, message.message))
        return
      }
      succeed(message.result)
    }
    const onWorkerError = () => {
      fail(
        new PythonRunError(
          executionStarted ? "execution" : "initialization",
          "The isolated Python worker stopped unexpectedly"
        )
      )
    }
    worker.addEventListener("error", onWorkerError)
    worker.addEventListener("messageerror", onWorkerError)
    options.signal?.addEventListener("abort", onAbort, { once: true })

    channel.port1.start()
    bootTimer = setTimeout(
      () =>
        fail(
          new PythonRunError(
            "timeout",
            "The local Python runtime took too long to initialize"
          )
        ),
      bootTimeoutMs
    )
    const initialization: PythonWorkerInitializeMessage = {
      type: "initialize",
      source,
      packages: packagesForPythonSource(source),
      port: channel.port2 as MessagePort,
    }
    worker.postMessage(initialization, [channel.port2 as Transferable])
  })
}
