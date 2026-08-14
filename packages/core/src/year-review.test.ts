import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { Grade, Subject, Year } from "./types";
import { buildYearReview, decimateYearReviewSeries } from "./year-review";

function grade(id: string, value: number, passedAt: Date): Grade {
  return {
    id,
    name: id,
    value,
    outOf: 20,
    coefficient: 1,
    passedAt,
    createdAt: passedAt,
    subjectId: "math",
    periodId: null,
    components: [],
  };
}

const year: Year = {
  id: "year",
  name: "2025-2026",
  startsAt: new Date(2025, 8, 1),
  endsAt: new Date(2026, 5, 30),
  scale: 20,
  defaultOutOf: 20,
  passingRatio: 0.5,
  decimals: 2,
};

describe("year review average series", () => {
  it("uses the user's real running average and identifies its real peak", () => {
    const subjects: Subject[] = [
      {
        id: "math",
        name: "Mathematics",
        shortName: "Math",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [
          grade("first", 10, new Date(2025, 8, 2, 10)),
          grade("peak", 20, new Date(2025, 8, 10, 10)),
          grade("last", 0, new Date(2025, 8, 20, 10)),
        ],
      },
    ];

    const review = buildYearReview(subjects, year, 12, year.endsAt);

    assert.deepEqual(
      review.averageSeries.map((point) => point.ratio),
      [0.5, 0.75, 0.5],
    );
    assert.equal(review.primeTime?.ratio, 0.75);
    assert.equal(review.primeTime?.date.getDate(), 10);
    assert.equal(review.ratioSum, 1.5);
  });

  it("applies the school-year window once to every recap metric", () => {
    const subjects: Subject[] = [
      {
        id: "math",
        name: "Mathematics",
        shortName: "Math",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [
          grade("before", 20, new Date(2025, 7, 31, 12)),
          grade("inside-a", 10, new Date(2025, 8, 2, 12)),
          grade("inside-b", 14, new Date(2025, 8, 10, 12)),
          grade("future", 20, new Date(2025, 9, 1, 12)),
        ],
      },
    ];

    const review = buildYearReview(
      subjects,
      year,
      12,
      new Date(2025, 8, 30, 23, 59),
    );

    assert.equal(review.gradeCount, 2);
    assert.equal(review.ratioSum, 1.2);
    assert.deepEqual(review.heatmap, {
      "2025-09-02": 1,
      "2025-09-10": 1,
    });
    assert.equal(review.firstGradeAt?.getDate(), 2);
    assert.equal(review.lastGradeAt?.getDate(), 10);
    assert.equal(review.averageSeries.length, 2);
  });

  it("includes the morning of a school year whose native start is at noon", () => {
    const noonBoundaries = {
      startsAt: new Date(2025, 8, 1, 12),
      endsAt: new Date(2026, 5, 30, 12),
    };
    const subjects: Subject[] = [
      {
        id: "math",
        name: "Mathematics",
        shortName: "Math",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [
          grade("previous-day", 20, new Date(2025, 7, 31, 23, 59)),
          grade("first-day-morning", 12, new Date(2025, 8, 1, 8)),
        ],
      },
    ];

    const review = buildYearReview(
      subjects,
      noonBoundaries,
      12,
      new Date(2026, 6, 1, 12),
    );

    assert.equal(review.gradeCount, 1);
    assert.equal(
      review.firstGradeAt?.getTime(),
      new Date(2025, 8, 1, 8).getTime(),
    );
    assert.deepEqual(review.heatmap, { "2025-09-01": 1 });
  });

  it("includes the afternoon of a school year whose native end is at noon", () => {
    const noonBoundaries = {
      startsAt: new Date(2025, 8, 1, 12),
      endsAt: new Date(2026, 5, 30, 12),
    };
    const subjects: Subject[] = [
      {
        id: "math",
        name: "Mathematics",
        shortName: "Math",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [
          grade("last-day-afternoon", 16, new Date(2026, 5, 30, 18)),
          grade("next-day", 20, new Date(2026, 6, 1, 0, 1)),
        ],
      },
    ];

    const review = buildYearReview(
      subjects,
      noonBoundaries,
      12,
      new Date(2026, 6, 1, 12),
    );

    assert.equal(review.gradeCount, 1);
    assert.equal(
      review.lastGradeAt?.getTime(),
      new Date(2026, 5, 30, 18).getTime(),
    );
    assert.deepEqual(review.heatmap, { "2026-06-30": 1 });
  });

  it("keeps the main recap's improving-average streak semantics", () => {
    const subjects: Subject[] = [
      {
        id: "math",
        name: "Mathematics",
        shortName: "Math",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [
          grade("one", 10, new Date(2025, 8, 1, 12)),
          grade("two", 12, new Date(2025, 8, 2, 12)),
          grade("three", 14, new Date(2025, 8, 3, 12)),
          grade("down", 0, new Date(2025, 8, 4, 12)),
          grade("up", 20, new Date(2025, 8, 5, 12)),
        ],
      },
    ];

    const review = buildYearReview(subjects, year, 12, year.endsAt);
    assert.equal(review.longestStreak, 3);
  });

  it("keeps the main recap's first-grade-to-final comeback semantics", () => {
    const subjects: Subject[] = [
      {
        id: "math",
        name: "Mathematics",
        shortName: "Math",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [4, 16, 16, 16].map((value, index) =>
          grade(`math-${index}`, value, new Date(2025, 8, index + 1, 12)),
        ),
      },
      {
        id: "physics",
        name: "Physics",
        shortName: "Physics",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 1,
        grades: [8, 8, 18, 18].map((value, index) => ({
          ...grade(`physics-${index}`, value, new Date(2025, 8, index + 1, 13)),
          subjectId: "physics",
        })),
      },
    ];

    const review = buildYearReview(subjects, year, 12, year.endsAt);

    assert.equal(review.bestProgression?.subjectId, "math");
    assert.ok(Math.abs((review.bestProgression?.delta ?? 0) - 0.45) < 1e-10);
  });

  it("uses local calendar keys across a daylight-saving boundary", () => {
    const springSunday = new Date(2026, 2, 29, 0, 30);
    const subjects: Subject[] = [
      {
        id: "math",
        name: "Mathematics",
        shortName: "Math",
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [grade("dst", 15, springSunday)],
      },
    ];

    const review = buildYearReview(subjects, year, 12, year.endsAt);
    assert.equal(review.heatmap["2026-03-29"], 1);
  });

  it("bounds chart payload while preserving the first, last and peak points", () => {
    const points = Array.from({ length: 100 }, (_, index) => ({
      date: new Date(2026, 0, index + 1),
      ratio: index === 63 ? 1 : index / 200,
    }));

    const reduced = decimateYearReviewSeries(points, 10);

    assert.equal(reduced.length, 10);
    assert.equal(reduced[0], points[0]);
    assert.equal(reduced.at(-1), points.at(-1));
    assert.ok(reduced.includes(points[63] as (typeof points)[number]));
    assert.ok(
      reduced.every(
        (point, index) =>
          index === 0 ||
          point.date.getTime() > (reduced[index - 1]?.date.getTime() ?? 0),
      ),
    );
  });
});
