export type AwardType =
    | "tourist"
    | "tightrope"
    | "comeback"
    | "allin"
    | "masterclass"
    | "unpredictable"
    | "precision"
    | "legend"
    | "avermatien";

export type Award = {
    title: string;
    icon: string;
    description: string;
    condition: string;
    color: string;
    bg: string;
    gradient: string;
};

export type YearReviewStats = {
    gradesCount: number;
    gradesSum: number;
    heatmap: Record<string, number>;
    mostActiveMonth: { month: string; count: number };
    longestStreak: number;
    primeTime: { date: string; value: number };
    bestSubjects: { name: string; value: number }[];
    bestProgression: { subject: string; value: number };
    topPercentile: number;
    average: number;
    awardType: AwardType;
};

export type YearReviewResponse = {
    hasData: boolean;
    stats?: YearReviewStats;
};
