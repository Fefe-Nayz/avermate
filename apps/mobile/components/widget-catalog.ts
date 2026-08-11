import {
  CARD_METRICS,
  allowedDisplays,
  type CardDisplay,
  type CardMetric,
} from "@avermate/core";

export type WidgetCategory =
  | "essentials"
  | "momentum"
  | "results"
  | "consistency"
  | "goals";

export interface WidgetCatalogEntry {
  metric: CardMetric;
  category: WidgetCategory;
  recommendedDisplay: CardDisplay;
  recommendedSpan: 1 | 2 | 4;
}

const CATEGORY_BY_METRIC: Record<CardMetric, WidgetCategory> = {
  average: "essentials",
  projection: "essentials",
  gradeCount: "essentials",
  lastGrade: "essentials",
  bestSubject: "essentials",
  worstSubject: "essentials",
  averageTrend: "momentum",
  improvement: "momentum",
  mostImproved: "momentum",
  activityStreak: "momentum",
  bestGrade: "results",
  worstGrade: "results",
  subjectRanking: "results",
  passRate: "results",
  median: "results",
  spread: "consistency",
  consistency: "consistency",
  steadiest: "consistency",
  passStreak: "consistency",
  distribution: "consistency",
  goalProgress: "goals",
};

function recommendedDisplay(metric: CardMetric): CardDisplay {
  if (metric === "average" || metric === "projection") return "sparkline";
  if (metric === "passRate" || metric === "consistency" || metric === "goalProgress") {
    return "gauge";
  }
  if (
    metric === "subjectRanking" ||
    metric === "mostImproved" ||
    metric === "steadiest"
  ) {
    return "list";
  }
  if (metric === "distribution") return "chart";
  return "value";
}

function recommendedSpan(metric: CardMetric): 1 | 2 | 4 {
  const display = recommendedDisplay(metric);
  if (display === "list" || display === "chart" || display === "sparkline") {
    return 2;
  }
  return 1;
}

export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = CARD_METRICS.map(
  (metric) => ({
    metric,
    category: CATEGORY_BY_METRIC[metric],
    recommendedDisplay: recommendedDisplay(metric),
    recommendedSpan: recommendedSpan(metric),
  }),
);

export function widgetCatalogEntry(metric: CardMetric): WidgetCatalogEntry {
  return WIDGET_CATALOG.find((entry) => entry.metric === metric) as WidgetCatalogEntry;
}

export function isRecommendedDisplayValid(entry: WidgetCatalogEntry): boolean {
  return allowedDisplays(entry.metric).includes(entry.recommendedDisplay);
}
