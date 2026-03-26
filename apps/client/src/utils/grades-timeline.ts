import { Period } from "@/types/period";
import { PartialGrade } from "@/types/grade";
import { Subject } from "@/types/subject";
import { Year } from "@/types/year";
import { endOfDay, isAfter, startOfDay } from "date-fns";

export function countSubjectGrades(subjects: Subject[]): number {
  return subjects.reduce((total, subject) => total + subject.grades.length, 0);
}

export function filterSubjectsBySnapshotDate(
  subjects: Subject[],
  snapshotDate?: Date
): Subject[] {
  if (!snapshotDate) {
    return subjects;
  }

  const snapshotTime = snapshotDate.getTime();

  return subjects.map((subject) => ({
    ...subject,
    grades: filterGradesBySnapshotDate(subject.grades, snapshotDate),
  }));
}

export function filterGradesBySnapshotDate<T extends PartialGrade>(
  grades: T[],
  snapshotDate?: Date
): T[] {
  if (!snapshotDate) {
    return grades;
  }

  const snapshotTime = snapshotDate.getTime();

  return grades.filter((grade) => {
    const gradeTime = new Date(grade.passedAt).getTime();
    return !Number.isNaN(gradeTime) && gradeTime <= snapshotTime;
  });
}

export function isGradeVisibleAtSnapshot(
  grade: Pick<PartialGrade, "passedAt">,
  snapshotDate?: Date
) {
  if (!snapshotDate) {
    return true;
  }

  const gradeTime = new Date(grade.passedAt).getTime();
  return !Number.isNaN(gradeTime) && gradeTime <= snapshotDate.getTime();
}

export function clampDateToRange(date: Date, minDate: Date, maxDate: Date): Date {
  if (date.getTime() < minDate.getTime()) {
    return minDate;
  }

  if (date.getTime() > maxDate.getTime()) {
    return maxDate;
  }

  return date;
}

export function getGradesTimelineBounds({
  year,
  selectedTab,
  periods,
  now = new Date(),
}: {
  year: Year;
  selectedTab: string;
  periods: Period[];
  now?: Date;
}) {
  const sortedPeriods = [...periods].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );

  const minDate = startOfDay(
    selectedTab === "full-year"
      ? new Date(year.startDate)
      : getSelectedPeriodStartDate(selectedTab, sortedPeriods) ??
          new Date(year.startDate)
  );

  const rawMaxDate =
    selectedTab === "full-year"
      ? new Date(year.endDate)
      : getSelectedPeriodEndDate(selectedTab, sortedPeriods) ??
        new Date(year.endDate);

  const cappedMaxDate = isAfter(rawMaxDate, now) ? now : rawMaxDate;
  const maxDate = endOfDay(cappedMaxDate);

  return {
    minDate,
    maxDate: maxDate.getTime() < minDate.getTime() ? endOfDay(minDate) : maxDate,
  };
}

function getSelectedPeriodStartDate(
  selectedTab: string,
  periods: Period[]
): Date | null {
  const periodIndex = periods.findIndex((period) => period.id === selectedTab);

  if (periodIndex === -1) {
    return null;
  }

  const selectedPeriod = periods[periodIndex];

  if (!selectedPeriod.isCumulative) {
    return new Date(selectedPeriod.startAt);
  }

  return new Date(periods[0].startAt);
}

function getSelectedPeriodEndDate(
  selectedTab: string,
  periods: Period[]
): Date | null {
  const selectedPeriod = periods.find((period) => period.id === selectedTab);
  return selectedPeriod ? new Date(selectedPeriod.endAt) : null;
}
