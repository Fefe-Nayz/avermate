import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import { codeFenceMeta, isPythonRunFence } from "./model"
import {
  MAX_PYTHON_SOURCE_BYTES,
  packagesForPythonSource,
  pythonSourceIssue,
  PYODIDE_RUNTIME_BASE_URL,
  PYODIDE_VERSION,
} from "./python-run-policy"
import { parsePythonWorkerMessage } from "./python-run-protocol"
import {
  PythonRunError,
  runPythonInBrowser,
  type PythonRunOptions,
} from "./python-runner"

class FakePort {
  closed = false
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  peer: FakePort | null = null

  close() {
    this.closed = true
  }

  postMessage(message: unknown) {
    queueMicrotask(() => {
      this.peer?.onmessage?.({ data: message } as MessageEvent<unknown>)
    })
  }

  start() {}
}

function fakeChannel() {
  const port1 = new FakePort()
  const port2 = new FakePort()
  port1.peer = port2
  port2.peer = port1
  return { port1, port2 }
}

class FakeWorker {
  terminated = false
  initialization: Record<string, unknown> | null = null

  constructor(
    private readonly initialize: (message: Record<string, unknown>) => void
  ) {}

  addEventListener() {}

  postMessage(message: unknown) {
    this.initialization = message as Record<string, unknown>
    this.initialize(this.initialization)
  }

  terminate() {
    this.terminated = true
  }
}

function dependencies(
  worker: FakeWorker,
  channel = fakeChannel(),
  bootTimeoutMs = 1_000
): NonNullable<PythonRunOptions["dependencies"]> {
  return {
    bootTimeoutMs,
    channelFactory: () => channel,
    workerFactory: () => worker,
  }
}

describe("explicit Python run fences", () => {
  test("requires the run meta flag and reads it from the real Markdown HAST", () => {
    let metadata = ""
    renderToStaticMarkup(
      <ReactMarkdown
        components={{
          pre({ node, children }) {
            metadata = codeFenceMeta(node)
            return <pre>{children}</pre>
          },
        }}
      >
        {"```python run\nprint(42)\n```"}
      </ReactMarkdown>
    )
    expect(metadata).toBe("run")
    expect(isPythonRunFence("python", metadata)).toBe(true)
    expect(isPythonRunFence("python", "")).toBe(false)
  })

  test("loads only the pinned local scientific package closure", () => {
    expect(PYODIDE_VERSION).toBe("314.0.6")
    expect(PYODIDE_RUNTIME_BASE_URL).toBe("/vendor/pyodide/314.0.6/")
    expect(packagesForPythonSource("print(1)")).toEqual([])
    expect(packagesForPythonSource("import numpy as np")).toEqual(["numpy"])
    expect(
      packagesForPythonSource(
        "import numpy as np\nimport matplotlib.pyplot as plt"
      )
    ).toEqual(["matplotlib"])
    expect(packagesForPythonSource("# import numpy\nprint('offline')")).toEqual(
      []
    )
    expect(
      pythonSourceIssue("x".repeat(MAX_PYTHON_SOURCE_BYTES + 1))
    ).not.toBeNull()
  })

  test("uses a private channel, waits for ready, then returns bounded output", async () => {
    const phases: string[] = []
    const worker = new FakeWorker((message) => {
      expect(message.packages).toEqual(["numpy"])
      const port = message.port as FakePort
      port.onmessage = (event) => {
        expect(event.data).toEqual({ type: "execute" })
        port.postMessage({
          type: "result",
          result: {
            stdout: "3\n",
            stderr: "",
            figures: [],
            durationMs: 12,
          },
        })
      }
      port.postMessage({ type: "phase", phase: "ready" })
    })
    const result = await runPythonInBrowser("import numpy\nprint(3)", {
      dependencies: dependencies(worker),
      onPhase: (phase) => phases.push(phase),
    })
    expect(result).toEqual({
      stdout: "3\n",
      stderr: "",
      figures: [],
      durationMs: 12,
    })
    expect(phases).toEqual(["ready"])
    expect(worker.terminated).toBe(true)
  })

  test("enforces the wall-clock cap by terminating the disposable worker", async () => {
    const worker = new FakeWorker((message) => {
      const port = message.port as FakePort
      port.onmessage = () => undefined
      port.postMessage({ type: "phase", phase: "ready" })
    })
    const run = runPythonInBrowser("while True: pass", {
      timeoutMs: 1_000,
      dependencies: dependencies(worker),
    })
    await expect(run).rejects.toMatchObject({
      name: "PythonRunError",
      kind: "timeout",
    })
    expect(worker.terminated).toBe(true)
  }, 3_000)

  test("rejects invalid source before allocating a worker", async () => {
    let allocated = false
    const run = runPythonInBrowser(" ", {
      dependencies: {
        workerFactory: () => {
          allocated = true
          throw new Error("must not allocate")
        },
      },
    })
    await expect(run).rejects.toBeInstanceOf(PythonRunError)
    expect(allocated).toBe(false)
  })

  test("rejects oversized or spoofed worker messages", () => {
    expect(parsePythonWorkerMessage({ type: "result", result: {} })).toBeNull()
    expect(
      parsePythonWorkerMessage({
        type: "result",
        result: {
          stdout: "",
          stderr: "",
          figures: ["https://attacker.example/figure.png"],
          durationMs: 1,
        },
      })
    ).toBeNull()
  })

  test("self-hosts verified assets and blocks network before user code", () => {
    const directory = import.meta.dir
    const worker = readFileSync(`${directory}/pyodide-run.worker.ts`, "utf8")
    const sandbox = readFileSync(`${directory}/python-sandbox.ts`, "utf8")
    const runner = readFileSync(`${directory}/python-runner.ts`, "utf8")
    const assets = readFileSync(
      new URL("../../../../scripts/sync-pyodide-assets.ts", import.meta.url),
      "utf8"
    )
    expect(runner).toContain(
      "`${PYODIDE_RUNTIME_BASE_URL}pyodide-run.worker.mjs`"
    )
    expect(runner).toContain('credentials: "omit"')
    expect(worker).toContain('"fetch"')
    expect(worker).toContain('"XMLHttpRequest"')
    expect(worker).toContain('"WebSocket"')
    expect(worker).toContain('"indexedDB"')
    expect(worker).toContain("disableWorkerCapabilities()")
    expect(worker.indexOf("disableWorkerCapabilities()")).toBeLessThan(
      worker.indexOf("createPythonSandboxRunner(pyodide)")
    )
    expect(sandbox).toContain("_sys.addaudithook(_audit_import)")
    expect(sandbox).toContain('type(finder).__name__ != "JsFinder"')
    expect(sandbox).toContain('module_name != "builtins"')
    expect(worker).not.toContain("/api/")
    expect(assets).toContain("failed SHA-256 verification")
    expect(assets).toContain("314.0.6")
  })
})
