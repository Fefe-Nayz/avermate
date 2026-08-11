import type { YearReview } from "@avermate/core";

export type ReviewSlideKey =
  | "intro"
  | "headline"
  | "heatmap"
  | "streak"
  | "prime"
  | "subjects"
  | "progression"
  | "award"
  | "percentile"
  | "finale";

export interface ReviewStorySlide {
  duration: number;
  key: ReviewSlideKey;
}

/** Conditional slides stay deterministic so navigation and sharing agree. */
export function reviewStorySlides(review: YearReview): ReviewStorySlide[] {
  return [
    { key: "intro", duration: 5_200 },
    { key: "headline", duration: 5_800 },
    { key: "heatmap", duration: 6_200 },
    { key: "streak", duration: 5_400 },
    ...(review.primeTime ? [{ key: "prime" as const, duration: 5_800 }] : []),
    ...(review.topSubjects.length > 0
      ? [{ key: "subjects" as const, duration: 6_200 }]
      : []),
    ...(review.bestProgression
      ? [{ key: "progression" as const, duration: 5_600 }]
      : []),
    { key: "award", duration: 6_200 },
    ...(review.topPercentile > 0
      ? [{ key: "percentile" as const, duration: 5_600 }]
      : []),
    { key: "finale", duration: 8_000 },
  ];
}
