export const PYODIDE_VERSION = "314.0.5"
export const PYODIDE_RUNTIME_BASE_URL = `/vendor/pyodide/${PYODIDE_VERSION}/`

export const MAX_PYTHON_SOURCE_BYTES = 64 * 1024
export const PYTHON_RUN_TIMEOUT_MS = 10_000
export const PYTHON_BOOT_TIMEOUT_MS = 120_000
export const MAX_PYTHON_STREAM_BYTES = 128 * 1024
export const MAX_PYTHON_FIGURES = 4
export const MAX_PYTHON_FIGURE_BYTES = 4 * 1024 * 1024
export const MAX_PYTHON_TOTAL_FIGURE_BYTES = 8 * 1024 * 1024

export type PythonPackage = "numpy" | "matplotlib"

const PACKAGE_IMPORTS: ReadonlyArray<{
  name: PythonPackage
  pattern: RegExp
}> = [
  {
    name: "matplotlib",
    pattern:
      /^\s*(?:from\s+(?:matplotlib|mpl_toolkits)\b|import\s+[^#\n]*(?:matplotlib|pylab)\b)/m,
  },
  {
    name: "numpy",
    pattern: /^\s*(?:from\s+numpy\b|import\s+[^#\n]*\bnumpy\b)/m,
  },
]

export function pythonSourceByteLength(source: string) {
  return new TextEncoder().encode(source).byteLength
}

export function pythonSourceIssue(source: string): string | null {
  if (!source.trim()) return "This Python block is empty."
  if (pythonSourceByteLength(source) > MAX_PYTHON_SOURCE_BYTES) {
    return "This Python block is too large to run safely."
  }
  return null
}

/**
 * Resolve only the scientific packages that Avermate self-hosts. Pyodide's
 * automatic import loader is deliberately not used: it would turn arbitrary
 * user imports into runtime network requests.
 */
export function packagesForPythonSource(source: string): PythonPackage[] {
  const packages = PACKAGE_IMPORTS.flatMap(({ name, pattern }) =>
    pattern.test(source) ? [name] : []
  )
  // Matplotlib already depends on numpy, so asking for both only duplicates
  // progress work and makes the protocol less deterministic.
  if (packages.includes("matplotlib")) return ["matplotlib"]
  return packages
}

export function safePythonTimeout(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return PYTHON_RUN_TIMEOUT_MS
  }
  return Math.min(30_000, Math.max(1_000, Math.round(value)))
}
