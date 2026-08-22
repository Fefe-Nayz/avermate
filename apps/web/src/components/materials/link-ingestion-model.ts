export type LinkIngestionStatus = "idle" | "pending" | "ready" | "failed"
export type LinkIngestionDisplayStatus =
  LinkIngestionStatus | "loading" | "unavailable"

export interface WebIngestionMeta {
  finalUrl?: unknown
  fetchedAt?: unknown
  title?: unknown
  byline?: unknown
}

export interface WebProvenance {
  url: string
  host: string
  fetchedAt: Date | null
  byline: string | null
}

export function webIngestionMeta(value: unknown): WebIngestionMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.finalUrl !== "string" ||
    typeof record.fetchedAt !== "string"
  ) {
    return null
  }
  if (record.title !== undefined && typeof record.title !== "string")
    return null
  if (
    record.byline !== undefined &&
    record.byline !== null &&
    typeof record.byline !== "string"
  ) {
    return null
  }
  return {
    finalUrl: record.finalUrl,
    fetchedAt: record.fetchedAt,
    title: record.title,
    byline: record.byline,
  }
}

export function safeWebSourceHref(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

export function normalizedLinkIngestionStatus(
  status: LinkIngestionStatus | undefined,
  loading = false,
  unavailable = false
): LinkIngestionDisplayStatus {
  if (unavailable) return "unavailable"
  return loading && status === undefined ? "loading" : (status ?? "idle")
}

export function webProvenance(
  value: unknown,
  sourceUrl: string | null
): WebProvenance | null {
  const meta = webIngestionMeta(value)
  const url =
    (typeof meta?.finalUrl === "string"
      ? safeWebSourceHref(meta.finalUrl)
      : null) ?? safeWebSourceHref(sourceUrl)
  if (!url) return null

  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    // Retain the source text if an old row contains a malformed URL.
  }

  const parsedDate =
    typeof meta?.fetchedAt === "string" ? new Date(meta.fetchedAt) : null
  const fetchedAt =
    parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null

  return {
    url,
    host,
    fetchedAt,
    byline:
      typeof meta?.byline === "string" && meta.byline.trim()
        ? meta.byline.trim()
        : null,
  }
}
