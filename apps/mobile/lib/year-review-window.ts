const DAY_IN_MS = 24 * 60 * 60 * 1000;

function isCalendarYear(startsAt: Date, endsAt: Date): boolean {
  return (
    startsAt.getFullYear() === endsAt.getFullYear() &&
    startsAt.getMonth() === 0 &&
    startsAt.getDate() === 1 &&
    endsAt.getMonth() === 11 &&
    endsAt.getDate() === 31
  );
}

/** Semantic, once-per-season key shared with the web recap behavior. */
export function yearReviewWindowKey(
  now: Date,
  startsAt: Date,
  endsAt: Date,
): string | null {
  const start = startsAt.getTime();
  const end = endsAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  const current = now.getTime();
  if (current >= end - 30 * DAY_IN_MS && current < end + 15 * DAY_IN_MS) {
    return `school-${endsAt.getFullYear()}`;
  }
  if (
    now.getMonth() === 11 &&
    (isCalendarYear(startsAt, endsAt) || (current >= start && current <= end))
  ) {
    return `calendar-${now.getFullYear()}`;
  }
  return null;
}
