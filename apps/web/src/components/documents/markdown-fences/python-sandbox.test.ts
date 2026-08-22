import { describe, expect, test } from "bun:test"
import {
  createPythonSandboxRunner,
  type PythonSandboxRunner,
} from "./python-sandbox"

interface SandboxResult {
  stdout: string
  stderr: string
  figures: string[]
}

function execute(runner: PythonSandboxRunner, source: string): SandboxResult {
  const serialized = runner(source)
  expect(typeof serialized).toBe("string")
  return JSON.parse(String(serialized)) as SandboxResult
}

describe("the real Pyodide sandbox", () => {
  test("blocks bridge and network imports even through hostile importer recovery", async () => {
    const { loadPyodide } = await import("pyodide")
    const runtime = await loadPyodide()
    const runner = createPythonSandboxRunner(runtime)

    try {
      expect(execute(runner, "print(6 * 7)")).toMatchObject({
        stdout: "42\n",
        stderr: "",
        figures: [],
      })

      const attacks = [
        "import js\nprint('bridge-reached')",
        [
          "import sys",
          "sys.modules['builtins'].__import__('js')",
          "print('bridge-reached')",
        ].join("\n"),
        "print.__self__.__import__('pyodide_js')\nprint('bridge-reached')",
        [
          "guard = __import__",
          "original = next(cell.cell_contents for cell in guard.__closure__ if getattr(cell.cell_contents, '__name__', '') == '__import__')",
          "original('js')",
          "print('bridge-reached')",
        ].join("\n"),
        "import urllib.request\nprint('network-reached')",
      ]

      for (const attack of attacks) {
        const result = execute(runner, attack)
        expect(result.stdout).not.toContain("bridge-reached")
        expect(result.stdout).not.toContain("network-reached")
        expect(result.stderr).toContain("ImportError")
      }

      const internals = execute(
        runner,
        [
          "import asyncio, sys",
          "print(any(type(finder).__name__ == 'JsFinder' for finder in sys.meta_path))",
          "print(any(name == 'js' or name.startswith('pyodide') or name.startswith('_pyodide') for name in sys.modules))",
          "policy = asyncio.get_event_loop_policy()",
          "print(type(policy).__module__.startswith('pyodide'))",
          "print(any(type(value).__module__ == 'pyodide.ffi' and type(value).__name__.startswith('Js') for method in vars(type(policy)).values() if hasattr(method, '__globals__') for value in method.__globals__.values()))",
          "print(any(type(value).__name__ in ('JsProxy', 'JsDoubleProxy') for module in tuple(sys.modules.values()) if module is not None for value in vars(module).values()))",
          "seen, pending, retained = set(), [object], []",
          "while pending:",
          "    base = pending.pop()",
          "    try:",
          "        subclasses = base.__subclasses__()",
          "    except BaseException:",
          "        continue",
          "    for cls in subclasses:",
          "        if cls in seen:",
          "            continue",
          "        seen.add(cls)",
          "        pending.append(cls)",
          "        for method in vars(cls).values():",
          "            if hasattr(method, '__globals__') and any(type(value).__name__ in ('JsProxy', 'JsDoubleProxy') for value in method.__globals__.values()):",
          "                retained.append(cls)",
          "print(bool(retained))",
        ].join("\n")
      )
      expect(internals).toMatchObject({
        stdout: "False\nFalse\nFalse\nFalse\nFalse\nFalse\n",
      })
      expect(internals.stderr).not.toContain("Traceback")
    } finally {
      runner.destroy?.()
    }
  }, 30_000)
})
