const DAY_IN_MS = 24 * 60 * 60 * 1000

function isCalendarYear(startsAt: Date, endsAt: Date): boolean {
  return (
    startsAt.getFullYear() === endsAt.getFullYear() &&
    startsAt.getMonth() === 0 &&
    startsAt.getDate() === 1 &&
    endsAt.getMonth() === 11 &&
    endsAt.getDate() === 31
  )
}

/**
 * Return the once-per-season key for an automatic year recap.
 *
 * School years are offered from thirty days before their end until fourteen
 * days afterwards. December also gets a calendar recap for a year that is in
 * progress. Keeping the key semantic means the same school year can have a
 * December recap and a proper end-of-school-year recap without either one
 * suppressing the other.
 */
export function yearReviewWindowKey(
  now: Date,
  startsAt: Date,
  endsAt: Date
): string | null {
  const start = startsAt.getTime()
  const end = endsAt.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null
  }

  const schoolWindowStart = end - 30 * DAY_IN_MS
  const schoolWindowEnd = end + 15 * DAY_IN_MS - 1
  const current = now.getTime()

  if (current >= schoolWindowStart && current <= schoolWindowEnd) {
    return `school-${endsAt.getFullYear()}`
  }

  if (
    now.getMonth() === 11 &&
    (isCalendarYear(startsAt, endsAt) || (current >= start && current <= end))
  ) {
    return `calendar-${now.getFullYear()}`
  }

  return null
}
