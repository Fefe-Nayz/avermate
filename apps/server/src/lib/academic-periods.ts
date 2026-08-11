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

export function assertPeriodRangesWithinYear(
  year: AcademicRange,
  periodRanges: readonly AcademicPeriodRange[],
): void {
  const yearStart = year.startsAt.getTime();
  const yearEnd = year.endsAt.getTime();

  for (const period of periodRanges) {
    const periodStart = period.startAt.getTime();
    const periodEnd = period.endAt.getTime();
    if (periodEnd <= periodStart) {
      badRequest(`"${period.name}" must end after it starts`);
    }
    if (periodStart < yearStart || periodEnd > yearEnd) {
      badRequest(`"${period.name}" must stay within the academic year`);
    }
  }
}
