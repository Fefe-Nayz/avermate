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
};

export type YearReviewResponse = {
    hasData: boolean;
    stats?: YearReviewStats;
};
