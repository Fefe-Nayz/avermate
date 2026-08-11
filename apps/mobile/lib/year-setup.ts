import { suggestSchoolYear, type SchoolYearSeed } from "@avermate/core";
import { t } from "./i18n";

export type PeriodTemplateChoice =
  "none" | "trimesters" | "semesters" | "semesters-cumulative" | "quarters";

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
