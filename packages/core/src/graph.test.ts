import { describe, expect, test } from "bun:test";
import { SubjectGraph, resolveCustomAverage, toScale } from "./graph";
import { gradeImpact, subjectImpact } from "./analytics";
import {
  leverageOf,
  planGoal,
  requiredResult,
  requiredSubjectRatio,
} from "./goals";
import type { CustomAverage, Grade, Subject } from "./types";

let counter = 0;

function grade(
  subjectId: string,
  value: number,
  outOf = 20,
  coefficient = 1,
  passedAt = new Date("2025-01-01"),
): Grade {
  counter += 1;
  return {
    id: `g${counter}`,
    name: `grade ${counter}`,
    value,
    outOf,
    coefficient,
    passedAt,
    createdAt: passedAt,
    subjectId,
    periodId: null,
    components: [],
  };
}

function subject(
  id: string,
  options: Partial<Subject> & { grades?: Grade[] } = {},
): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: false,
    sortOrder: 0,
    grades: [],
    ...options,
  };
}

describe("weighted averages", () => {
  test("a subject averages its grades by coefficient", () => {
    const maths = subject("maths", {
      grades: [grade("maths", 10, 20, 1), grade("maths", 20, 20, 3)],
    });
    const graph = new SubjectGraph([maths]);

    // (0.5·1 + 1·3) / 4 = 0.875
    expect(graph.ratio("maths")).toBeCloseTo(0.875, 10);
    expect(toScale(graph.ratio("maths"), 20)).toBeCloseTo(17.5, 10);
  });

  test("grades on different scales normalise before averaging", () => {
    const s = subject("s", {
      grades: [grade("s", 10, 20), grade("s", 50, 100)],
    });
    expect(new SubjectGraph([s]).ratio("s")).toBeCloseTo(0.5, 10);
  });

  test("a subject with no usable grade has no average", () => {
    const s = subject("s", { grades: [grade("s", 10, 0)] });
    expect(new SubjectGraph([s]).ratio("s")).toBeNull();
  });

  test("children weigh in through their own coefficient", () => {
    const parent = subject("parent");
    const a = subject("a", {
      parentId: "parent",
      coefficient: 3,
      grades: [grade("a", 20, 20)],
    });
    const b = subject("b", {
      parentId: "parent",
      coefficient: 1,
      grades: [grade("b", 0, 20)],
    });

    // (1·3 + 0·1) / 4
    expect(new SubjectGraph([parent, a, b]).ratio("parent")).toBeCloseTo(
      0.75,
      10,
    );
  });

  test("a parent's own grades count alongside its children", () => {
    const parent = subject("parent", { grades: [grade("parent", 0, 20, 1)] });
    const child = subject("child", {
      parentId: "parent",
      coefficient: 1,
      grades: [grade("child", 20, 20)],
    });
    expect(new SubjectGraph([parent, child]).ratio("parent")).toBeCloseTo(
      0.5,
      10,
    );
  });
});

describe("categories", () => {
  test("a category is transparent: its children weigh in at the level above", () => {
    // Category "science" holds maths (coef 3) and physics (coef 1). Sport, a
    // plain subject, has coef 1. If the category were a level of averaging the
    // general average would be (science + sport) / 2 = 0.5·… — it is not.
    const science = subject("science", { kind: "category", coefficient: 99 });
    const maths = subject("maths", {
      parentId: "science",
      coefficient: 3,
      grades: [grade("maths", 20, 20)],
    });
    const physics = subject("physics", {
      parentId: "science",
      coefficient: 1,
      grades: [grade("physics", 0, 20)],
    });
    const sport = subject("sport", {
      coefficient: 1,
      grades: [grade("sport", 10, 20)],
    });

    const graph = new SubjectGraph([science, maths, physics, sport]);

    // (1·3 + 0·1 + 0.5·1) / 5 = 0.7
    expect(graph.ratio(null)).toBeCloseTo(0.7, 10);
    // The category still shows an average of its own: (1·3 + 0·1) / 4
    expect(graph.ratio("science")).toBeCloseTo(0.75, 10);
  });

  test("a plain subject is counted once, whatever its children weigh", () => {
    const science = subject("science", { kind: "subject", coefficient: 1 });
    const maths = subject("maths", {
      parentId: "science",
      coefficient: 3,
      grades: [grade("maths", 20, 20)],
    });
    const physics = subject("physics", {
      parentId: "science",
      coefficient: 1,
      grades: [grade("physics", 0, 20)],
    });
    const sport = subject("sport", {
      coefficient: 1,
      grades: [grade("sport", 10, 20)],
    });

    const graph = new SubjectGraph([science, maths, physics, sport]);

    // science = 0.75, then (0.75·1 + 0.5·1) / 2 = 0.625
    expect(graph.ratio(null)).toBeCloseTo(0.625, 10);
  });

  test("nested categories collapse all the way up", () => {
    const outer = subject("outer", { kind: "category" });
    const inner = subject("inner", { parentId: "outer", kind: "category" });
    const leaf = subject("leaf", {
      parentId: "inner",
      coefficient: 2,
      grades: [grade("leaf", 20, 20)],
    });
    const other = subject("other", {
      coefficient: 2,
      grades: [grade("other", 0, 20)],
    });

    const graph = new SubjectGraph([outer, inner, leaf, other]);
    expect(graph.ratio(null)).toBeCloseTo(0.5, 10);
  });
});

describe("resilience", () => {
  test("an orphaned subject is re-rooted rather than dropped", () => {
    const orphan = subject("orphan", {
      parentId: "missing",
      grades: [grade("orphan", 20, 20)],
    });
    expect(new SubjectGraph([orphan]).ratio(null)).toBeCloseTo(1, 10);
  });

  test("a parent cycle does not hang the engine", () => {
    const a = subject("a", { parentId: "b", grades: [grade("a", 20, 20)] });
    const b = subject("b", { parentId: "a", grades: [grade("b", 0, 20)] });
    const graph = new SubjectGraph([a, b]);
    expect(graph.ratio(null)).not.toBeNaN();
  });

  test("a zero coefficient removes a subject from the weighting", () => {
    const a = subject("a", { coefficient: 1, grades: [grade("a", 20, 20)] });
    const b = subject("b", { coefficient: 0, grades: [grade("b", 0, 20)] });
    expect(new SubjectGraph([a, b]).ratio(null)).toBeCloseTo(1, 10);
  });
});

describe("custom averages", () => {
  const science = subject("science", { kind: "category" });
  const maths = subject("maths", {
    parentId: "science",
    coefficient: 1,
    grades: [grade("maths", 20, 20)],
  });
  const physics = subject("physics", {
    parentId: "science",
    coefficient: 1,
    grades: [grade("physics", 10, 20)],
  });
  const sport = subject("sport", {
    coefficient: 1,
    grades: [grade("sport", 0, 20)],
  });
  const graph = new SubjectGraph([science, maths, physics, sport]);

  test("only the chosen subjects take part", () => {
    const custom: CustomAverage = {
      id: "c1",
      name: "Science only",
      isMain: false,
      sortOrder: 0,
      entries: [
        { subjectId: "maths", coefficient: null, includeChildren: false },
        { subjectId: "physics", coefficient: null, includeChildren: false },
      ],
    };
    const resolved = resolveCustomAverage(graph, custom);
    expect(resolved.graph.ratio(null, resolved.scope)).toBeCloseTo(0.75, 10);
  });

  test("coefficients can be overridden", () => {
    const custom: CustomAverage = {
      id: "c2",
      name: "Weighted",
      isMain: false,
      sortOrder: 0,
      entries: [
        { subjectId: "maths", coefficient: 3, includeChildren: false },
        { subjectId: "physics", coefficient: 1, includeChildren: false },
      ],
    };
    const resolved = resolveCustomAverage(graph, custom);
    // (1·3 + 0.5·1) / 4
    expect(resolved.graph.ratio(null, resolved.scope)).toBeCloseTo(0.875, 10);
  });

  test("includeChildren pulls a whole sub-tree in", () => {
    const custom: CustomAverage = {
      id: "c3",
      name: "Science branch",
      isMain: false,
      sortOrder: 0,
      entries: [
        { subjectId: "science", coefficient: null, includeChildren: true },
      ],
    };
    const resolved = resolveCustomAverage(graph, custom);
    expect(resolved.graph.ratio(null, resolved.scope)).toBeCloseTo(0.75, 10);
  });

  test("a deep subject picked alone weighs in at top level", () => {
    const custom: CustomAverage = {
      id: "c4",
      name: "Maths only",
      isMain: false,
      sortOrder: 0,
      entries: [
        { subjectId: "maths", coefficient: null, includeChildren: false },
      ],
    };
    const resolved = resolveCustomAverage(graph, custom);
    expect(resolved.graph.ratio(null, resolved.scope)).toBeCloseTo(1, 10);
  });
});

describe("impacts", () => {
  test("a grade's impact is what the average loses without it", () => {
    const maths = subject("maths", {
      grades: [
        grade("maths", 20, 20, 1),
        grade("maths", 10, 20, 1, new Date("2025-02-01")),
      ],
    });
    const graph = new SubjectGraph([maths]);
    const target = graph.allGrades()[1] as Grade;

    const impact = gradeImpact(graph, target.id, null);
    // 0.75 with it, 1 without it.
    expect(impact.withValue).toBeCloseTo(0.75, 10);
    expect(impact.withoutValue).toBeCloseTo(1, 10);
    expect(impact.delta).toBeCloseTo(-0.25, 10);
  });

  test("a subject's impact removes its whole sub-tree", () => {
    const a = subject("a", { grades: [grade("a", 20, 20)] });
    const b = subject("b", { grades: [grade("b", 0, 20)] });
    const graph = new SubjectGraph([a, b]);

    const impact = subjectImpact(graph, "b", null);
    expect(impact.withValue).toBeCloseTo(0.5, 10);
    expect(impact.withoutValue).toBeCloseTo(1, 10);
    expect(impact.delta).toBeCloseTo(-0.5, 10);
  });
});

describe("goal planning", () => {
  const maths = subject("maths", {
    coefficient: 3,
    grades: [grade("maths", 12, 20, 1)],
  });
  const sport = subject("sport", {
    coefficient: 1,
    grades: [grade("sport", 10, 20, 1)],
  });
  const graph = new SubjectGraph([maths, sport]);

  test("leverage is the subject's effective weight at the top", () => {
    // maths has 3 of the 4 units of weight.
    expect(leverageOf(graph, null, "maths")).toBeCloseTo(0.75, 10);
    expect(leverageOf(graph, null, "sport")).toBeCloseTo(0.25, 10);
  });

  test("the required subject result inverts the average exactly", () => {
    const wanted = 0.7;
    const required = requiredSubjectRatio(graph, null, "maths", wanted);
    expect(required).not.toBeNull();

    const check = graph.ratio(null, {
      ratios: new Map([["maths", required as number]]),
    });
    expect(check).toBeCloseTo(wanted, 10);
  });

  test("the required result on planned assessments is exact too", () => {
    const planned = [{ subjectId: "sport", coefficient: 2, count: 2 }];
    const wanted = 0.65;
    const required = requiredResult(graph, null, planned, wanted);
    expect(required).not.toBeNull();

    const simulated = new SubjectGraph([
      maths,
      {
        ...sport,
        grades: [
          ...sport.grades,
          grade(
            "sport",
            (required as { requiredRatio: number }).requiredRatio * 20,
            20,
            2,
          ),
          grade(
            "sport",
            (required as { requiredRatio: number }).requiredRatio * 20,
            20,
            2,
          ),
        ],
      },
    ]);
    expect(simulated.ratio(null)).toBeCloseTo(wanted, 8);
  });

  test("an out-of-reach target is reported rather than rounded away", () => {
    const plan = planGoal(
      {
        id: "goal",
        name: "Impossible",
        kind: "general",
        referenceId: null,
        targetRatio: 0.99,
        periodId: null,
        dueAt: null,
        createdAt: new Date(),
        achievedAt: null,
      },
      graph,
      null,
    );
    expect(plan.status).toBe("unreachable");
    expect(plan.ceiling).not.toBeNull();
    expect(plan.ceiling as number).toBeLessThan(0.99);
  });

  test("a target already met reads as achieved and names what protects it", () => {
    const plan = planGoal(
      {
        id: "goal",
        name: "Modest",
        kind: "general",
        referenceId: null,
        targetRatio: 0.4,
        periodId: null,
        dueAt: null,
        createdAt: new Date(),
        achievedAt: null,
      },
      graph,
      null,
    );
    expect(["achieved", "secured"]).toContain(plan.status);
  });

  test("levers rank the subject where effort pays off most", () => {
    const plan = planGoal(
      {
        id: "goal",
        name: "Reach 14",
        kind: "general",
        referenceId: null,
        targetRatio: 0.7,
        periodId: null,
        dueAt: null,
        createdAt: new Date(),
        achievedAt: null,
      },
      graph,
      null,
    );
    expect(plan.levers[0]?.subject.id).toBe("maths");
    expect(plan.status === "at-risk" || plan.status === "on-track").toBe(true);
  });
});
