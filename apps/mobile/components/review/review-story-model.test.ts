import { describe, expect, test } from "bun:test";
import type { YearReview } from "@avermate/core";
import { reviewStorySlides } from "./review-story-model";
import { yearReviewWindowKey } from "@/lib/year-review-window";

const base: YearReview = {
  gradeCount: 10,
  ratioSum: 8,
  average: 0.7,
  heatmap: {},
  busiestMonth: null,
  busiestWeekday: null,
  longestStreak: 2,
  averageSeries: [],
  primeTime: null,
  topSubjects: [],
  bestProgression: null,
  topPercentile: 0,
  award: "avermatien",
  firstGradeAt: null,
  lastGradeAt: null,
};

describe("native recap story model", () => {
  test("adds every rich conditional chapter deterministically", () => {
    const slides = reviewStorySlides({
      ...base,
      primeTime: { date: new Date(), ratio: 0.8 },
      topSubjects: [{ subjectId: "s", name: "Math", ratio: 0.9 }],
      bestProgression: { subjectId: "s", name: "Math", delta: 0.2 },
      topPercentile: 8,
    });
    expect(slides.map((slide) => slide.key)).toEqual([
      "intro",
      "headline",
      "heatmap",
      "streak",
      "prime",
      "subjects",
      "progression",
      "award",
      "percentile",
      "finale",
    ]);
  });

  test("uses school and December windows without overlapping keys", () => {
    expect(
      yearReviewWindowKey(
        new Date(2026, 5, 15),
        new Date(2025, 8, 1),
        new Date(2026, 5, 30),
      ),
    ).toBe("school-2026");
    expect(
      yearReviewWindowKey(
        new Date(2025, 11, 15),
        new Date(2025, 8, 1),
        new Date(2026, 5, 30),
      ),
    ).toBe("calendar-2025");
  });
});
