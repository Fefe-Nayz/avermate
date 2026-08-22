export type SchoolConnectionStatus =
  "pending" | "active" | "error" | "revoked" | "disconnected"

export type SchoolConnectionUiState =
  "unavailable" | "connected" | "attention" | "pending" | "reconnect"

export function schoolConnectionState(
  status: SchoolConnectionStatus,
  providerAvailable: boolean
): SchoolConnectionUiState {
  if (!providerAvailable) return "unavailable"
  if (status === "active") return "connected"
  if (status === "error") return "attention"
  if (status === "pending") return "pending"
  return "reconnect"
}

export function gradeRecordCounts(
  rows: readonly {
    syncState: "managed" | "missing" | "dismissed"
    value: number | null
    outOf: number | null
    significant: boolean
  }[]
) {
  return rows.reduce(
    (counts, row) => {
      counts[row.syncState] += 1
      if (!row.significant || row.value === null || row.outOf === null) {
        counts.nonNumeric += 1
      }
      return counts
    },
    { managed: 0, missing: 0, dismissed: 0, nonNumeric: 0 }
  )
}

export function academicYearDateValue(value: Date, timezone = "Europe/Paris") {
  return isoDateInTimeZone(value, timezone)
}

export function academicYearBoundary(
  value: string,
  edge: "start" | "end",
  timezone = "Europe/Paris"
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  try {
    const range = zonedDayRange(value, timezone)
    return edge === "start" ? range.from : range.to
  } catch {
    return null
  }
}
import { isoDateInTimeZone, zonedDayRange } from "@avermate/core/planning"
