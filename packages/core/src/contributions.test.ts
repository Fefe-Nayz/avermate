import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import type { Grade, Subject } from "./types";
import {
  CONTRIBUTION_TOLERANCE,
  contributionBreakdown,
  RESIDUAL_KEY,
} from "./contributions";

let counter = 0;
function grade(subjectId: string, value: number, coefficient = 1): Grade {
  counter += 1;
  return {
    id: `g${counter}`,
    name: `g${counter}`,
    value,
    outOf: 20,
    coefficient,
    passedAt: new Date(2026, 0, 1),
    createdAt: new Date(2026, 0, 1),
    subjectId,
    periodId: null,
    components: [],
  };
}

function subject(
  id: string,
  coefficient: number,
  grades: Grade[],
  parentId: string | null = null,
  kind: Subject["kind"] = "subject",
): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId,
    coefficient,
    kind,
    isMain: true,
    sortOrder: 0,
    grades,
  };
}

/**
 * A waterfall is only worth drawing if the steps add up to the change. These tests
 * are the invariant, not a sample: every case here checks that the decomposition is
 * *exact*, including the cases where the naive "weight × change in mark" formula is
 * not — a subject entering, leaving, or changing coefficient.
 */
describe("contribution breakdown", () => {
  const total = (steps: Array<{ delta: number }>) =>
    steps.reduce((sum, step) => sum + step.delta, 0);

  test("adds up when only the marks moved", () => {
    const before = new SubjectGraph([
      subject("maths", 3, [grade("maths", 10)]),
      subject("art", 1, [grade("art", 12)]),
    ]);
    const after = new SubjectGraph([
      subject("maths", 3, [grade("maths", 14)]),
      subject("art", 1, [grade("art", 12)]),
    ]);

    const result = contributionBreakdown(before, after);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(total(result.steps)).toBeCloseTo(
      result.endValue - result.startValue,
      12,
    );
    // Three quarters of a four-coefficient year: 4/20 of movement in Maths is 0.15.
    const maths = result.steps.find((step) => step.key === "maths");
    expect(maths?.delta).toBeCloseTo(0.15, 12);
    expect(maths?.weightEffect).toBeCloseTo(0, 12);
    // Nothing left over, so no residual step at all.
    expect(result.steps.some((step) => step.role === "residual")).toBe(false);
  });

  test("adds up when a coefficient changed too", () => {
    const before = new SubjectGraph([
      subject("maths", 1, [grade("maths", 10)]),
      subject("art", 1, [grade("art", 20)]),
    ]);
    // Maths trebles in weight and improves at the same time: the naive formula
    // misses by the cross term, and this must not.
    const after = new SubjectGraph([
      subject("maths", 3, [grade("maths", 14)]),
      subject("art", 1, [grade("art", 20)]),
    ]);

    const result = contributionBreakdown(before, after);
    if (!result) throw new Error("expected a breakdown");

    expect(total(result.steps)).toBeCloseTo(
      result.endValue - result.startValue,
      12,
    );
    const maths = result.steps.find((step) => step.key === "maths");
    // Both effects are real and neither is the whole story.
    expect(maths?.markEffect).not.toBeCloseTo(0, 6);
    expect(maths?.weightEffect).not.toBeCloseTo(0, 6);
    expect(maths?.delta).toBeCloseTo(
      (maths?.markEffect ?? 0) + (maths?.weightEffect ?? 0),
      12,
    );
  });

  test("adds up when a subject arrives", () => {
    const before = new SubjectGraph([
      subject("maths", 1, [grade("maths", 10)]),
      // In the tree, but with no marks: not in the average at all.
      subject("art", 1, []),
    ]);
    const after = new SubjectGraph([
      subject("maths", 1, [grade("maths", 10)]),
      subject("art", 1, [grade("art", 20)]),
    ]);

    const result = contributionBreakdown(before, after);
    if (!result) throw new Error("expected a breakdown");

    expect(result.startValue).toBeCloseTo(0.5, 12);
    expect(result.endValue).toBeCloseTo(0.75, 12);
    expect(total(result.steps)).toBeCloseTo(0.25, 12);

    const art = result.steps.find((step) => step.key === "art");
    // Its whole effect is the weight one: it entered the average. Its mark did not
    // "improve from zero" — nobody sat a zero.
    expect(art?.markEffect).toBeCloseTo(0, 12);
    expect(art?.weightBefore).toBeCloseTo(0, 12);
    expect(art?.averageBefore).toBeNull();
    expect(art?.averageAfter).toBeCloseTo(1, 12);
  });

  test("adds up when a subject leaves", () => {
    const before = new SubjectGraph([
      subject("maths", 1, [grade("maths", 10)]),
      subject("art", 1, [grade("art", 20)]),
    ]);
    const after = new SubjectGraph([
      subject("maths", 1, [grade("maths", 10)]),
      subject("art", 1, []),
    ]);

    const result = contributionBreakdown(before, after);
    if (!result) throw new Error("expected a breakdown");

    expect(total(result.steps)).toBeCloseTo(
      result.endValue - result.startValue,
      12,
    );
    const art = result.steps.find((step) => step.key === "art");
    expect(art?.averageAfter).toBeNull();
    expect(art?.weightAfter).toBeCloseTo(0, 12);
  });

  test("adds up through a dissolved category", () => {
    // A category weighs nothing of its own here — its children compete above it — so
    // the contributors are the two subjects and the decomposition is over them.
    const before = new SubjectGraph([
      subject("sciences", 4, [], null, "category"),
      subject("maths", 1, [grade("maths", 10)], "sciences"),
      subject("physique", 3, [grade("physique", 12)], "sciences"),
    ]);
    const after = new SubjectGraph([
      subject("sciences", 4, [], null, "category"),
      subject("maths", 1, [grade("maths", 16)], "sciences"),
      subject("physique", 3, [grade("physique", 12)], "sciences"),
    ]);

    const result = contributionBreakdown(before, after);
    if (!result) throw new Error("expected a breakdown");

    expect(result.steps.map((step) => step.key).sort()).toEqual([
      "maths",
      "physique",
    ]);
    expect(total(result.steps)).toBeCloseTo(
      result.endValue - result.startValue,
      12,
    );
  });

  test("chains the steps from the start to the end", () => {
    const before = new SubjectGraph([
      subject("maths", 1, [grade("maths", 8)]),
      subject("art", 1, [grade("art", 12)]),
      subject("sport", 1, [grade("sport", 16)]),
    ]);
    const after = new SubjectGraph([
      subject("maths", 1, [grade("maths", 12)]),
      subject("art", 1, [grade("art", 10)]),
      subject("sport", 1, [grade("sport", 18)]),
    ]);

    const result = contributionBreakdown(before, after);
    if (!result) throw new Error("expected a breakdown");

    // Each step begins where the last ended, and the last lands on the end value.
    let cursor = result.startValue;
    for (const step of result.steps) {
      expect(step.start).toBeCloseTo(cursor, 12);
      expect(step.end).toBeCloseTo(step.start + step.delta, 12);
      cursor = step.end;
    }
    expect(cursor).toBeCloseTo(result.endValue, 12);
  });

  test("orders by the size of the effect, biggest first", () => {
    const before = new SubjectGraph([
      subject("maths", 1, [grade("maths", 10)]),
      subject("art", 1, [grade("art", 10)]),
    ]);
    const after = new SubjectGraph([
      subject("maths", 1, [grade("maths", 11)]),
      subject("art", 1, [grade("art", 16)]),
    ]);

    const result = contributionBreakdown(before, after);
    if (!result) throw new Error("expected a breakdown");

    expect(result.steps[0]?.key).toBe("art");
    expect(result.steps.map((step) => step.role)).toEqual([
      "increase",
      "increase",
    ]);
  });

  test("says so rather than adjusting, when something is unexplained", () => {
    // Nothing here should produce a residual — the decomposition is exact — so this
    // pins the tolerance itself: every case above must come in under it.
    const before = new SubjectGraph([
      subject("maths", 2, [grade("maths", 9), grade("maths", 13, 3)]),
      subject("art", 1, [grade("art", 15)]),
      subject("sport", 5, []),
    ]);
    const after = new SubjectGraph([
      subject("maths", 2, [grade("maths", 9), grade("maths", 13, 3)]),
      subject("art", 3, [grade("art", 15), grade("art", 7)]),
      subject("sport", 5, [grade("sport", 18)]),
    ]);

    const result = contributionBreakdown(before, after);
    if (!result) throw new Error("expected a breakdown");

    const residual = result.steps.find((step) => step.key === RESIDUAL_KEY);
    expect(residual).toBeUndefined();
    expect(
      Math.abs(total(result.steps) - (result.endValue - result.startValue)),
    ).toBeLessThan(CONTRIBUTION_TOLERANCE);
  });

  test("has nothing to say without an average at both ends", () => {
    const empty = new SubjectGraph([subject("maths", 1, [])]);
    const marked = new SubjectGraph([
      subject("maths", 1, [grade("maths", 10)]),
    ]);

    expect(contributionBreakdown(empty, marked)).toBeNull();
    expect(contributionBreakdown(marked, empty)).toBeNull();
  });
});
