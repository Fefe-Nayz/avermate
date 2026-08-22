export type SyncJobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface SyncRunSummary {
  downloaded: number
  updated: number
  skipped: number
  errors: Array<{ externalId: string; message: string }>
}

export function isActiveSyncJob(status: string | undefined): boolean {
  return status === "queued" || status === "running"
}

export function isTerminalSyncJob(status: string | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled"
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0
}

function isSyncError(
  value: unknown
): value is { externalId: string; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.externalId === "string" &&
    typeof candidate.message === "string"
  )
}

/** Parse the untyped durable-job result without manufacturing partial counts. */
export function readSyncRunSummary(value: unknown): SyncRunSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    !nonNegativeInteger(candidate.downloaded) ||
    !nonNegativeInteger(candidate.updated) ||
    !nonNegativeInteger(candidate.skipped) ||
    !Array.isArray(candidate.errors) ||
    !candidate.errors.every(isSyncError)
  ) {
    return null
  }
  return {
    downloaded: candidate.downloaded,
    updated: candidate.updated,
    skipped: candidate.skipped,
    errors: candidate.errors,
  }
}

/** Build the Moodle mobile hand-off URL while mirroring server URL safety. */
export function moodleMobileLaunchUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    const basePath = url.pathname.replace(/\/+$/, "")
    url.pathname = `${basePath}/admin/tool/mobile/launch.php`
    url.searchParams.set("service", "moodle_mobile_app")
    url.searchParams.set("passport", "TOKEN123")
    url.searchParams.set("confirmed", "1")
    return url.toString()
  } catch {
    return null
  }
}
