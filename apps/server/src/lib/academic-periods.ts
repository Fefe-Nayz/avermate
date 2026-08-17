import { badRequest } from "./orpc";

export interface AcademicRange {
  startsAt: Date;
  endsAt: Date;
}

export interface AcademicPeriodRange {
  name: string;
  startAt: Date;
  endAt: Date;
  isCumulative: boolean;
}

/**
 * Periods are views over an academic year, not partitions of it. Overlap is
 * intentionally allowed: cumulative views overlap regular terms and users may
 * also model exam/revision windows. Readers resolve an ambiguous date by
 * preferring a non-cumulative period, then the persisted `sortOrder`.
 */
export const PERIOD_OVERLAP_POLICY = "ordered-views" as const;

/**
 * The calendar day a timestamp falls on, as a comparable number.
 *
 * Containment is a question about *days*, and comparing instants answered a different
 * one. A period is described by two dates and the forms turn them into a span across
 * them — midnight to `23:59:59` — while a year's bounds are stored however the screen
 * that created them chose: the year settings page saves its end at `23:59:59` and the
 * class-creation flow saves the same field at midnight. So a period ending on the last
 * day of a year created through the second one overran it by 23 hours 59, and the year
 * refused a period that ended exactly when it did.
 *
 * That is what "often" meant in the report: not a wrong operator — the bounds were
 * always meant to be inclusive and the comparison reads that way — but a time of day
 * smuggled into a date comparison. Both sides collapse to their day here, so the first
 * and last days of a year belong to it whatever hour anything was stored at.
 */
export function periodDayOf(value: Date): number {
  return Math.floor(value.getTime() / 86_400_000);
}

export function assertPeriodRangesWithinYear(
  year: AcademicRange,
  periodRanges: readonly AcademicPeriodRange[],
): void {
  const yearStartDay = periodDayOf(year.startsAt);
  const yearEndDay = periodDayOf(year.endsAt);

  for (const period of periodRanges) {
    if (period.endAt.getTime() <= period.startAt.getTime()) {
      // Instants, deliberately: "ends after it starts" is about the span itself, and a
      // period inside one day is a legitimate thing to describe.
      badRequest(`"${period.name}" must end after it starts`);
    }
    if (
      periodDayOf(period.startAt) < yearStartDay ||
      periodDayOf(period.endAt) > yearEndDay
    ) {
      badRequest(`"${period.name}" must stay within the academic year`);
    }
  }
}
