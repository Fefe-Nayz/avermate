import {
  MAX_PYTHON_FIGURE_BYTES,
  MAX_PYTHON_FIGURES,
  MAX_PYTHON_STREAM_BYTES,
  MAX_PYTHON_TOTAL_FIGURE_BYTES,
} from "./python-run-policy"

export interface PythonSandboxRuntime {
  globals: unknown
  runPython(source: string): unknown
}

export interface PythonSandboxRunner {
  (source: string): unknown
  destroy?(): void
}

/**
 * Build the only Python callable that remains reachable after startup.
 *
 * The important boundary is not the globals dictionary passed to exec():
 * Python objects make that dictionary escapable. Instead, the bootstrap also
 * patches the process-wide import function, installs a non-removable CPython
 * audit hook, removes Pyodide's JsFinder and evicts every bridge module before
 * untrusted source is invoked. The worker itself supplies the second boundary
 * by removing browser networking primitives.
 */
export const PYTHON_SANDBOX_BOOTSTRAP = String.raw`
def _avermate_create_sandbox():
    import asyncio as _asyncio
    import base64 as _base64
    import builtins as _builtins
    import contextlib as _contextlib
    import io as _io
    import json as _json
    import sys as _sys
    import traceback as _traceback
    import warnings as _warnings

    _stream_limit = ${MAX_PYTHON_STREAM_BYTES}
    _figure_limit = ${MAX_PYTHON_FIGURES}
    _figure_bytes = ${MAX_PYTHON_FIGURE_BYTES}
    _total_figure_bytes = ${MAX_PYTHON_TOTAL_FIGURE_BYTES}
    _truncated = "\n… output truncated by Avermate …\n"
    _blocked_roots = frozenset({
        "__main__", "_pyodide", "_pyodide_core", "aiohttp", "builtins",
        "ctypes", "ftplib", "gc", "http", "imaplib", "importlib", "inspect",
        "js", "marshal", "micropip", "pickle", "poplib", "pyodide",
        "pyodide_js", "requests",
        "shelve", "smtplib", "socket", "ssl", "telnetlib", "urllib",
        "webbrowser", "websockets", "xmlrpc",
    })
    _original_import = _builtins.__import__

    def _blocked_root(name):
        return str(name or "").lstrip(".").partition(".")[0]

    def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = _blocked_root(name)
        if root in _blocked_roots:
            raise ImportError(f"{root} is unavailable in an offline Python block")
        return _original_import(name, globals, locals, fromlist, level)

    def _audit_import(event, args):
        # An audit hook is held by CPython and has no removal API. It therefore
        # still applies if source code recovers _original_import through a
        # frame, a closure, sys.modules or another preloaded module.
        if event == "import" and args:
            root = _blocked_root(args[0])
            if root in _blocked_roots:
                raise ImportError(f"{root} is unavailable in an offline Python block")

    class _CappedText(_io.TextIOBase):
        def __init__(self):
            self._parts = []
            self._size = 0
            self._was_truncated = False

        @property
        def encoding(self):
            return "utf-8"

        def writable(self):
            return True

        def write(self, value):
            text = str(value)
            encoded = text.encode("utf-8", errors="replace")
            remaining = _stream_limit - self._size
            if remaining > 0:
                kept = encoded[:remaining].decode("utf-8", errors="ignore")
                self._parts.append(kept)
                self._size += len(kept.encode("utf-8"))
            if len(encoded) > remaining:
                self._was_truncated = True
            return len(text)

        def flush(self):
            return None

        def getvalue(self):
            text = "".join(self._parts)
            return text + (_truncated if self._was_truncated else "")

    def _execute(source):
        stdout = _CappedText()
        stderr = _CappedText()
        safe_builtins = dict(vars(_builtins))
        safe_builtins["__import__"] = _guarded_import
        execution_globals = {
            "__name__": "__main__",
            "__builtins__": safe_builtins,
        }

        try:
            with _contextlib.redirect_stdout(stdout), _contextlib.redirect_stderr(stderr):
                exec(compile(str(source), "<avermate-python-run>", "exec"), execution_globals, execution_globals)
        except BaseException:
            _traceback.print_exc(file=stderr)

        figures = []
        total_figure_bytes = 0
        try:
            # pyplot is preloaded by the worker when matplotlib was requested;
            # consulting the captured sys module avoids another trusted import.
            plt = _sys.modules.get("matplotlib.pyplot")
            if plt is not None:
                for number in plt.get_fignums()[:_figure_limit]:
                    figure = plt.figure(number)
                    width, height = figure.get_size_inches()
                    if width > 16 or height > 12:
                        figure.set_size_inches(min(width, 16), min(height, 12), forward=True)
                    buffer = _io.BytesIO()
                    figure.savefig(
                        buffer,
                        format="png",
                        dpi=min(max(float(figure.dpi), 72), 144),
                        bbox_inches="tight",
                    )
                    png = buffer.getvalue()
                    if len(png) > _figure_bytes or total_figure_bytes + len(png) > _total_figure_bytes:
                        stderr.write("A matplotlib figure was omitted because it exceeded the output limit.\n")
                        break
                    total_figure_bytes += len(png)
                    figures.append("data:image/png;base64," + _base64.b64encode(png).decode("ascii"))
                    plt.close(figure)
        except BaseException:
            _traceback.print_exc(file=stderr)

        return _json.dumps({
            "stdout": stdout.getvalue(),
            "stderr": stderr.getvalue(),
            "figures": figures,
        })

    # Pyodide installs a WebLoopPolicy whose method globals retain a JsProxy to
    # scheduleCallback. Replace it before purging the bridge modules; otherwise
    # source could recover that proxy without importing js at all.
    with _warnings.catch_warnings():
        _warnings.simplefilter("ignore", DeprecationWarning)
        _asyncio.set_event_loop_policy(_asyncio.DefaultEventLoopPolicy())

    # Neutralize direct proxies retained in every preloaded module dictionary.
    # This also invalidates references held by classes whose module was later
    # evicted, and covers optional scientific packages loaded before lockdown.
    for module_name, module in tuple(_sys.modules.items()):
        if module is None:
            continue
        try:
            namespace = vars(module)
        except TypeError:
            continue
        for attribute, value in tuple(namespace.items()):
            value_type = type(value)
            if value_type.__module__ == "pyodide.ffi" and value_type.__name__ in {"JsProxy", "JsDoubleProxy"}:
                namespace[attribute] = None

    # JsFinder is the special import hook behind the Python js import. Removing it makes
    # the bridge unreachable even if source code obtains an unwrapped importer.
    _sys.meta_path[:] = [
        finder for finder in _sys.meta_path
        if type(finder).__name__ != "JsFinder"
    ]
    _sys.addaudithook(_audit_import)
    _builtins.__import__ = _guarded_import

    # Pyodide eagerly imports its bridge modules. Leaving them in sys.modules
    # would make an import guard irrelevant, so evict the complete root set.
    for module_name in tuple(_sys.modules):
        # Keep the already-patched builtins module so code that legitimately
        # inspects sys.modules cannot turn a missing entry into surprising
        # behaviour. Its __import__ is the guarded process-wide function.
        if module_name != "builtins" and _blocked_root(module_name) in _blocked_roots:
            _sys.modules.pop(module_name, None)

    return _execute

_avermate_create_sandbox()
`

export function createPythonSandboxRunner(
  runtime: PythonSandboxRuntime
): PythonSandboxRunner {
  const runner = runtime.runPython(PYTHON_SANDBOX_BOOTSTRAP)
  const globals = runtime.globals as {
    delete?: (name: string) => unknown
  }
  globals.delete?.("_avermate_create_sandbox")
  if (typeof runner !== "function") {
    throw new Error("The local Python sandbox could not be initialized")
  }
  return runner as PythonSandboxRunner
}
