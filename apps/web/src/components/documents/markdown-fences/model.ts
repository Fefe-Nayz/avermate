export type EmbeddedFenceKind = "mermaid" | "vega-lite" | "dot" | "datacard"

export const MAX_DIAGRAM_SOURCE_BYTES = 64 * 1024
export const MAX_VEGA_SOURCE_BYTES = 256 * 1024
export const MAX_HIGHLIGHT_SOURCE_BYTES = 256 * 1024
export const MAX_VEGA_NODES = 50_000
export const MAX_VEGA_DEPTH = 32
export const MAX_VEGA_DATA_ROWS = 20_000
export const MAX_DATACARD_REFERENCE_BYTES = 1_024

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function embeddedFenceKind(language: string): EmbeddedFenceKind | null {
  const normalized = language.trim().toLowerCase()
  if (normalized === "mermaid") return "mermaid"
  if (normalized === "vega-lite" || normalized === "vegalite") {
    return "vega-lite"
  }
  if (normalized === "dot" || normalized === "graphviz") return "dot"
  if (normalized === "datacard") return "datacard"
  return null
}

export function codeFenceMeta(node: unknown): string {
  if (!node || typeof node !== "object" || !("children" in node)) return ""
  const children = (node as { children?: unknown }).children
  if (!Array.isArray(children)) return ""
  const code = children.find((child): child is { data?: { meta?: unknown } } =>
    Boolean(child && typeof child === "object" && "data" in child)
  )
  return typeof code?.data?.meta === "string" ? code.data.meta : ""
}

/** Plain Python remains highlighted source; only an explicit `run` opts in. */
export function isPythonRunFence(language: string, meta: string) {
  const normalizedLanguage = language.trim().toLowerCase()
  if (normalizedLanguage !== "python" && normalizedLanguage !== "py") {
    return false
  }
  return meta.trim().toLowerCase().split(/\s+/).includes("run")
}

export function embeddedFenceIssue(
  kind: EmbeddedFenceKind,
  source: string
): string | null {
  const maximum =
    kind === "vega-lite"
      ? MAX_VEGA_SOURCE_BYTES
      : kind === "datacard"
        ? MAX_DATACARD_REFERENCE_BYTES
        : MAX_DIAGRAM_SOURCE_BYTES
  if (utf8Bytes(source) > maximum) {
    return `This ${kind} block is too large to render safely.`
  }
  if (!source.trim()) return `This ${kind} block is empty.`
  return null
}

export type DatacardReferenceResult =
  { ok: true; id: string } | { ok: false; issue: string }

/** Read the compact id (or JSON reference) stored inside a datacard fence. */
export function parseDatacardReference(
  source: string
): DatacardReferenceResult {
  const issue = embeddedFenceIssue("datacard", source)
  if (issue) return { ok: false, issue }
  const trimmed = source.trim()
  let id: unknown = trimmed.replace(/^datacard:\s*/i, "")
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      id =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).id
          : null
    } catch {
      return { ok: false, issue: "This datacard reference is not valid JSON." }
    }
  }
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(id.trim())) {
    return { ok: false, issue: "This datacard reference has an invalid id." }
  }
  return { ok: true, id: id.trim() }
}

export type VegaSpecResult =
  { ok: true; spec: Record<string, unknown> } | { ok: false; issue: string }

/**
 * Parse a bounded, self-contained Vega-Lite document.
 *
 * Remote `url`/`href` values are refused: opening a fiche must never become a
 * cross-origin request chosen by its author. Inline values are useful for the
 * study use case and remain available behind explicit node/depth/row limits.
 */
export function parseSafeVegaLiteSpec(source: string): VegaSpecResult {
  const sizeIssue = embeddedFenceIssue("vega-lite", source)
  if (sizeIssue) return { ok: false, issue: sizeIssue }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ok: false, issue: "This Vega-Lite block is not valid JSON." }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, issue: "A Vega-Lite specification must be an object." }
  }

  let nodes = 0
  const stack: Array<{ value: unknown; depth: number; key: string | null }> = [
    { value: parsed, depth: 0, key: null },
  ]
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > MAX_VEGA_NODES) {
      return { ok: false, issue: "This Vega-Lite block is too complex." }
    }
    if (current.depth > MAX_VEGA_DEPTH) {
      return { ok: false, issue: "This Vega-Lite block is nested too deeply." }
    }
    if (
      (current.key === "url" || current.key === "href") &&
      typeof current.value === "string"
    ) {
      return {
        ok: false,
        issue: "Remote URLs are not allowed in embedded Vega-Lite charts.",
      }
    }
    if (
      current.key !== "$schema" &&
      typeof current.value === "string" &&
      /^(?:https?:\/\/|\/\/|data:|blob:|javascript:)/i.test(
        current.value.trim()
      )
    ) {
      return {
        ok: false,
        issue:
          "External resources are not allowed in embedded Vega-Lite charts.",
      }
    }
    if (typeof current.value === "string" && current.value.length > 64 * 1024) {
      return {
        ok: false,
        issue: "This Vega-Lite block contains oversized text.",
      }
    }
    if (Array.isArray(current.value)) {
      if (
        current.key === "values" &&
        current.value.length > MAX_VEGA_DATA_ROWS
      ) {
        return {
          ok: false,
          issue: `An embedded chart can contain at most ${MAX_VEGA_DATA_ROWS} data rows.`,
        }
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
          key: null,
        })
      }
      continue
    }
    if (!current.value || typeof current.value !== "object") continue
    for (const [key, value] of Object.entries(current.value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        return { ok: false, issue: "This Vega-Lite block has an unsafe key." }
      }
      stack.push({ value, depth: current.depth + 1, key })
    }
  }

  const schema = (parsed as Record<string, unknown>).$schema
  if (
    typeof schema === "string" &&
    !/^https:\/\/vega\.github\.io\/schema\/vega-lite\/v\d+(?:\.\d+)?\.json$/i.test(
      schema
    )
  ) {
    return { ok: false, issue: "Only Vega-Lite specifications are supported." }
  }
  return { ok: true, spec: parsed as Record<string, unknown> }
}
