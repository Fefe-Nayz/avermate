export type SchoolYearDateInput = Date | number | string;

export interface SchoolYearSeed {
  startsAt: SchoolYearDateInput;
  endsAt: SchoolYearDateInput;
  scale?: number;
}

export interface SchoolYearSuggestion {
  name: string;
  startDay: string;
  endDay: string;
  scale: number;
}

function isoDay(value: SchoolYearDateInput): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
}

function addCalendarYear(day: string): string {
  const [sourceYear, month, sourceDay] = day.split("-").map(Number);
  const year = sourceYear + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = Math.min(sourceDay, lastDay);
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${date.toString().padStart(2, "0")}`;
}

function yearOf(day: string): number {
  return Number(day.slice(0, 4));
}

/**
 * Suggest the next school year from the newest existing one.
 *
 * Returning calendar days keeps the same result in Next.js and React Native:
 * neither a server timezone nor a DST boundary can silently move September 1.
 */
export function suggestSchoolYear(
  now: SchoolYearDateInput,
  existingYears: readonly SchoolYearSeed[] = [],
): SchoolYearSuggestion {
  const latest = existingYears
    .map((year) => ({
      year,
      startDay: isoDay(year.startsAt),
      endDay: isoDay(year.endsAt),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        year: SchoolYearSeed;
        startDay: string;
        endDay: string;
      } => Boolean(candidate.startDay && candidate.endDay),
    )
    .sort((left, right) => right.startDay.localeCompare(left.startDay))[0];

  if (latest) {
    const startDay = addCalendarYear(latest.startDay);
    const endDay = addCalendarYear(latest.endDay);
    const scale = latest.year.scale;
    return {
      name: `${yearOf(startDay)}–${yearOf(endDay)}`,
      startDay,
      endDay,
      scale:
        typeof scale === "number" &&
        Number.isFinite(scale) &&
        scale > 0 &&
        scale <= 1000
          ? scale
          : 20,
    };
  }

  const current = now instanceof Date ? now : new Date(now);
  const safeNow = Number.isFinite(current.getTime()) ? current : new Date(0);
  const currentYear = safeNow.getUTCFullYear();
  const startYear = safeNow.getUTCMonth() >= 7 ? currentYear : currentYear - 1;

  return {
    name: `${startYear}–${startYear + 1}`,
    startDay: `${startYear}-09-01`,
    endDay: `${startYear + 1}-07-15`,
    scale: 20,
  };
}
