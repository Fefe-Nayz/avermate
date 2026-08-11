export const ACTIVE_YEAR_COOKIE = "avermate.active-year"
export const ACTIVE_YEAR_STORAGE_KEY = "avermate:year"
export const ACTIVE_YEAR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

interface SelectableYear {
  id: string
  startsAt: Date | string
  endsAt: Date | string
  archivedAt?: Date | string | null
}

/**
 * Resolve the year the whole application shell should use.
 *
 * A valid explicit choice wins. Otherwise the school year containing today
 * is less surprising than simply choosing the first row in the list.
 */
export function resolveActiveYearId(
  years: readonly SelectableYear[],
  preferredYearId: string | null,
  now = Date.now()
): string | null {
  if (years.length === 0) return null

  const activeYears = years.filter((year) => !year.archivedAt)
  const candidates = activeYears.length > 0 ? activeYears : years

  if (
    preferredYearId &&
    candidates.some((year) => year.id === preferredYearId)
  ) {
    return preferredYearId
  }

  const current = candidates.find(
    (year) =>
      new Date(year.startsAt).getTime() <= now &&
      new Date(year.endsAt).getTime() >= now
  )

  return current?.id ?? candidates[0]?.id ?? null
}

/** Keep the next server render aligned with the interactive year switcher. */
export function writeActiveYearCookie(yearId: string): void {
  document.cookie = `${ACTIVE_YEAR_COOKIE}=${encodeURIComponent(yearId)}; path=/; max-age=${ACTIVE_YEAR_COOKIE_MAX_AGE}; samesite=lax`
}
