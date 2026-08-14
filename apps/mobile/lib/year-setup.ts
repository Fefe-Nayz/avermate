import { suggestSchoolYear, type SchoolYearSeed } from "@avermate/core";
import type { Href } from "expo-router";
import { t } from "./i18n";

export type PeriodTemplateChoice =
  "none" | "trimesters" | "semesters" | "semesters-cumulative" | "quarters";

export function initialYearSetupPlan(presetId: string | null): {
  completeAfterCreation: boolean;
  periodTemplate: "none";
} {
  return presetId
    ? { completeAfterCreation: true, periodTemplate: "none" }
    : { completeAfterCreation: false, periodTemplate: "none" };
}

export function periodNamesForTemplate(
  template: PeriodTemplateChoice,
): string[] {
  switch (template) {
    case "trimesters":
      return [t("Term 1"), t("Term 2"), t("Term 3")];
    case "semesters":
      return [t("Semester 1"), t("Semester 2")];
    case "semesters-cumulative":
      return [t("Semester 1"), t("Whole year")];
    case "quarters":
      return [t("Quarter 1"), t("Quarter 2"), t("Quarter 3"), t("Quarter 4")];
    default:
      return [];
  }
}

export function nativeSchoolYearSuggestion(
  now: Date,
  existingYears: readonly SchoolYearSeed[] = [],
) {
  const suggestion = suggestSchoolYear(now, existingYears);
  return {
    ...suggestion,
    // Noon avoids midnight falling on the other side of a DST transition
    // while DateField still receives a native Date.
    startsAt: new Date(`${suggestion.startDay}T12:00:00`),
    endsAt: new Date(`${suggestion.endDay}T12:00:00`),
  };
}

export function isValidYearSetup(
  name: string,
  startsAt: Date,
  endsAt: Date,
  scale: string,
): boolean {
  const numericScale = Number(scale);
  return (
    name.trim().length > 0 &&
    endsAt > startsAt &&
    Number.isFinite(numericScale) &&
    numericScale > 0 &&
    numericScale <= 1000
  );
}

export interface NativePeriodDraft {
  localId: string;
  periodId?: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isCumulative: boolean;
}

const PERIOD_FRACTIONS: Record<
  PeriodTemplateChoice,
  Array<{ from: number; to: number; isCumulative?: boolean }>
> = {
  trimesters: [
    { from: 0, to: 1 / 3 },
    { from: 1 / 3, to: 2 / 3 },
    { from: 2 / 3, to: 1 },
  ],
  semesters: [
    { from: 0, to: 0.5 },
    { from: 0.5, to: 1 },
  ],
  "semesters-cumulative": [
    { from: 0, to: 0.5 },
    { from: 0.5, to: 1, isCumulative: true },
  ],
  quarters: [
    { from: 0, to: 0.25 },
    { from: 0.25, to: 0.5 },
    { from: 0.5, to: 0.75 },
    { from: 0.75, to: 1 },
  ],
  none: [],
};

/** Mirrors the server template fractions while keeping every date editable. */
export function periodDraftsForTemplate(
  template: PeriodTemplateChoice,
  startsAt: Date,
  endsAt: Date,
): NativePeriodDraft[] {
  const duration = endsAt.getTime() - startsAt.getTime();
  const names = periodNamesForTemplate(template);
  return PERIOD_FRACTIONS[template].map((period, index) => ({
    localId: `template-${template}-${index}`,
    name: names[index] ?? t("Period {number}", { number: index + 1 }),
    startsAt: new Date(
      startsAt.getTime() + duration * period.from,
    ).toISOString(),
    endsAt: new Date(startsAt.getTime() + duration * period.to).toISOString(),
    isCumulative: period.isCumulative ?? false,
  }));
}

export function validPeriodDrafts(
  periods: readonly Pick<NativePeriodDraft, "name" | "startsAt" | "endsAt">[],
  year?: { startsAt: Date; endsAt: Date },
): boolean {
  const yearStartsAt = year?.startsAt.getTime() ?? Number.NEGATIVE_INFINITY;
  const yearEndsAt = year?.endsAt.getTime() ?? Number.POSITIVE_INFINITY;
  let previousEnd = Number.NEGATIVE_INFINITY;
  return periods.every((period) => {
    const startsAt = new Date(period.startsAt).getTime();
    const endsAt = new Date(period.endsAt).getTime();
    const valid =
      period.name.trim().length > 0 &&
      Number.isFinite(startsAt) &&
      Number.isFinite(endsAt) &&
      endsAt > startsAt &&
      startsAt >= yearStartsAt &&
      endsAt <= yearEndsAt &&
      startsAt >= previousEnd;
    previousEnd = endsAt;
    return valid;
  });
}

/** One canonical typed destination for new, resumed and manually reopened setup. */
export function yearSetupHref(yearId: string): Href {
  return `/year/${encodeURIComponent(yearId)}/setup` as Href;
}
