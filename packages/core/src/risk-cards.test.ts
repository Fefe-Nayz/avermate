import { describe, expect, test } from "bun:test";
import {
  ANOMALY_MINIMUM_SAMPLE,
  ANOMALY_THRESHOLD,
  evaluateCard,
  weightHierarchy,
  type CardMetric,
  type CardSpec,
} from "./cards";
import { SubjectGraph } from "./graph";
import type { Grade, Subject } from "./types";

/**
 * The two readings that say something is *risky* rather than good or bad.
 *
 * Both are derived from data the app already had and neither existed: how few subjects an
 * average rests on, and whether a recent mark looks like the rest. Both are also easy to
 * make dishonest — an arbitrary "top three", a two-sigma claim off four marks — so what is
 * asserted here is mostly the refusals.
 */

function grade(
  id: string,
  subjectId: string,
  value: number,
  day: number,
  coefficient = 1,
): Grade {
  const at = new Date(2026, 0, day, 12, 0, 0);
  return {
    id,
    name: id,
    value,
    outOf: 20,
    coefficient,
    passedAt: at,
    createdAt: at,
    subjectId,
    periodId: null,
    note: null,
    components: [],
  };
}

function subject(
  id: string,
  grades: Grade[],
  coefficient = 1,
  parentId: string | null = null,
): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId,
    coefficient,
    kind: "subject",
    isMain: true,
    sortOrder: 0,
    grades,
  };
}

const spec = (metric: CardMetric): CardSpec => ({
  id: metric,
  metric,
  target: { kind: "general", referenceId: null },
  display: "value",
  recipe: "value",
  span: 1,
  title: null,
  accent: null,
  goalId: null,
  sortOrder: 0,
  hidden: false,
});

const read = (graph: SubjectGraph, metric: CardMetric) =>
  evaluateCard(spec(metric), {
    graph,
    scope: null,
    subjectId: null,
    from: new Date(2026, 0, 1),
    to: new Date(2026, 1, 1),
    passingRatio: 0.5,
    now: new Date(2026, 1, 1),
    // A card points at something, and the context is what resolves it. These two read the
    // whole year, so every target resolves to the graph itself.
    resolveTarget: () => ({
      graph,
      subjects: graph.flatten(),
      scope: null,
      subjectId: null,
    }),
  } as never);

describe("how concentrated an average is", () => {
  test("counts the fewest subjects that carry half of it", () => {
    // Coefficients 4, 1, 1, 1: maths alone is four sevenths, which is already past half.
    const graph = new SubjectGraph([
      subject("maths", [grade("a", "maths", 12, 3)], 4),
      subject("art", [grade("b", "art", 12, 4)]),
      subject("music", [grade("c", "music", 12, 5)]),
      subject("sport", [grade("d", "sport", 12, 6)]),
    ]);
    const result = read(graph, "concentration");

    expect(result.kind).toBe("concentration");
    if (result.kind !== "concentration") return;
    expect(result.count).toBe(1);
    expect(result.total).toBe(4);
    expect(result.share).toBeCloseTo(4 / 7, 10);
    expect(result.subjects[0]?.id).toBe("maths");
  });

  test("reports the share those subjects actually hold, not the half that defined them", () => {
    const graph = new SubjectGraph([
      subject("a", [grade("a1", "a", 12, 3)], 3),
      subject("b", [grade("b1", "b", 12, 4)], 3),
      subject("c", [grade("c1", "c", 12, 5)]),
    ]);
    const result = read(graph, "concentration");

    if (result.kind !== "concentration") throw new Error("not a concentration");
    // Three sevenths is under a half, so the second subject is taken too — and the pair
    // holds six sevenths, which is the number worth saying.
    expect(result.count).toBe(2);
    expect(result.share).toBeCloseTo(6 / 7, 10);
  });

  test("agrees with the weight tree, because it is the weight tree", () => {
    const graph = new SubjectGraph([
      subject("science", [], 2),
      subject("physics", [grade("p", "physics", 14, 3)], 1, "science"),
      subject("chemistry", [grade("c", "chemistry", 9, 4)], 1, "science"),
      subject("art", [grade("a", "art", 11, 5)]),
    ]);
    const result = read(graph, "concentration");
    const leaves = weightHierarchy(graph, null).filter((node) => node.leaf);

    if (result.kind !== "concentration") throw new Error("not a concentration");
    // A nested subject's weight is its share of the path, not its own coefficient — the
    // whole point of the effective weights — and the two readings must not diverge.
    const heaviest = [...leaves].sort((a, b) => b.value - a.value)[0];
    expect(result.subjects[0]?.id).toBe(heaviest?.id ?? "");
    expect(result.total).toBe(leaves.filter((node) => node.value > 0).length);
  });

  test("has nothing to say about a year with no weights", () => {
    expect(read(new SubjectGraph([]), "concentration").kind).toBe("empty");
  });
});

describe("where one more mark buys the most", () => {
  test("prefers headroom over weight, and says what it is worth", () => {
    /**
     * Two subjects of equal weight and equal history: one at eleven, one at seventeen.
     * The one with room is where a good mark pays, and the number the card gives is
     * points of the *general* average — leverage times headroom — not a rank.
     */
    const graph = new SubjectGraph([
      subject("low", [grade("l1", "low", 11, 1), grade("l2", "low", 11, 2)]),
      subject("high", [
        grade("h1", "high", 17, 1),
        grade("h2", "high", 17, 2),
      ]),
    ]);
    const result = read(graph, "nextBestAction");

    expect(result.kind).toBe("priority");
    if (result.kind !== "priority") return;
    expect(result.subjectId).toBe("low");
    expect(result.current).toBeCloseTo(0.55, 10);
    // Realistically 0.85, so the headroom is 0.30, and the next mark in a two-mark
    // subject carries a third of that subject's half of the year: 0.30 × 0.5 / 3.
    expect(result.reference).toBeCloseTo(0.85, 10);
    expect(result.gain).toBeCloseTo(result.leverage * 0.3, 10);
  });

  test("does not recommend a subject already at the realistic level", () => {
    const graph = new SubjectGraph([
      subject("high", [grade("a", "high", 18, 1), grade("b", "high", 18, 2)]),
    ]);
    const result = read(graph, "nextBestAction");

    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    // Looked, and there is nothing to gain — a reading, not a failure.
    expect(result.reason?.kind).toBe("nothing-unusual");
  });

  test("leaves out a subject with no marks, whose weight is a different card", () => {
    // `nextLeverage` already reports "the subject you have never been graded in" as the
    // heaviest opportunity. Ranking it here too would put it on top of every dashboard
    // and drown the subject a reader can actually act on.
    const graph = new SubjectGraph([
      subject("fresh", []),
      subject("low", [grade("l1", "low", 11, 1), grade("l2", "low", 11, 2)]),
    ]);
    const result = read(graph, "nextBestAction");

    if (result.kind !== "priority") throw new Error("not a priority");
    expect(result.subjectId).toBe("low");
  });

  test("has nothing to say about a year with no marks at all", () => {
    const result = read(new SubjectGraph([subject("fresh", [])]), "nextBestAction");

    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    // Nothing was measured, so nothing is reassured either.
    expect(result.reason).toBeUndefined();
  });
});

describe("a result that stands out", () => {
  /** A steady subject, plus whatever the latest mark is. */
  const steady = (latest: number, count = 6) => {
    const history = Array.from({ length: count }, (_, index) =>
      grade(`h${index}`, "physics", index % 2 === 0 ? 14 : 15, index + 1),
    );
    return new SubjectGraph([
      subject("physics", [
        ...history,
        grade("latest", "physics", latest, count + 2),
      ]),
    ]);
  };

  test("finds a mark far from the subject's own level", () => {
    const result = read(steady(6), "anomaly");

    expect(result.kind).toBe("anomaly");
    if (result.kind !== "anomaly") return;
    expect(result.gradeId).toBe("latest");
    expect(result.deviations).toBeLessThan(-ANOMALY_THRESHOLD);
    // The level was measured from the marks *before* it, and says how many.
    expect(result.sample).toBe(6);
  });

  test("says nothing about a mark that looks like the rest — and says why", () => {
    const result = read(steady(15), "anomaly");

    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    // "Every recent mark looks like the rest" is a reading and "no marks yet" is a
    // failure, and a card that says the second while doing the first reads as broken.
    expect(result.reason?.kind).toBe("nothing-unusual");
  });

  test("does not claim normality where it never looked", () => {
    // Too few marks to establish a level: nothing became a candidate, so the card says
    // the ordinary "not enough" rather than reassuring anybody.
    const result = read(steady(2, ANOMALY_MINIMUM_SAMPLE - 1), "anomaly");

    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    expect(result.reason).toBeUndefined();
  });

  test("refuses to judge a level it has too few marks for", () => {
    // Four earlier marks and a wild result: still nothing, because at that size almost
    // any mark is two deviations from something and the card would cry wolf.
    const short = steady(2, ANOMALY_MINIMUM_SAMPLE - 1);

    expect(read(short, "anomaly").kind).toBe("empty");
  });

  test("measures the level without the mark it is judging", () => {
    /**
     * Including the outlier drags the mean towards it and inflates the spread, so an
     * unusual result partly hides itself. With this history — six marks at 14 and 15 — a
     * two is about nine deviations out when excluded and under three when included.
     */
    const result = read(steady(2), "anomaly");

    if (result.kind !== "anomaly") throw new Error("not an anomaly");
    expect(Math.abs(result.deviations)).toBeGreaterThan(5);
  });

  test("says nothing where there is no spread to measure against", () => {
    // Six identical marks and then a different one: the deviation is zero, and dividing
    // by it would report an infinity as a discovery.
    const flat = new SubjectGraph([
      subject("physics", [
        ...Array.from({ length: 6 }, (_, index) =>
          grade(`f${index}`, "physics", 14, index + 1),
        ),
        grade("latest", "physics", 9, 9),
      ]),
    ]);

    expect(read(flat, "anomaly").kind).toBe("empty");
  });

  test("reports the striking direction as well as the distance", () => {
    const high = read(steady(20), "anomaly");

    if (high.kind !== "anomaly") throw new Error("not an anomaly");
    // A result far *above* the usual level is worth saying too.
    expect(high.deviations).toBeGreaterThan(ANOMALY_THRESHOLD);
  });
});
