import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import { createWidgetDefinition } from "./widget-defaults";
import { compileWidgetDefinition } from "./widget-definition";
import { evaluateWidgetDefinition } from "./widget-evaluator";
import { resolveWidgetFlow } from "./widget-flow";
import { widgetFrameSeries } from "./widget-frame";
import type { Grade, Subject } from "./types";
import type {
  WidgetDefinition,
  WidgetEvaluationContext,
} from "./widget-types";

/**
 * Two windows the card names itself.
 *
 * The comparison was in the model, was parsed, and had its periods collected as
 * references — and the evaluator never looked at it. A card carrying one was read over its
 * *query* window, and on a series it was handed the previous point's delta: a real number
 * answering a question nobody asked. This is the comparison actually being honoured.
 */

function grade(
  id: string,
  subjectId: string,
  value: number,
  passedAt: string,
): Grade {
  const at = new Date(`${passedAt}T12:00:00`);
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

// Two subjects, two results each, one on either side of the sixth of January.
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
      grade("m1", "math", 10, "2026-01-02"),
      grade("m2", "math", 18, "2026-01-20"),
    ],
  },
  {
    id: "science",
    name: "Science",
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: true,
    sortOrder: 1,
    grades: [
      grade("s1", "science", 14, "2026-01-03"),
      grade("s2", "science", 20, "2026-01-21"),
    ],
  },
];

function context(): WidgetEvaluationContext {
  const graph = new SubjectGraph(subjects);
  return {
    surface: "insights",
    graph,
    subjects,
    scope: null,
    from: new Date("2026-01-01T00:00:00"),
    to: new Date("2026-01-31T23:59:59"),
    year: {
      startsAt: new Date("2026-01-01T00:00:00"),
      endsAt: new Date("2026-12-31T23:59:59"),
      scale: 20,
    },
    yearSubjects: subjects,
    periods: [],
    customAverages: [],
    goals: [],
    passingRatio: 0.5,
    now: new Date("2026-01-31T12:00:00"),
    resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
  };
}

/** The same card as a single reading: no grouping, one number. */
const scalar = (definition: WidgetDefinition): WidgetDefinition => ({
  ...definition,
  analysis: { ...definition.analysis, dimensions: [] },
  visualization: { ...definition.visualization, recipe: "value" },
});

const pair = (definition: WidgetDefinition): WidgetDefinition => ({
  ...definition,
  analysis: {
    ...definition.analysis,
    comparison: {
      kind: "window-pair",
      left: { kind: "date-range", from: "2026-01-01", to: "2026-01-06" },
      right: { kind: "date-range", from: "2026-01-07", to: "2026-01-31" },
      alignment: "relative",
    },
  },
});

describe("a window pair", () => {
  test("compiles, now that a measure may carry one", () => {
    const compiled = compileWidgetDefinition(
      pair(createWidgetDefinition("insights")),
      { surface: "insights" },
    );

    expect(compiled.valid).toBe(true);
    expect(compiled.plan?.definition.analysis.comparison.kind).toBe(
      "window-pair",
    );
  });

  test("reads the right-hand window and holds the left against it", () => {
    const result = evaluateWidgetDefinition(
      pair(scalar(createWidgetDefinition("insights"))),
      context(),
    );

    expect(result.kind).toBe("scalar");
    if (result.kind !== "scalar") return;
    // Right: 18 and 20 → 19/20. Left: 10 and 14 → 12/20. The reading is the right-hand
    // side, which is what "the third term against the first" shows.
    expect(result.value).toBeCloseTo(0.95, 10);
    expect(result.delta).toBeCloseTo(0.95 - 0.6, 10);
  });

  test("ignores the card's own window, because the pair named two", () => {
    const definition = pair(scalar(createWidgetDefinition("insights")));
    definition.query.window = { kind: "whole-year" };

    const result = evaluateWidgetDefinition(definition, context());

    expect(result.kind).toBe("scalar");
    if (result.kind !== "scalar") return;
    // The whole year holds every result — an average of 15.5 — and the card still reads
    // the right-hand window. A pair that let the query window through would show a number
    // belonging to neither side.
    expect(result.value).toBeCloseTo(0.95, 10);
  });

  test("holds each row against its own row, by subject", () => {
    const definition = pair(createWidgetDefinition("insights"));
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "all",
        includeCategories: false,
        limit: 10,
      },
    ];
    definition.visualization.recipe = "bar";

    const result = evaluateWidgetDefinition(definition, context());

    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    const rows = widgetFrameSeries(result.frame, {
      x: null,
      y: "value",
      color: null,
      series: null,
      facet: null,
    });
    const maths = rows.find((row) => row.label.startsWith("Math"));

    expect(maths?.value).toBeCloseTo(0.9, 10);
    expect(maths?.delta).toBeCloseTo(0.9 - 0.5, 10);
  });

  test("says nothing rather than something wrong where it cannot be answered", () => {
    // A distribution has no second window to hold against — one set of marks is one set of
    // marks. What matters is that the card does not report the *previous bucket* as the
    // difference between two terms, which is what the series comparison used to hand it.
    const definition = pair(createWidgetDefinition("insights"));
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "gradeCount", goalId: null },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "week",
        accumulation: "bucket",
        fill: "observed",
      },
    ];
    definition.visualization.recipe = "line";

    const result = evaluateWidgetDefinition(definition, context());

    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    const rows = widgetFrameSeries(result.frame, {
      x: null,
      y: "value",
      color: null,
      series: null,
      facet: null,
    });
    // Aligned by ordinal: the first bucket of the right window against the first of the
    // left. Both windows have results, so the first row has a real difference rather than
    // the gap to the bucket beside it.
    expect(rows[0]?.delta).not.toBeNull();
  });
});

describe("the editor can compose one", () => {
  const flow = () =>
    resolveWidgetFlow(pair(createWidgetDefinition("insights")), {
      surface: "insights",
    });
  const fields = () =>
    [...flow().definition, ...flow().visualization].flatMap(
      (section) => section.fields,
    );

  test("offers the pair as a comparison", () => {
    const comparison = fields().find((field) => field.id === "comparison");

    expect(comparison?.options.map((option) => option.value)).toContain(
      "window-pair",
    );
  });

  test("gives each side the same six controls the card's window has", () => {
    const active = fields()
      .filter((field) => field.active)
      .map((field) => field.id);

    // The kind, and then whatever that kind needs. Both sides are date ranges here, so
    // both offer their two dates and neither offers a period.
    expect(active).toContain("pair-left-window");
    expect(active).toContain("pair-right-window");
    expect(active).toContain("pair-left-from");
    expect(active).toContain("pair-right-to");
    expect(active).not.toContain("pair-left-period");
    expect(active).toContain("pair-alignment");
  });

  test("keeps the pair's controls out of the way when there is no pair", () => {
    const plain = resolveWidgetFlow(createWidgetDefinition("insights"), {
      surface: "insights",
    });
    const active = [...plain.definition, ...plain.visualization]
      .flatMap((section) => section.fields)
      .filter((field) => field.active)
      .map((field) => field.id);

    expect(active).not.toContain("pair-left-window");
    expect(active).not.toContain("pair-alignment");
  });
});
