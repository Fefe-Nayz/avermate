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

export type LinkIngestionReasonCode =
  | "static_empty"
  | "dynamic_required"
  | "blocked_destination"
  | "authentication_required"
  | "content_too_large"
  | "publisher_denied"
  | "unsupported_content"
  | "captions_unavailable"
  | "permission_required"
  | "extractor_blocked"
  | "duration_limit"
  | "transcription_unavailable"
  | "upstream_changed"
  | "placement_unavailable"
  | "capability_disabled"
  | "request_limit"
  | "cancelled"
  | "internal_failure"

export function canRetryWithDynamicRendering(
  reason: string | null | undefined
): boolean {
  return reason === "static_empty" || reason === "dynamic_required"
}

export function ingestionReasonMessage(
  reason: string | null | undefined
): string | null {
  switch (reason) {
    case "static_empty":
    case "dynamic_required":
      return "The static page did not expose readable content. A sandboxed browser retry may help."
    case "blocked_destination":
      return "The destination was blocked by the public-network safety policy."
    case "authentication_required":
      return "Authenticated or private pages are not supported."
    case "publisher_denied":
      return "The publisher or configured provider policy denied extraction."
    case "captions_unavailable":
      return "No platform captions were available for this video."
    case "placement_unavailable":
      return "The required sandbox execution placement is not configured."
    case "capability_disabled":
      return "This advanced ingestion capability is disabled on the selected deployment."
    case "content_too_large":
      return "The source exceeded an ingestion size or duration limit."
    case "request_limit":
      return "The renderer exceeded its bounded request or origin budget."
    case "permission_required":
      return "This fallback requires explicit authorization."
    case "extractor_blocked":
      return "The media provider blocked the bounded extraction request."
    case "duration_limit":
      return "The media duration exceeds the configured processing limit."
    case "transcription_unavailable":
      return "No compatible transcription service is available for this source."
    case "upstream_changed":
      return "The source changed while it was being processed. Retry from the latest revision."
    case "unsupported_content":
      return "This source format is not supported by the selected adapter."
    case "cancelled":
      return "The ingestion attempt was cancelled."
    case "internal_failure":
      return "The ingestion attempt failed unexpectedly."
    default:
      return null
  }
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
