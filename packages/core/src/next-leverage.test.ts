import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import { leverageOf, nextAssessmentLeverage } from "./goals";
import type { Grade, Subject } from "./types";

/**
 * The leverage of the *next* mark, which is not the leverage of a subject.
 *
 * The distinction the metric list has insisted on in prose since the weight cards were
 * written, and which nothing computed: a subject's share answers "where does my average
 * come from", and this answers "which of these is worth preparing for". They disagree
 * exactly where it matters — two subjects of equal weight, one graded once and one graded
 * a dozen times, are not the same opportunity.
 */

function grade(id: string, subjectId: string, value: number): Grade {
  const at = new Date("2026-01-10T12:00:00");
  return {
    id,
    name: id,
    value,
    outOf: 20,
    coefficient: 1,
    passedAt: at,
    createdAt: at,
    subjectId,
    periodId: null,
    note: null,
    components: [],
  };
}

function subject(id: string, grades: Grade[]): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: true,
    sortOrder: 0,
    grades,
  };
}

describe("the leverage of the next mark", () => {
  const busy = Array.from({ length: 11 }, (_, index) =>
    grade(`b${index}`, "busy", 12),
  );
  const graph = new SubjectGraph([
    subject("busy", busy),
    subject("quiet", [grade("q1", "quiet", 12)]),
  ]);

  test("is smaller in a subject that has already been graded a lot", () => {
    const quiet = nextAssessmentLeverage(graph, null, "quiet");
    const heavy = nextAssessmentLeverage(graph, null, "busy");

    expect(quiet).toBeGreaterThan(heavy);
    // Two marks against twelve: the next result in `quiet` carries a half of that
    // subject's weight and the next in `busy` carries a twelfth.
    expect(quiet / heavy).toBeCloseTo(6, 6);
  });

  test("is not the subject's own share, which the two subjects share equally", () => {
    // Equal coefficients, so `leverageOf` reports them as equally weighty — correctly, and
    // uselessly for the question "what should I revise".
    expect(leverageOf(graph, null, "busy")).toBeCloseTo(
      leverageOf(graph, null, "quiet"),
      10,
    );
    expect(nextAssessmentLeverage(graph, null, "busy")).not.toBeCloseTo(
      nextAssessmentLeverage(graph, null, "quiet"),
      3,
    );
  });

  test("works out to the share diluted by what is already graded", () => {
    /**
     * `(Wᵢ / ΣW) × (c / (Cᵢ + c))`, checked against the measurement.
     *
     * The formula is what the number *means*; planting a hypothetical result is how it is
     * computed, because that goes through the same weighting the average itself uses. If
     * the two ever disagreed, the formula would be the one that was wrong.
     */
    const share = leverageOf(graph, null, "quiet");
    const already = 1;
    const coefficient = 1;

    expect(nextAssessmentLeverage(graph, null, "quiet", coefficient)).toBeCloseTo(
      share * (coefficient / (already + coefficient)),
      6,
    );
  });

  test("grows with the coefficient of the mark to come", () => {
    const single = nextAssessmentLeverage(graph, null, "quiet", 1);
    const double = nextAssessmentLeverage(graph, null, "quiet", 2);

    expect(double).toBeGreaterThan(single);
    // Coefficient two against one existing mark: two thirds of the subject's weight.
    expect(double).toBeCloseTo(leverageOf(graph, null, "quiet") * (2 / 3), 6);
  });

  test("says nothing where there is nothing to move", () => {
    const empty = new SubjectGraph([]);

    expect(nextAssessmentLeverage(empty, null, "nobody")).toBe(0);
  });

  test("never reports a negative opportunity", () => {
    // A mark can only add weight, so the average cannot move down as marks go up. Clamped
    // rather than trusted: a floating-point negative would render as "−0.0%".
    for (const id of ["busy", "quiet"]) {
      expect(nextAssessmentLeverage(graph, null, id)).toBeGreaterThanOrEqual(0);
    }
  });
});
