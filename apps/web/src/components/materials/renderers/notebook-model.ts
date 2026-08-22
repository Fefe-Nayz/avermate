export const MAX_NOTEBOOK_CELLS = 500
export const MAX_NOTEBOOK_OUTPUTS = 1_000
export const MAX_NOTEBOOK_CELL_CHARS = 256 * 1024
export const MAX_NOTEBOOK_OUTPUT_CHARS = 256 * 1024
export const MAX_NOTEBOOK_IMAGE_BYTES = 1024 * 1024

export type NotebookOutput =
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl: string; alt: string }

export interface SafeNotebookCell {
  kind: "markdown" | "code" | "raw"
  source: string
  language: string
  executionCount: string | null
  outputs: NotebookOutput[]
}

export type SafeNotebookResult =
  | { ok: true; cells: SafeNotebookCell[]; truncated: boolean }
  | { ok: false; issue: string }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function joinedText(value: unknown): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
    return value.join("")
  }
  return null
}

function boundedText(value: unknown): string | null {
  const text = joinedText(value)
  if (text === null || text.length > MAX_NOTEBOOK_OUTPUT_CHARS) return null
  // Terminal control sequences should not affect the surrounding reader.
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
}

function safeLanguage(value: unknown): string {
  if (typeof value !== "string") return "text"
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9+#._-]{1,40}$/.test(normalized) ? normalized : "text"
}

function pngDataUrl(value: unknown): string | null {
  const encoded = joinedText(value)?.replace(/\s/g, "")
  if (!encoded || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return null
  }
  const estimatedBytes = Math.floor((encoded.length * 3) / 4)
  if (estimatedBytes > MAX_NOTEBOOK_IMAGE_BYTES) return null
  return `data:image/png;base64,${encoded}`
}

function outputFrom(value: unknown): NotebookOutput | null {
  const output = record(value)
  if (!output) return null
  const outputType = output.output_type
  if (outputType === "stream") {
    const text = boundedText(output.text)
    return text ? { kind: "text", text } : null
  }
  if (outputType === "error") {
    const traceback = boundedText(output.traceback)
    const summary = [output.ename, output.evalue]
      .filter((part): part is string => typeof part === "string")
      .join(": ")
    const text = traceback || boundedText(summary)
    return text ? { kind: "text", text } : null
  }
  if (outputType !== "display_data" && outputType !== "execute_result") {
    return null
  }

  const data = record(output.data)
  if (!data) return null
  const image = pngDataUrl(data["image/png"])
  if (image) return { kind: "image", dataUrl: image, alt: "Notebook output" }
  const plain = boundedText(data["text/plain"])
  if (plain) return { kind: "text", text: plain }
  const json = data["application/json"]
  if (json !== undefined) {
    try {
      const text = JSON.stringify(json, null, 2)
      return text.length <= MAX_NOTEBOOK_OUTPUT_CHARS
        ? { kind: "text", text }
        : null
    } catch {
      return null
    }
  }
  // Deliberately ignore text/html, SVG and JavaScript notebook outputs.
  return null
}

/** Parse a notebook into an inert, bounded model suitable for React rendering. */
export function parseSafeNotebook(source: string): SafeNotebookResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ok: false, issue: "This notebook is not valid JSON." }
  }
  const notebook = record(parsed)
  if (!notebook || !Array.isArray(notebook.cells)) {
    return { ok: false, issue: "This file is not a Jupyter notebook." }
  }

  const metadata = record(notebook.metadata)
  const languageInfo = record(metadata?.language_info)
  const kernelSpec = record(metadata?.kernelspec)
  const notebookLanguage = safeLanguage(
    languageInfo?.name ?? kernelSpec?.language ?? "text"
  )
  const cells: SafeNotebookCell[] = []
  let outputCount = 0
  let truncated = notebook.cells.length > MAX_NOTEBOOK_CELLS

  for (const rawCell of notebook.cells.slice(0, MAX_NOTEBOOK_CELLS)) {
    const cell = record(rawCell)
    const sourceText = joinedText(cell?.source)
    if (
      !cell ||
      sourceText === null ||
      sourceText.length > MAX_NOTEBOOK_CELL_CHARS
    ) {
      truncated = true
      continue
    }
    const kind =
      cell.cell_type === "markdown"
        ? "markdown"
        : cell.cell_type === "code"
          ? "code"
          : "raw"
    const outputs: NotebookOutput[] = []
    if (kind === "code" && Array.isArray(cell.outputs)) {
      for (const rawOutput of cell.outputs) {
        if (outputCount >= MAX_NOTEBOOK_OUTPUTS) {
          truncated = true
          break
        }
        outputCount += 1
        const safeOutput = outputFrom(rawOutput)
        if (safeOutput) outputs.push(safeOutput)
      }
    }
    const executionCount =
      typeof cell.execution_count === "number" ||
      typeof cell.execution_count === "string"
        ? String(cell.execution_count)
        : null
    cells.push({
      kind,
      source: sourceText,
      language: kind === "code" ? notebookLanguage : "text",
      executionCount,
      outputs,
    })
  }

  return { ok: true, cells, truncated }
}
