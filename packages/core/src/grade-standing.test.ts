import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import { gradeNeighbours, gradeStanding, gradeWeightShare } from "./analytics";
import type { Grade, Subject } from "./types";

function grade(
  id: string,
  subjectId: string,
  value: number,
  options: { outOf?: number; coefficient?: number; day?: number } = {},
): Grade {
  const passedAt = new Date(2026, 0, options.day ?? 1);
  return {
    id,
    name: id,
    value,
    outOf: options.outOf ?? 20,
    coefficient: options.coefficient ?? 1,
    passedAt,
    createdAt: passedAt,
    subjectId,
    periodId: null,
    components: [],
  };
}

function subject(
  id: string,
  grades: Grade[],
  parentId: string | null = null,
): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId,
    coefficient: 1,
    kind: "subject",
    isMain: false,
    sortOrder: 0,
    grades,
  };
}

/**
 * What a single grade means, beyond its own number.
 *
 * A mark on its own says almost nothing — 14 is a triumph in one class and a
 * disappointment in another — so the grade screen has to answer "compared to
 * what". These are the three answers that need no interpretation: where it
 * stands, how much of the subject it decides, and what came before and after.
 */
describe("gradeStanding", () => {
  const maths = subject("maths", [
    grade("a", "maths", 8),
    grade("b", "maths", 14),
    grade("c", "maths", 17),
  ]);
  const history = subject("history", [grade("d", "history", 19)]);
  const graph = new SubjectGraph([maths, history]);

  test("counts from the best", () => {
    expect(gradeStanding(graph, "c", "maths")).toEqual({ rank: 1, total: 3 });
    expect(gradeStanding(graph, "b", "maths")).toEqual({ rank: 2, total: 3 });
    expect(gradeStanding(graph, "a", "maths")).toEqual({ rank: 3, total: 3 });
  });

  test("ranks against every grade when no subject is named", () => {
    // 19 in history now sits above the 17, which is the whole point of showing
    // both fields: a subject's best is not the year's best.
    expect(gradeStanding(graph, "c")).toEqual({ rank: 2, total: 4 });
    expect(gradeStanding(graph, "d")).toEqual({ rank: 1, total: 4 });
  });

  test("includes a subject's descendants, as every other reading here does", () => {
    const parent = subject("science", [grade("p", "science", 10)]);
    const child = subject(
      "chemistry",
      [grade("k", "chemistry", 20)],
      "science",
    );
    const tree = new SubjectGraph([parent, child]);

    expect(gradeStanding(tree, "k", "science")).toEqual({ rank: 1, total: 2 });
  });

  test("has nothing to say about a grade that is not there", () => {
    expect(gradeStanding(graph, "absent", "maths")).toBeNull();
  });
});

describe("gradeWeightShare", () => {
  test("reads the stored coefficient against the rest of the subject", () => {
    // "weight 2" is meaningless on its own; two thirds is not.
    const graph = new SubjectGraph([
      subject("maths", [
        grade("a", "maths", 12, { coefficient: 2 }),
        grade("b", "maths", 15, { coefficient: 1 }),
      ]),
    ]);

    expect(gradeWeightShare(graph, "a")).toBeCloseTo(2 / 3, 10);
    expect(gradeWeightShare(graph, "b")).toBeCloseTo(1 / 3, 10);
  });

  test("is the whole subject when it is the only grade in it", () => {
    const graph = new SubjectGraph([
      subject("maths", [grade("a", "maths", 12, { coefficient: 3 })]),
    ]);

    expect(gradeWeightShare(graph, "a")).toBe(1);
  });

  test("leaves grades that do not count out of the total", () => {
    // A mark out of zero is ignored by every average, so letting it into the
    // denominator would quietly shrink every share in the subject.
    const graph = new SubjectGraph([
      subject("maths", [
        grade("a", "maths", 12),
        grade("void", "maths", 0, { outOf: 0 }),
      ]),
    ]);

    expect(gradeWeightShare(graph, "a")).toBe(1);
    expect(gradeWeightShare(graph, "void")).toBeNull();
  });

  test("stays inside the grade's own subject", () => {
    // A share of an ancestor's average is not a fraction of anything — the
    // hierarchy re-weights at every level. `gradeImpact` answers that question.
    const graph = new SubjectGraph([
      subject("science", [grade("p", "science", 10)]),
      subject("chemistry", [grade("k", "chemistry", 20)], "science"),
    ]);

    expect(gradeWeightShare(graph, "k")).toBe(1);
  });
});

describe("gradeNeighbours", () => {
  const graph = new SubjectGraph([
    subject("maths", [
      grade("first", "maths", 10, { day: 3 }),
      grade("middle", "maths", 12, { day: 10 }),
      grade("also-middle", "maths", 16, { day: 10 }),
      grade("last", "maths", 14, { day: 20 }),
    ]),
    subject("history", [grade("other", "history", 11, { day: 10 })]),
  ]);

  test("steps to another day, not to the next element", () => {
    // Two grades sat the same day are companions, not steps. Treating one as
    // "next" listed it twice on the same screen and made "next" mean whichever
    // of two simultaneous results sorted first.
    expect(gradeNeighbours(graph, "first").previous).toBeNull();
    expect(gradeNeighbours(graph, "first").next?.id).toBe("also-middle");
    expect(gradeNeighbours(graph, "middle").previous?.id).toBe("first");
    expect(gradeNeighbours(graph, "middle").next?.id).toBe("last");
    expect(gradeNeighbours(graph, "also-middle").previous?.id).toBe("first");
    expect(gradeNeighbours(graph, "also-middle").next?.id).toBe("last");
    expect(gradeNeighbours(graph, "last").next).toBeNull();
  });

  test("names the others sat the same day, and only in this subject", () => {
    const neighbours = gradeNeighbours(graph, "middle");

    expect(neighbours.sameDay.map((item) => item.id)).toEqual(["also-middle"]);
    // The history grade shares the day but not the class.
    expect(neighbours.sameDay.some((item) => item.id === "other")).toBe(false);
  });

  test("never names the same grade twice on one screen", () => {
    for (const id of ["first", "middle", "also-middle", "last"]) {
      const { previous, next, sameDay } = gradeNeighbours(graph, id);
      const named = [
        previous?.id,
        next?.id,
        ...sameDay.map((g) => g.id),
      ].filter((value): value is string => value !== undefined);
      expect(new Set(named).size, id).toBe(named.length);
      expect(named, id).not.toContain(id);
    }
  });

  test("has nothing to walk for a grade that is not there", () => {
    expect(gradeNeighbours(graph, "absent")).toEqual({
      previous: null,
      next: null,
      sameDay: [],
    });
  });
});
