/// <reference lib="webworker" />

import {
  MAX_PYTHON_SOURCE_BYTES,
  PYODIDE_RUNTIME_BASE_URL,
  pythonSourceByteLength,
  type PythonPackage,
} from "./python-run-policy"
import {
  createPythonSandboxRunner,
  type PythonSandboxRunner,
} from "./python-sandbox"
import type {
  PythonWorkerCommand,
  PythonWorkerInitializeMessage,
  PythonWorkerMessage,
} from "./python-run-protocol"

interface PyodideRuntime {
  globals: unknown
  loadPackage(
    names: string | string[],
    options?: { checkIntegrity?: boolean }
  ): Promise<unknown>
  loadPackagesFromImports?: (...args: unknown[]) => Promise<unknown>
  runPython(source: string): unknown
  runPythonAsync(source: string): Promise<unknown>
}

interface PyodideModule {
  loadPyodide(options: {
    indexURL: string
    packageBaseUrl: string
  }): Promise<PyodideRuntime>
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
const ALLOWED_PACKAGES = new Set<PythonPackage>(["numpy", "matplotlib"])

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https?:\/\/\S+/gi, "the local runtime")
    .slice(0, 4_096)
}

function assertRuntimeUrl() {
  const runtimeUrl = new URL(
    PYODIDE_RUNTIME_BASE_URL,
    workerScope.location.origin
  )
  if (
    runtimeUrl.origin !== workerScope.location.origin ||
    runtimeUrl.pathname !== PYODIDE_RUNTIME_BASE_URL
  ) {
    throw new Error("The local Pyodide runtime URL is invalid")
  }
  return runtimeUrl
}

function disableWorkerCapabilities() {
  const unavailable = () => {
    throw new Error("Browser capabilities are disabled inside Python blocks")
  }
  for (const name of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "WebTransport",
    "RTCPeerConnection",
    "Worker",
    "SharedWorker",
    "importScripts",
    "BroadcastChannel",
    "MessageChannel",
    "postMessage",
    "caches",
    "cookieStore",
    "indexedDB",
  ]) {
    try {
      Object.defineProperty(globalThis, name, {
        configurable: false,
        enumerable: false,
        value: unavailable,
        writable: false,
      })
    } catch {
      // Some browser globals are absent or non-configurable. The Python audit
      // hook and removal of JsFinder still make the bridge unreachable.
    }
  }
}

function disableRuntimeEntrypoints(pyodide: PyodideRuntime) {
  const unavailable = () => {
    throw new Error("Dynamic Python loading is disabled after initialization")
  }
  pyodide.loadPackage = async () => {
    throw new Error("Package loading is disabled after initialization")
  }
  if (pyodide.loadPackagesFromImports) {
    pyodide.loadPackagesFromImports = async () => {
      throw new Error("Automatic package loading is disabled")
    }
  }
  pyodide.runPython = unavailable
  pyodide.runPythonAsync = async () => unavailable()
}

function validInitialization(
  value: unknown
): value is PythonWorkerInitializeMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Partial<PythonWorkerInitializeMessage>
  return (
    message.type === "initialize" &&
    typeof message.source === "string" &&
    pythonSourceByteLength(message.source) <= MAX_PYTHON_SOURCE_BYTES &&
    Array.isArray(message.packages) &&
    message.packages.length <= ALLOWED_PACKAGES.size &&
    message.packages.every((name) => ALLOWED_PACKAGES.has(name)) &&
    message.port instanceof MessagePort
  )
}

workerScope.onmessage = async (event: MessageEvent<unknown>) => {
  if (!validInitialization(event.data)) return
  workerScope.onmessage = null
  const { source, packages, port } = event.data
  let executed = false
  let sandboxRunner: PythonSandboxRunner | null = null
  const send = (message: PythonWorkerMessage) => port.postMessage(message)
  port.start()

  try {
    send({ type: "phase", phase: "loading-runtime" })
    const runtimeUrl = assertRuntimeUrl()
    const moduleUrl = new URL("pyodide.mjs", runtimeUrl)
    const runtimeModule = (await import(
      /* webpackIgnore: true */
      /* turbopackIgnore: true */
      moduleUrl.href
    )) as PyodideModule
    const pyodide = await runtimeModule.loadPyodide({
      indexURL: runtimeUrl.href,
      packageBaseUrl: runtimeUrl.href,
    })

    if (packages.length > 0) {
      send({ type: "phase", phase: "loading-packages" })
      await pyodide.loadPackage(packages, { checkIntegrity: true })
    }
    if (packages.includes("numpy") || packages.includes("matplotlib")) {
      await pyodide.runPythonAsync("import numpy as _avermate_numpy")
    }
    if (packages.includes("matplotlib")) {
      await pyodide.runPythonAsync(
        'import matplotlib as _avermate_matplotlib\n_avermate_matplotlib.use("Agg", force=True)\nimport matplotlib.pyplot as _avermate_pyplot\n_avermate_pyplot.close("all")'
      )
    }
    disableWorkerCapabilities()
    sandboxRunner = createPythonSandboxRunner(pyodide)
    disableRuntimeEntrypoints(pyodide)
    send({ type: "phase", phase: "ready" })

    port.onmessage = async (
      commandEvent: MessageEvent<PythonWorkerCommand>
    ) => {
      if (executed || commandEvent.data?.type !== "execute") return
      executed = true
      send({ type: "phase", phase: "running" })
      const startedAt = performance.now()
      try {
        const serialized = sandboxRunner?.(source)
        if (typeof serialized !== "string") {
          throw new Error("Python returned an invalid execution result")
        }
        const parsed = JSON.parse(serialized) as {
          stdout?: unknown
          stderr?: unknown
          figures?: unknown
        }
        if (
          typeof parsed.stdout !== "string" ||
          typeof parsed.stderr !== "string" ||
          !Array.isArray(parsed.figures) ||
          !parsed.figures.every((figure) => typeof figure === "string")
        ) {
          throw new Error("Python returned malformed output")
        }
        send({
          type: "result",
          result: {
            stdout: parsed.stdout,
            stderr: parsed.stderr,
            figures: parsed.figures,
            durationMs: Math.max(0, performance.now() - startedAt),
          },
        })
      } catch (error) {
        send({
          type: "failure",
          kind: "execution",
          message: failureMessage(error),
        })
      } finally {
        sandboxRunner?.destroy?.()
        sandboxRunner = null
      }
    }
  } catch (error) {
    sandboxRunner?.destroy?.()
    sandboxRunner = null
    send({
      type: "failure",
      kind: "initialization",
      message: failureMessage(error),
    })
  }
}

export {}
