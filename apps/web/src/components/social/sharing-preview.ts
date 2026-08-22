export type SharingHistoryState = "locked" | "empty" | "shared"

export function sharingHistoryState(
  history: readonly unknown[] | null | undefined
): SharingHistoryState {
  if (history == null) return "locked"
  return history.length === 0 ? "empty" : "shared"
}
