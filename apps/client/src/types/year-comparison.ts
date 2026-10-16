export type YearComparisonScope = "same-progress" | "full-period";

/** Keys belong to the displayed year; values belong to the reference year. */
export type YearComparisonMap = Record<string, string | null>;

export type YearComparisonMappings = {
  subjectMap: YearComparisonMap;
  periodMap: YearComparisonMap;
};

export type YearComparison = YearComparisonMappings & {
  yearId: string;
  referenceYearId: string;
  updatedAt: string;
};

export type YearComparisonPreference = {
  enabled: boolean;
  referenceYearId: string | null;
  scope: YearComparisonScope;
};

export type YearComparisonSeriesPoint = {
  date: string;
  referenceDate: string;
  /** Normalized score out of 20, preserving zero and missing values. */
  value: number | null;
};
