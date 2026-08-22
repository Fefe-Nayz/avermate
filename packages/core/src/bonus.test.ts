import { describe, expect, test } from "bun:test";
import {
  generalAverageSource,
  resolveCustomAverage,
  SubjectGraph,
  gradeRatio,
} from "./graph";
import type { CustomAverage, Grade, Subject } from "./types";

/**
 * Bonus points, and a general average that is somebody else's.
 *
 * Both live in the graph rather than at the places that read it: "what is my average" is
 * one question, asked from about thirty screens, and the answer must not depend on which
 * of them is asking. That is also what these tests are really about — a period filter, a
 * simulation and a custom average all derive new graphs, and each one has to carry the
 * year's arrangement with it.
 */

function grade(id: string, value: number, bonus?: number): Grade {
  const at = new Date(2026, 0, 10);
  return {
    id,
    name: id,
    value,
    outOf: 20,
    coefficient: 1,
    passedAt: at,
    createdAt: at,
    subjectId: id.split(":")[0] as string,
    periodId: null,
    ...(bonus === undefined ? {} : { bonus }),
    components: [],
  };
}

const subject = (id: string, grades: Grade[], bonus?: number): Subject => ({
  id,
  name: id,
  shortName: null,
  parentId: null,
  coefficient: 1,
  kind: "subject",
  isMain: true,
  sortOrder: 0,
  ...(bonus === undefined ? {} : { bonus }),
  grades,
});

const year = { scale: 20 };

describe("a bonus on one mark", () => {
  test("is points on that mark's own scale", () => {
    expect(gradeRatio({ value: 14, outOf: 20, bonus: 1 })).toBeCloseTo(
      0.75,
      10,
    );
  });

  test("cannot take a mark past full", () => {
    // Every reading downstream is built on 0..1 — bands, distributions, the axis of a
    // chart — so a mark at 1.05 would be a point drawn outside its own plot.
    expect(gradeRatio({ value: 20, outOf: 20, bonus: 1 })).toBe(1);
  });

  test("keeps user and synchronization exclusion gates independent", () => {
    expect(
      gradeRatio({
        value: 14,
        outOf: 20,
        excludedFromAverage: false,
        syncExcludedFromAverage: true,
      }),
    ).toBeNull();
    expect(
      gradeRatio({
        value: 14,
        outOf: 20,
        excludedFromAverage: true,
        syncExcludedFromAverage: false,
      }),
    ).toBeNull();
  });

  test("counts in the subject that holds it", () => {
    const graph = new SubjectGraph(
      [subject("maths", [grade("maths:1", 10), grade("maths:2", 10, 2)])],
      year,
    );
    // 10/20 and 12/20.
    expect(graph.ratio("maths")).toBeCloseTo(0.55, 10);
  });
});

describe("a bonus on a subject", () => {
  const subjects = [
    subject("maths", [grade("maths:1", 10)], 1),
    subject("french", [grade("french:1", 10)]),
  ];

  test("is points on the year's scale", () => {
    const graph = new SubjectGraph(subjects, year);
    expect(graph.ratio("maths")).toBeCloseTo(0.55, 10);
  });

  test("carries into the average above it", () => {
    const graph = new SubjectGraph(subjects, year);
    // 11/20 and 10/20.
    expect(graph.ratio(null)).toBeCloseTo(0.525, 10);
  });

  test("is ignored rather than guessed at without a scale", () => {
    /**
     * A bonus is in points, and points mean nothing without knowing what they are out
     * of. Told nothing, the graph reports what the marks say — which is at least a
     * number somebody can recognise, where a guessed scale would move the average
     * silently and by an amount nobody could account for.
     */
    expect(new SubjectGraph(subjects).ratio("maths")).toBeCloseTo(0.5, 10);
  });

  test("survives deriving another graph from this one", () => {
    // What a period filter and every simulation do.
    const graph = new SubjectGraph(subjects, year).withSubjects((item) => item);
    expect(graph.ratio("maths")).toBeCloseTo(0.55, 10);
  });
});

describe("a general average nominated from the custom ones", () => {
  const subjects = [
    subject("maths", [grade("maths:1", 16)]),
    subject("sport", [grade("sport:1", 4)]),
  ];
  const written: CustomAverage = {
    id: "written",
    name: "Written papers",
    isMain: false,
    sortOrder: 0,
    entries: [
      { subjectId: "maths", coefficient: null, includeChildren: false },
    ],
  };

  test("answers the general question with the nominated average", () => {
    const base = new SubjectGraph(subjects, year);
    const graph = new SubjectGraph(subjects, {
      ...year,
      general: generalAverageSource(base, written),
    });

    // The year's own average is 10/20; the nominated one is maths alone.
    expect(base.ratio(null)).toBeCloseTo(0.5, 10);
    expect(graph.ratio(null)).toBeCloseTo(0.8, 10);
  });

  test("leaves every subject reading alone", () => {
    // Substituting the headline is not hiding the year: sport still has an average, and
    // the subject screen still shows it.
    const base = new SubjectGraph(subjects, year);
    const graph = new SubjectGraph(subjects, {
      ...year,
      general: generalAverageSource(base, written),
    });

    expect(graph.ratio("sport")).toBeCloseTo(0.2, 10);
  });

  test("takes the year's general bonus with it", () => {
    const base = new SubjectGraph(subjects, year);
    const graph = new SubjectGraph(subjects, {
      ...year,
      generalBonus: 1,
      general: generalAverageSource(base, written),
    });

    expect(graph.ratio(null)).toBeCloseTo(0.85, 10);
  });

  test("does not substitute inside the average being read", () => {
    /**
     * Reading a custom average means reading the subjects it names. If the substitution
     * travelled into the subset graph, the nominated average would answer its own
     * general question with itself, forever.
     */
    const base = new SubjectGraph(subjects, year);
    const graph = new SubjectGraph(subjects, {
      ...year,
      general: generalAverageSource(base, written),
    });
    const resolved = resolveCustomAverage(graph, {
      ...written,
      id: "sporty",
      entries: [
        { subjectId: "sport", coefficient: null, includeChildren: false },
      ],
    });

    expect(resolved.graph.ratio(null, resolved.scope)).toBeCloseTo(0.2, 10);
  });

  test("gives a custom average its own bonus", () => {
    const graph = new SubjectGraph(subjects, year);
    const resolved = resolveCustomAverage(graph, { ...written, bonus: 2 });

    expect(resolved.graph.ratio(null, resolved.scope)).toBeCloseTo(0.9, 10);
  });
});
