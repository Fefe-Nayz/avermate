export type DashboardCardId =
  | "general-average"
  | "main-custom-averages"
  | "selected-custom-average"
  | "target-average"
  | "average-evolution"
  | "best-grade"
  | "latest-grade"
  | "grades-count"
  | "subjects-count"
  | "best-subject"
  | "worst-grade"
  | "worst-subject"
  | "subject-average"
  | "median-grade"
  | "grade-standard-deviation"
  | "average-trend"
  | "progression-streak"
  | "future-projection"
  | "threshold-count";

export type DashboardCardTone =
  | "default"
  | "blue"
  | "green"
  | "amber"
  | "rose";

export type DashboardCardLayoutItem = {
  id: DashboardCardId;
  enabled: boolean;
  position: number;
  config: {
    title?: string;
    compact?: boolean;
    tone?: DashboardCardTone;
    targetAverage?: number;
    customAverageId?: string;
    showSubjectName?: boolean;
    maxItems?: number;
    subjectId?: string;
    threshold?: number;
    comparator?: "above" | "below";
    projectionSteps?: number;
    decimalPlaces?: number;
    showProgress?: boolean;
  };
};

export type CardLayoutResponse = {
  layout: {
    id: string;
    page: "dashboard";
    cards: DashboardCardLayoutItem[];
    createdAt: string;
    updatedAt: string;
    userId: string;
  } | null;
};
