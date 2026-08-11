import type { Subject, Year } from "@avermate/core";

export const DAY_IN_MS = 86_400_000;

export function isoCalendarDay(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function calendarDayTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year as number, (month as number) - 1, day, 12);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== (month as number) - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

export function timelineCutoffTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = calendarDayTimestamp(value);
  if (timestamp === null) return null;
  const cutoff = new Date(timestamp);
  cutoff.setHours(23, 59, 59, 999);
  return cutoff.getTime();
}

export function timelineBounds(
  year: Pick<Year, "startsAt" | "endsAt">,
  now: number,
): { maximum: number; minimum: number; totalDays: number } {
  const minimum = new Date(year.startsAt).getTime();
  const maximum = Math.max(
    minimum,
    Math.min(now, new Date(year.endsAt).getTime()),
  );
  return {
    maximum,
    minimum,
    totalDays: Math.max(0, Math.round((maximum - minimum) / DAY_IN_MS)),
  };
}

export function clampTimelineDay(
  value: string | null,
  year: Pick<Year, "startsAt" | "endsAt"> | null,
  now: number,
): string | null {
  if (!value || !year) return null;
  const timestamp = calendarDayTimestamp(value);
  if (timestamp === null) return null;
  const { minimum, maximum } = timelineBounds(year, now);
  return isoCalendarDay(Math.min(maximum, Math.max(minimum, timestamp)));
}

export function dayAtOffset(
  year: Pick<Year, "startsAt" | "endsAt">,
  now: number,
  offset: number,
): string {
  const { minimum, maximum, totalDays } = timelineBounds(year, now);
  const day = Math.min(totalDays, Math.max(0, Math.round(offset)));
  return isoCalendarDay(Math.min(maximum, minimum + day * DAY_IN_MS));
}

export function offsetForTimelineDay(
  value: string,
  year: Pick<Year, "startsAt" | "endsAt">,
  now: number,
): number {
  const { minimum, totalDays } = timelineBounds(year, now);
  const timestamp = calendarDayTimestamp(value) ?? minimum;
  return Math.min(
    totalDays,
    Math.max(0, Math.round((timestamp - minimum) / DAY_IN_MS)),
  );
}

/** Clone the snapshot and remove only grades that did not yet exist. */
export function subjectsAtTimelineDay(
  subjects: readonly Subject[],
  value: string | null,
): Subject[] {
  if (!value) return [...subjects];
  const cutoff = timelineCutoffTimestamp(value);
  if (cutoff === null) return [...subjects];
  return subjects.map((subject) => ({
    ...subject,
    grades: subject.grades.filter(
      (grade) => grade.passedAt.getTime() <= cutoff,
    ),
  }));
}
