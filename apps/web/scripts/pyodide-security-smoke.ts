import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const PUBLIC_DIR = path.resolve(import.meta.dir, "../public")
const WORKER_URL = "/vendor/pyodide/314.0.6/pyodide-run.worker.mjs"
const RESULT_MARKER = "AVERMATE_PYODIDE_SECURITY:"

function browserExecutable() {
  const configured = process.env.CHROME_BIN?.trim()
  const candidates = [
    configured,
    process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : undefined,
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    Bun.which("google-chrome"),
    Bun.which("chromium"),
    Bun.which("chromium-browser"),
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => Bun.file(candidate).size > 0) ?? null
}

function contentType(filePath: string) {
  if (filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8"
  if (filePath.endsWith(".wasm")) return "application/wasm"
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8"
  return "application/octet-stream"
}

const hostileSource = [
  "import sys",
  "blocked = 0",
  "try:",
  "    bridge = sys.modules['builtins'].__import__('js')",
  "    bridge.fetch('/escape')",
  "except BaseException:",
  "    blocked += 1",
  "try:",
  "    print.__self__.__import__('pyodide_js')",
  "except BaseException:",
  "    blocked += 1",
  "guard = __import__",
  "original = next(cell.cell_contents for cell in guard.__closure__ if getattr(cell.cell_contents, '__name__', '') == '__import__')",
  "try:",
  "    original('js')",
  "except BaseException:",
  "    blocked += 1",
  "print(f'hostile-blocked={blocked}')",
].join("\n")

const page = String.raw`<!doctype html>
<meta charset="utf-8">
<title>running</title>
<pre id="result">running</pre>
<script type="module">
const workerUrl = ${JSON.stringify(WORKER_URL)};
function run(source, packages = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { type: "module", credentials: "omit" });
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("worker timeout"));
    }, 30000);
    channel.port1.onmessage = ({ data }) => {
      if (data?.type === "phase" && data.phase === "ready") {
        channel.port1.postMessage({ type: "execute" });
      } else if (data?.type === "result") {
        clearTimeout(timeout);
        worker.terminate();
        resolve(data.result);
      } else if (data?.type === "failure") {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    channel.port1.start();
    worker.postMessage({
      type: "initialize",
      source,
      packages,
      port: channel.port2,
    }, [channel.port2]);
  });
}
try {
  const normal = await run("print('runtime-ok')");
  const hostile = await run(${JSON.stringify(hostileSource)});
  const plot = await run("import matplotlib.pyplot as plt\nplt.plot([0, 1], [0, 1])\nprint('plot-ok')", ["matplotlib"]);
  const passed = normal.stdout === "runtime-ok\n" &&
    normal.stderr === "" &&
    hostile.stdout === "hostile-blocked=3\n" &&
    hostile.stderr === "" &&
    plot.stdout === "plot-ok\n" &&
    plot.stderr === "" &&
    plot.figures.length === 1;
  document.querySelector("#result").textContent =
    ${JSON.stringify(RESULT_MARKER)} + JSON.stringify({
      passed,
      normal,
      hostile,
      plot: { stdout: plot.stdout, stderr: plot.stderr, figures: plot.figures.length },
    });
  document.title = passed ? "passed" : "failed";
} catch (error) {
  document.querySelector("#result").textContent =
    ${JSON.stringify(RESULT_MARKER)} + JSON.stringify({ passed: false, error: String(error) });
  document.title = "failed";
}
</script>`

let escapeRequests = 0
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/") {
      return new Response(page, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }
    if (url.pathname === "/escape") {
      escapeRequests += 1
      return new Response("network escape reached", { status: 418 })
    }
    const requested = path.resolve(
      PUBLIC_DIR,
      `.${decodeURIComponent(url.pathname)}`
    )
    const relative = path.relative(PUBLIC_DIR, requested)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("not found", { status: 404 })
    }
    const file = Bun.file(requested)
    if (!(await file.exists()))
      return new Response("not found", { status: 404 })
    return new Response(file, {
      headers: { "Content-Type": contentType(requested) },
    })
  },
})

const executable = browserExecutable()
if (!executable) {
  server.stop(true)
  throw new Error(
    "Chrome/Chromium was not found; set CHROME_BIN to run this smoke test"
  )
}

const profile = await mkdtemp(path.join(os.tmpdir(), "avermate-pyodide-"))
try {
  const browser = Bun.spawn(
    [
      executable,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stderr: "pipe", stdout: "pipe" }
  )
  const diagnostics = new Response(browser.stderr).text()
  const devToolsFile = path.join(profile, "DevToolsActivePort")
  const startedAt = Date.now()
  while (!(await Bun.file(devToolsFile).exists())) {
    if (Date.now() - startedAt > 10_000) {
      browser.kill()
      throw new Error("Chrome did not expose its DevTools endpoint")
    }
    await Bun.sleep(50)
  }

  const [port] = (await Bun.file(devToolsFile).text()).trim().split(/\r?\n/)
  const targetResponse = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(server.url.href)}`,
    { method: "PUT" }
  )
  if (!targetResponse.ok) {
    browser.kill()
    throw new Error(
      `Chrome could not create the smoke target (${targetResponse.status})`
    )
  }
  const target = (await targetResponse.json()) as {
    webSocketDebuggerUrl?: string
  }
  if (!target.webSocketDebuggerUrl) {
    browser.kill()
    throw new Error("Chrome did not return a page debugging endpoint")
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >()
  let commandId = 0
  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () =>
      reject(new Error("Chrome DevTools connection failed"))
  })
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number
      result?: unknown
      error?: { message?: string }
    }
    if (typeof message.id !== "number") return
    const command = pending.get(message.id)
    if (!command) return
    pending.delete(message.id)
    if (message.error) {
      command.reject(
        new Error(message.error.message ?? "Chrome command failed")
      )
    } else {
      command.resolve(message.result)
    }
  }
  await opened
  interface DevToolsCommandParams {
    expression?: string
    returnByValue?: boolean
  }
  const command = <T>(method: string, params: DevToolsCommandParams = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++commandId
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression: string) => {
    const response = await command<{
      result?: { value?: unknown }
      exceptionDetails?: unknown
    }>("Runtime.evaluate", { expression, returnByValue: true })
    if (response.exceptionDetails) {
      throw new Error("The browser smoke page raised an exception")
    }
    return response.result?.value
  }

  await command("Runtime.enable")
  let title: unknown = ""
  const deadline = Date.now() + 45_000
  while (title !== "passed" && title !== "failed" && Date.now() < deadline) {
    title = await evaluate("document.title")
    if (title !== "passed" && title !== "failed") await Bun.sleep(100)
  }
  const resultText = await evaluate(
    "document.querySelector('#result')?.textContent ?? ''"
  )
  socket.close()
  browser.kill()
  await browser.exited
  const browserDiagnostics = await diagnostics

  let result: { passed?: boolean; error?: string } = {}
  if (typeof resultText === "string" && resultText.startsWith(RESULT_MARKER)) {
    result = JSON.parse(resultText.slice(RESULT_MARKER.length)) as typeof result
  }
  if (title !== "passed" || result.passed !== true || escapeRequests !== 0) {
    throw new Error(
      [
        `Pyodide browser smoke failed (title ${String(title)}, escape requests ${escapeRequests})`,
        JSON.stringify(result),
        browserDiagnostics.slice(-2_048),
      ].join("\n")
    )
  }
  console.log(
    "Pyodide browser security smoke passed; no network escape was observed"
  )
} finally {
  server.stop(true)
  const resolvedProfile = path.resolve(profile)
  if (!resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error(
      "Refusing to remove a browser profile outside the temporary directory"
    )
  }
  await rm(resolvedProfile, { force: true, recursive: true })
}
