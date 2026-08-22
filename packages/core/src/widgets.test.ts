import { describe, expect, test } from "bun:test";
import {
  CARD_METRICS,
  weightHierarchy,
  type CardMetric,
  type CardResult,
} from "./cards";
import { leverageOf } from "./goals";
import { SubjectGraph } from "./graph";
import {
  resolveSlotMapping,
  substituteSlots,
  templateSlotKey,
  templateSlots,
} from "./template-slots";
import { widgetFrameFromSeries, widgetFrameSeries } from "./widget-frame";
import {
  widgetLiveStreak,
  widgetPrimaryMeasure,
  type WidgetEvaluationResult,
  type WidgetSeriesDatum,
} from "./widget-types";
import {
  canonicalizeWidgetDefinition,
  collectWidgetReferences,
  compileWidgetDefinition,
  validateWidgetDefinition,
} from "./widget-definition";
import {
  createWidgetDefinition,
  createWidgetVisualization,
  defaultInsightWidgets,
  widgetDefinitionFromCard,
  cardSemanticsFromDefinition,
} from "./widget-defaults";
import {
  evaluateWidgetDefinition,
  widgetStatusFromLabel,
} from "./widget-evaluator";
import { evaluateWidgetFormula, parseWidgetFormula } from "./widget-formula";
import { resolveWidgetFlow } from "./widget-flow";
import { WIDGET_CAPABILITIES, widgetCompatibleMarks } from "./widget-registry";
import { WIDGET_LIMITS } from "./widget-types";
import type {
  WidgetDefinition,
  WidgetEvaluationContext,
  WidgetFormula,
} from "./widget-types";
import type { Grade, Subject } from "./types";

/**
 * The plotted rows of a grouped result, as a renderer reads them.
 *
 * A grouped reading is a data frame now; every chart in the app goes through this same
 * projection, so the assertions below test  what a renderer would actually draw rather than an
 * intermediate the frame replaced.
 */
const PLOT_SLOTS = {
  x: null,
  y: "value",
  color: null,
  series: null,
  facet: null,
} as const;

function plotted(result: WidgetEvaluationResult): WidgetSeriesDatum[] {
  return result.kind === "data-frame"
    ? widgetFrameSeries(result.frame, PLOT_SLOTS)
    : [];
}

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
    note: id === "g2" ? "mock" : null,
    components: [],
  };
}

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
      grade("g1", "math", 10, "2026-01-01"),
      grade("g2", "math", 18, "2026-01-10"),
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
      grade("g3", "science", 14, "2026-01-05"),
      grade("g4", "science", 20, "2026-02-01"),
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
    to: new Date("2026-02-02T23:59:59"),
    year: {
      startsAt: new Date("2026-01-01T00:00:00"),
      endsAt: new Date("2026-12-31T23:59:59"),
      scale: 20,
    },
    yearSubjects: subjects,
    periods: [
      {
        id: "p1",
        name: "Period 1",
        startAt: new Date("2026-01-01T00:00:00"),
        endAt: new Date("2026-01-31T23:59:59"),
        isCumulative: false,
        sortOrder: 0,
      },
    ],
    customAverages: [
      {
        id: "stem",
        name: "STEM",
        isMain: false,
        sortOrder: 0,
        entries: [
          { subjectId: "science", coefficient: null, includeChildren: true },
        ],
      },
    ],
    passingRatio: 0.5,
    goals: [],
    now: new Date("2026-02-02T12:00:00"),
    resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
  };
}

describe("widget V1 registry and compatibility", () => {
  test("the registry covers every legacy metric plus formulas", () => {
    expect([...WIDGET_CAPABILITIES.keys()].sort() as string[]).toEqual(
      [...CARD_METRICS, "formula"].sort() as string[],
    );
  });

  test("formula widgets are available on dashboard and insights surfaces", () => {
    const formula = WIDGET_CAPABILITIES.get("formula");

    expect(formula?.surfaces).toContain("overview");
    expect(formula?.surfaces).toContain("insights");
  });

  test("legacy cards adapt without losing their persisted projection", () => {
    const legacy = {
      metric: "passRate" as const,
      targetKind: "subject" as const,
      targetId: "math",
      goalId: null,
      display: "gauge" as const,
    };
    const definition = widgetDefinitionFromCard(legacy);
    expect(cardSemanticsFromDefinition(definition)).toEqual(legacy);
  });

  test("a sparkline asks for a line with its apparatus stripped", () => {
    // `sparkline` and `chart` used to compile to the same thing, and the renderer
    // drew both as a full cartesian chart: axes, a y-grid, dated ticks in a 170px
    // box, and — because a series result carries no scalar — no reading at all.
    // A card whose job is to say "13.86" stopped saying it. There is no new mark
    // for this: a sparkline is a filled line without the apparatus, and the
    // apparatus is already in the model.
    const card = {
      metric: "average" as const,
      targetKind: "general" as const,
      targetId: null,
      goalId: null,
    };
    const spark = widgetDefinitionFromCard({ ...card, display: "sparkline" });
    const chart = widgetDefinitionFromCard({ ...card, display: "chart" });

    expect(spark.visualization.recipe).toBe("sparkline");
    expect(spark.visualization.axes).toEqual({
      x: { visible: false, grid: false, label: null },
      y: { visible: false, grid: false, label: null },
    });
    // Both still walk time, so both have a curve to draw.
    expect(spark.analysis.dimensions[0]?.kind).toBe("time");
    expect(chart.analysis.dimensions[0]?.kind).toBe("time");

    // And a card that asked for a chart keeps one.
    expect(chart.visualization.recipe).toBe("line");
    expect(chart.visualization.axes.x.visible).toBe(true);
    expect(chart.visualization.axes.y.visible).toBe(true);
  });

  test("stripping the axes is reserved for the marks it means something for", () => {
    for (const display of ["value", "gauge", "list"] as const) {
      const definition = widgetDefinitionFromCard({
        metric: "average",
        targetKind: "general",
        targetId: null,
        goalId: null,
        display,
      });
      expect(["line", "area", "sparkline"], display).not.toContain(
        definition.visualization.recipe,
      );
    }
  });

  test("legacy goal cards ignore obsolete target columns owned by the goal", () => {
    const definition = widgetDefinitionFromCard({
      metric: "goalProgress",
      targetKind: "subject",
      targetId: "math",
      goalId: "goal-1",
      display: "gauge",
    });

    expect(definition.query.scope).toEqual({ kind: "general" });
    expect(
      compileWidgetDefinition(definition, { surface: "overview" }).valid,
    ).toBe(true);
  });

  test("recommended Insights are explicit analytical widgets", () => {
    const defaults = defaultInsightWidgets();
    expect(defaults.map((item) => item.key)).toEqual([
      "average-over-time",
      "distribution",
      "most-improved",
      "consistency",
    ]);
    expect(
      defaults.every(
        (item) => item.definition.query.window.kind === "whole-year",
      ),
    ).toBe(true);
  });
});

describe("widget validation and declarative flow", () => {
  test("refuses an unavailable data source instead of silently reading grades", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.source = "cohort";

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });

    expect(compiled.valid).toBe(false);
    expect(compiled.issues).toContainEqual({
      path: "query.source",
      code: "unsupported",
      messageKey: "widget.error.source-unavailable",
    });
  });

  test("mark changes replace incompatible option objects canonically", () => {
    const definition = createWidgetDefinition("insights");
    const changed = {
      ...definition,
      visualization: {
        ...definition.visualization,
        recipe: "bar",
        options: { kind: "line", curve: "step", points: true, strokeWidth: 7 },
      },
    };
    const canonical = canonicalizeWidgetDefinition(changed, {
      surface: "insights",
    });
    expect(canonical.visualization.options).toEqual({
      kind: "bar",
      orientation: "vertical",
      stacked: false,
      cornerRadius: 4,
    });
    expect(canonical.visualization.scale.x).toEqual({ reverse: false });
  });

  test("the declarative flow clears hidden presentation fields", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [];
    definition.visualization.recipe = "value";
    definition.visualization.axes.x.label = "Stale time axis";

    const flow = resolveWidgetFlow(definition, { surface: "insights" });
    expect(flow.activePaths).not.toContain("visualization.axes.x.label");
    expect(flow.prunedDefinition.visualization.axes.x.label).toBeNull();
  });

  test("value adornments are offered only when a real comparison exists", () => {
    const average = createWidgetDefinition("overview");
    let flow = resolveWidgetFlow(average, { surface: "overview" });
    expect(flow.activePaths).not.toContain("visualization.options.showDelta");

    average.analysis.comparison = { kind: "baseline", value: 0.5 };
    flow = resolveWidgetFlow(average, { surface: "overview" });
    expect(flow.activePaths).toContain("visualization.options.showDelta");

    const streak = createWidgetDefinition("overview");
    streak.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "activityStreak", goalId: null },
      },
    ];
    flow = resolveWidgetFlow(streak, { surface: "overview" });
    expect(flow.activePaths).not.toContain("visualization.options.showDelta");
    expect(flow.prunedDefinition.visualization.options).toEqual({
      kind: "value",
      showDelta: false,
      trendIndicator: false,
    });
  });

  test("the flow reveals conditional data and visualization parameters", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["math"],
      includeDescendants: true,
    };
    definition.visualization.recipe = "line";
    const flow = resolveWidgetFlow(definition, {
      surface: "insights",
      options: {
        subjects: [{ value: "math", messageKey: "Math" }],
      },
    });
    expect(flow.activePaths).toContain("query.scope.subjectIds");
    expect(flow.activePaths).toContain("visualization.options.curve");
    expect(flow.activePaths).not.toContain("visualization.options.bins");
    const metricField = flow.definition
      .flatMap((section) => section.fields)
      .find((field) => field.id === "metric");
    expect(
      metricField?.options.some((option) => option.value === "formula"),
    ).toBe(false);
    const encodingFields = flow.visualization.flatMap(
      (section) => section.fields,
    );
    // Nothing to split by: a series names a dimension *after* the first, and this card
    // has one. The channel is offered again as soon as the analysis has a second axis —
    // which is the point of the change: the split is declared, not inferred from a
    // channel pointed at a magic field name.
    expect(
      encodingFields.find((field) => field.id === "encoding-series")?.options,
    ).toEqual([]);
    expect(
      encodingFields
        .find((field) => field.id === "encoding-y")
        ?.options.map((option) => option.value),
    ).toEqual(["measure", "measure.count"]);
    definition.analysis.comparison = { kind: "baseline", value: 0.5 };
    const comparedY = resolveWidgetFlow(definition, {
      surface: "insights",
      options: { subjects: [{ value: "math", messageKey: "Math" }] },
    })
      .visualization.flatMap((section) => section.fields)
      .find((field) => field.id === "encoding-y");
    expect(comparedY?.options.map((option) => option.value)).toEqual([
      "measure",
      "measure.count",
      "measure.delta",
    ]);
    expect(
      encodingFields.find((field) => field.id === "legend"),
    ).toBeUndefined();
    const filterField = flow.definition
      .flatMap((section) => section.fields)
      .find((field) => field.id === "filters");
    expect(
      filterField?.collection?.variants.map((item) => item.value),
    ).toContain("grade-ratio");
  });

  test("references are collected centrally for server ownership checks", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.scope = { kind: "custom-average", averageId: "stem" };
    definition.query.window = { kind: "period", periodId: "p1" };
    expect(collectWidgetReferences(definition)).toEqual({
      subjectIds: [],
      customAverageIds: ["stem"],
      goalIds: [],
      periodIds: ["p1"],
      cohortIds: [],
      cohortMemberIds: [],
      friendIds: [],
    });
    const invalid = validateWidgetDefinition(definition, {
      surface: "insights",
      references: { customAverageIds: new Set(), periodIds: new Set() },
    });
    expect(invalid.valid).toBe(false);
    expect(
      invalid.issues.filter((item) => item.code === "invalid-reference"),
    ).toHaveLength(2);

    const goal = createWidgetDefinition("overview");
    goal.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "goalProgress",
          goalId: "goal-1",
        },
      },
    ];
    expect(collectWidgetReferences(goal).goalIds).toEqual(["goal-1"]);
  });

  test("changing away from goal progress removes the stale goal reference", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "average",
          goalId: "old-goal",
        },
      },
    ];

    const canonical = canonicalizeWidgetDefinition(definition, {
      surface: "overview",
    });
    expect(widgetPrimaryMeasure(canonical.analysis)).toEqual({
      kind: "metric",
      metric: "average",
      goalId: null,
    });
    expect(collectWidgetReferences(canonical).goalIds).toEqual([]);
  });

  test("goal widgets expose only the goal and its presentation", () => {
    const definition = createWidgetDefinition("overview");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["stale-subject"],
      includeDescendants: true,
    };
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "goalProgress",
          goalId: "goal-1",
        },
      },
    ];

    const flow = resolveWidgetFlow(definition, {
      surface: "overview",
      options: { goals: [{ value: "goal-1", messageKey: "Goal" }] },
    });
    const active = flow.activePaths;
    expect(active).toContain("analysis.measures.0.expression.goalId");
    expect(active).not.toContain("query.scope.kind");
    expect(active).not.toContain("query.window.kind");
    expect(active).not.toContain("query.filters");
    expect(active).not.toContain("analysis.dimensions.0.kind");
    expect(active).not.toContain("analysis.comparison.kind");
    // The recipe *is* offered, and that is the change the stored recipe makes: a goal
    // can be drawn as a plain gauge or as a bullet, and the card now says which rather
    // than the shape following from whether a threshold happens to be set.
    expect(active).toContain("visualization.recipe");
    expect(flow.prunedDefinition.query.scope).toEqual({ kind: "general" });
    expect(collectWidgetReferences(flow.prunedDefinition)).toEqual({
      subjectIds: [],
      customAverageIds: [],
      goalIds: ["goal-1"],
      periodIds: [],
      cohortIds: [],
      cohortMemberIds: [],
      friendIds: [],
    });
  });

  test("capabilities prevent nonsensical chart combinations", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "lastGrade",
          goalId: null,
        },
      },
    ];
    definition.visualization.recipe = "histogram";
    const compiled = compileWidgetDefinition(definition, {
      surface: "overview",
    });
    expect(compiled.valid).toBe(false);
    expect(
      compiled.issues.some((item) => item.path === "visualization.recipe"),
    ).toBe(true);
    expect(
      widgetCompatibleMarks(widgetPrimaryMeasure(definition.analysis), []),
    ).toEqual(["value"]);
  });

  test("scalar and record measures never advertise fake one-point charts", () => {
    expect(
      widgetCompatibleMarks({ kind: "metric", metric: "average" }, []),
    ).toEqual(["value", "gauge"]);
    expect(
      widgetCompatibleMarks({ kind: "metric", metric: "spread" }, []),
    ).toEqual(["value"]);
    expect(
      widgetCompatibleMarks({ kind: "metric", metric: "goalProgress" }, []),
    ).toEqual(["gauge"]);
  });

  test("encoding channels reject fields the evaluator cannot materialize", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.encoding.y = {
      field: "group",
      type: "nominal",
    };
    definition.visualization.encoding.series = {
      field: "measure",
      type: "quantitative",
    };

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });
    expect(compiled.valid).toBe(false);
    expect(compiled.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "visualization.encoding.y" }),
        expect.objectContaining({ path: "visualization.encoding.series" }),
      ]),
    );
  });

  test("delta encodings require a materialized comparison", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.encoding.y = {
      field: "measure.delta",
      type: "quantitative",
    };
    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).issues,
    ).toContainEqual(
      expect.objectContaining({ path: "visualization.encoding.y" }),
    );

    definition.analysis.comparison = { kind: "baseline", value: 0.5 };
    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).valid,
    ).toBe(true);
  });

  test("distribution charts expose only meaningful y encodings", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "distribution",
          goalId: null,
        },
      },
    ];
    definition.analysis.dimensions = [];
    definition.visualization.recipe = "histogram";

    let flow = resolveWidgetFlow(definition, { surface: "insights" });
    let y = flow.visualization
      .flatMap((section) => section.fields)
      .find((field) => field.id === "encoding-y");
    expect(y).toBeUndefined();

    definition.visualization.recipe = "bar";
    definition.visualization.encoding.y = {
      field: "measure.count",
      type: "quantitative",
    };
    flow = resolveWidgetFlow(definition, { surface: "insights" });
    y = flow.visualization
      .flatMap((section) => section.fields)
      .find((field) => field.id === "encoding-y");
    // The measure, and how many marks it rests on: the two readings a y axis can take
    // for an ungrouped distribution. The names are ids now rather than the five fixed
    // fields, and `measure.count` is that measure's count rather than a field called
    // "count" that belonged to nothing in particular.
    expect(y?.options.map((option) => option.value)).toEqual([
      "measure",
      "measure.count",
    ]);
  });

  test("the flow never offers transformations or stacking that cannot run", () => {
    const scalar = createWidgetDefinition("overview");
    scalar.analysis.transforms = [{ kind: "limit", count: 3 }];
    const scalarCompile = compileWidgetDefinition(scalar, {
      surface: "overview",
    });
    expect(scalarCompile.valid).toBe(false);
    expect(scalarCompile.issues).toContainEqual(
      expect.objectContaining({ path: "analysis.transforms" }),
    );
    expect(
      resolveWidgetFlow(scalar, { surface: "overview" }).activePaths,
    ).not.toContain("analysis.transforms");

    const bars = createWidgetDefinition("insights");
    bars.visualization.recipe = "bar";
    bars.visualization.options = {
      kind: "bar",
      orientation: "vertical",
      stacked: true,
      cornerRadius: 4,
    };
    const singleSeries = compileWidgetDefinition(bars, {
      surface: "insights",
    });
    expect(singleSeries.valid).toBe(false);
    expect(singleSeries.issues).toContainEqual(
      expect.objectContaining({ path: "visualization.options.stacked" }),
    );
    expect(
      resolveWidgetFlow(bars, { surface: "insights" }).activePaths,
    ).not.toContain("visualization.options.stacked");

    // Stacking needs something to stack, which is a *second dimension* — the analysis
    // saying there are two axes — rather than a channel pointed at the one axis there is.
    bars.analysis.dimensions.push({
      id: "split",
      kind: "subject",
      level: "root",
      includeCategories: false,
      limit: 8,
    });
    bars.visualization.encoding.series = {
      field: "split",
      type: "nominal",
    };
    expect(
      resolveWidgetFlow(bars, { surface: "insights" }).activePaths,
    ).toContain("visualization.options.stacked");
  });

  test("subject grouping exposes only transformations with subject semantics", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "all",
        limit: 10,
        includeCategories: false,
      },
    ];
    definition.visualization.recipe = "bar";
    definition.analysis.transforms = [
      { kind: "moving-average", points: 3 },
      { kind: "cumulative" },
      { kind: "sort", direction: "descending" },
    ];

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });
    expect(compiled.valid).toBe(false);
    expect(compiled.issues).toContainEqual(
      expect.objectContaining({ path: "analysis.transforms" }),
    );

    const transformField = resolveWidgetFlow(definition, {
      surface: "insights",
    })
      .definition.flatMap((section) => section.fields)
      .find((field) => field.id === "transforms");
    expect(
      transformField?.collection?.variants.map((variant) => variant.value),
    ).toEqual(["sort", "limit"]);
  });

  test("inverted y domains are rejected and made safe for preview", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.scale.y.min = 10;
    definition.visualization.scale.y.max = 2;

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });
    expect(compiled.valid).toBe(false);
    expect(
      compiled.issues
        .filter((issue) => issue.messageKey === "widget.error.scale-order")
        .map((issue) => issue.path),
    ).toEqual(["visualization.scale.y.min", "visualization.scale.y.max"]);
    const flow = resolveWidgetFlow(definition, { surface: "insights" });
    expect(
      flow.visualization
        .flatMap((section) => section.fields)
        .filter((field) => field.error === "widget.error.scale-order")
        .map((field) => field.id),
    ).toEqual(["scale-min", "scale-max"]);
    expect(
      canonicalizeWidgetDefinition(definition, { surface: "insights" })
        .visualization.scale.y,
    ).toMatchObject({ min: 2, max: 10 });
  });

  test("the flow reports raw draft errors on their active field", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "formula",
          formula: { kind: "literal", value: null } as unknown as WidgetFormula,
          valueType: "number",
        },
      },
    ];

    const flow = resolveWidgetFlow(definition, { surface: "overview" });
    expect(flow.issues).toContainEqual(
      expect.objectContaining({
        path: "analysis.measures.0.expression.formula.value",
      }),
    );
    expect(
      flow.definition
        .flatMap((section) => section.fields)
        .find((field) => field.id === "formula")?.error,
    ).toBeTruthy();
  });

  test("reference validation points at the owning editor field", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["missing"],
      includeDescendants: false,
    };

    expect(
      compileWidgetDefinition(definition, {
        surface: "insights",
        references: { subjectIds: new Set() },
      }).issues,
    ).toContainEqual(
      expect.objectContaining({
        path: "query.scope.subjectIds",
        code: "invalid-reference",
      }),
    );
  });

  test("legends require a real color or series encoding", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.legend.visible = true;

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });
    expect(compiled.valid).toBe(false);
    expect(compiled.issues).toContainEqual(
      expect.objectContaining({ path: "visualization.legend.visible" }),
    );
    expect(
      canonicalizeWidgetDefinition(definition, { surface: "insights" })
        .visualization.legend.visible,
    ).toBe(false);
  });

  test("whole-year widgets do not offer a previous window they cannot load", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.window = { kind: "whole-year" };
    definition.analysis.comparison = { kind: "previous-window" };

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });
    expect(compiled.valid).toBe(false);
    const flow = resolveWidgetFlow(definition, { surface: "insights" });
    const comparison = flow.definition
      .flatMap((section) => section.fields)
      .find((field) => field.id === "comparison");
    expect(comparison?.options.map((option) => option.value)).not.toContain(
      "previous-window",
    );
  });

  test("threshold colors cannot persist arbitrary CSS", () => {
    const definition = createWidgetDefinition("overview");
    definition.visualization.thresholds = [
      { value: 0.5, color: "url(https://example.test/pixel)", label: "Risk" },
    ];

    const compiled = compileWidgetDefinition(definition, {
      surface: "overview",
    });
    expect(compiled.valid).toBe(false);
    expect(compiled.issues).toContainEqual(
      expect.objectContaining({
        path: "visualization.thresholds.0.color",
        messageKey: "widget.error.color",
      }),
    );
  });
});

describe("safe formulas", () => {
  test("aggregates and conditionals evaluate without executable code", () => {
    const formula: WidgetFormula = {
      kind: "conditional",
      condition: {
        kind: "compare",
        operation: "gte",
        left: { kind: "aggregate", operation: "mean", field: "ratio" },
        right: { kind: "parameter", name: "passingRatio" },
      },
      whenTrue: { kind: "literal", value: 1 },
      whenFalse: { kind: "literal", value: 0 },
    };
    expect(
      evaluateWidgetFormula(formula, {
        grades: [
          { ratio: 0.4, value: 8, outOf: 20, coefficient: 1 },
          { ratio: 0.8, value: 16, outOf: 20, coefficient: 1 },
        ],
        passingRatio: 0.5,
        yearScale: 20,
      }),
    ).toBe(1);
  });

  test("depth and node budgets reject abusive formula trees", () => {
    let formula: unknown = { kind: "literal", value: 1 };
    for (let index = 0; index < 20; index += 1) {
      formula = { kind: "unary", operation: "absolute", operand: formula };
    }
    const parsed = parseWidgetFormula(formula);
    expect(parsed.formula).toBeNull();
    expect(parsed.issues.some((item) => item.code === "complexity-limit")).toBe(
      true,
    );
  });

  test("missing aggregates propagate through comparisons and conditions", () => {
    const emptyContext = {
      grades: [],
      passingRatio: 0.5,
      yearScale: 20,
    };
    const missingMean: WidgetFormula = {
      kind: "aggregate",
      operation: "mean",
      field: "ratio",
    };
    expect(
      evaluateWidgetFormula(
        {
          kind: "compare",
          operation: "gt",
          left: missingMean,
          right: { kind: "literal", value: 0.5 },
        },
        emptyContext,
      ),
    ).toBeNull();
    expect(
      evaluateWidgetFormula(
        {
          kind: "conditional",
          condition: missingMean,
          whenTrue: { kind: "literal", value: 1 },
          whenFalse: { kind: "literal", value: 0 },
        },
        emptyContext,
      ),
    ).toBeNull();
  });
});

describe("widget evaluator", () => {
  test("goal progress follows the goal's own subject and period", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "goalProgress",
          goalId: "science-p1",
        },
      },
    ];
    definition.visualization.recipe = "gauge";
    definition.visualization.options = {
      kind: "gauge",
      showValue: true,
      thickness: 10,
    };
    const evaluationContext = context();
    evaluationContext.goals = [
      {
        id: "science-p1",
        name: "Science in period one",
        kind: "subject",
        referenceId: "science",
        targetRatio: 0.8,
        periodId: "p1",
        dueAt: null,
        createdAt: new Date("2026-01-01T00:00:00"),
        achievedAt: null,
      },
    ];

    const result = evaluateWidgetDefinition(definition, evaluationContext);
    expect(result.kind).toBe("structured");
    if (result.kind !== "structured" || result.value.kind !== "goal") return;
    expect(result.value.plan.current).toBeCloseTo(0.7);
    expect(result.value.plan.goal.referenceId).toBe("science");
  });

  test("goal progress remains visible before the first grade", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "goalProgress",
          goalId: "new-goal",
        },
      },
    ];
    definition.visualization.recipe = "gauge";
    const emptyContext = context();
    emptyContext.subjects = subjects.map((subject) => ({
      ...subject,
      grades: [],
    }));
    emptyContext.yearSubjects = emptyContext.subjects;
    emptyContext.graph = new SubjectGraph(emptyContext.subjects);
    emptyContext.goals = [
      {
        id: "new-goal",
        name: "First result",
        kind: "general",
        referenceId: null,
        targetRatio: 0.75,
        periodId: null,
        dueAt: null,
        createdAt: new Date("2026-01-01T00:00:00"),
        achievedAt: null,
      },
    ];

    const result = evaluateWidgetDefinition(definition, emptyContext);
    expect(result.kind).toBe("structured");
    if (result.kind === "structured" && result.value.kind === "goal") {
      expect(result.value.plan.current).toBeNull();
      expect(result.value.plan.goal.targetRatio).toBe(0.75);
    }
  });

  test("safe formulas retain their empty-dataset semantics", () => {
    const emptyContext = context();
    emptyContext.subjects = subjects.map((subject) => ({
      ...subject,
      grades: [],
    }));
    emptyContext.yearSubjects = emptyContext.subjects;
    emptyContext.graph = new SubjectGraph(emptyContext.subjects);
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [];
    definition.visualization.recipe = "value";
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "formula",
          formula: { kind: "literal", value: 5 },
          valueType: "number",
        },
      },
    ];
    expect(evaluateWidgetDefinition(definition, emptyContext)).toMatchObject({
      kind: "scalar",
      value: 5,
    });

    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "formula",
          formula: { kind: "aggregate", operation: "count", field: "ratio" },
          valueType: "count",
        },
      },
    ];
    expect(evaluateWidgetDefinition(definition, emptyContext)).toMatchObject({
      kind: "scalar",
      value: 0,
    });
  });

  test("missing period references fail closed", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [];
    definition.visualization.recipe = "value";
    definition.query.window = { kind: "period", periodId: "deleted" };

    expect(evaluateWidgetDefinition(definition, context())).toEqual({
      kind: "empty",
      shape: "scalar",
    });
  });

  test("windows and filters are applied before aggregation", () => {
    const rolling = createWidgetDefinition("insights");
    rolling.analysis.dimensions = [];
    rolling.visualization.recipe = "value";
    rolling.query.window = { kind: "rolling-days", days: 15 };
    expect(evaluateWidgetDefinition(rolling, context())).toMatchObject({
      kind: "scalar",
      value: 1,
    });

    const filtered = createWidgetDefinition("insights");
    filtered.analysis.dimensions = [];
    filtered.visualization.recipe = "value";
    filtered.query.window = { kind: "whole-year" };
    filtered.query.filters = [
      { kind: "grade-ratio", operator: "gte", value: 0.8 },
    ];
    expect(evaluateWidgetDefinition(filtered, context())).toMatchObject({
      kind: "scalar",
      value: 0.95,
    });
  });

  test("preserves the selected period's subject and general adjustments", () => {
    const adjustedSubjects = subjects.map((subject) => ({
      ...subject,
      bonus: subject.id === "math" ? 2 : 0,
      periodBonuses: { p1: subject.id === "math" ? 2 : 0 },
    }));
    const adjustedContext = context();
    adjustedContext.subjects = adjustedSubjects;
    adjustedContext.yearSubjects = adjustedSubjects;
    adjustedContext.graph = new SubjectGraph(adjustedSubjects, {
      scale: 20,
      generalBonus: 1,
    });
    adjustedContext.periods = adjustedContext.periods.map((period) => ({
      ...period,
      generalBonus: 1,
    }));

    const active = createWidgetDefinition("insights");
    active.analysis.dimensions = [];
    active.visualization.recipe = "value";
    expect(evaluateWidgetDefinition(active, adjustedContext)).toMatchObject({
      kind: "scalar",
      value: 0.875,
    });

    const explicitPeriod = createWidgetDefinition("insights");
    explicitPeriod.query.window = { kind: "period", periodId: "p1" };
    explicitPeriod.analysis.dimensions = [];
    explicitPeriod.visualization.recipe = "value";
    expect(
      evaluateWidgetDefinition(explicitPeriod, adjustedContext),
    ).toMatchObject({ kind: "scalar", value: 0.8 });
  });

  test("keeps whole-year adjustments independent from the active period", () => {
    const annualSubjects = subjects.map((subject) => ({
      ...subject,
      bonus: subject.id === "math" ? 4 : 0,
    }));
    const activeSubjects = annualSubjects.map((subject) => ({
      ...subject,
      bonus: subject.id === "math" ? -3 : 0,
    }));
    const annualGeneralBonus = 2;
    const adjustedContext = context();
    adjustedContext.subjects = activeSubjects;
    adjustedContext.graph = new SubjectGraph(activeSubjects, {
      scale: 20,
      generalBonus: -5,
    });
    adjustedContext.yearSubjects = annualSubjects;
    adjustedContext.year = {
      ...adjustedContext.year,
      generalBonus: annualGeneralBonus,
    };

    const wholeYear = createWidgetDefinition("insights");
    wholeYear.query.window = { kind: "whole-year" };
    wholeYear.analysis.dimensions = [];
    wholeYear.visualization.recipe = "value";

    expect(evaluateWidgetDefinition(wholeYear, adjustedContext)).toMatchObject({
      kind: "scalar",
      value: new SubjectGraph(annualSubjects, {
        scale: 20,
        generalBonus: annualGeneralBonus,
      }).ratio(null),
    });
  });

  test("last-grades windows are applied inside a custom average", () => {
    const scopedSubjects: Subject[] = subjects.map((subject) =>
      subject.id === "math"
        ? {
            ...subject,
            grades: [
              ...subject.grades,
              grade("math-latest", "math", 2, "2026-02-02"),
            ],
          }
        : subject,
    );
    const scopedContext = context();
    scopedContext.subjects = scopedSubjects;
    scopedContext.yearSubjects = scopedSubjects;
    scopedContext.graph = new SubjectGraph(scopedSubjects);
    const definition = createWidgetDefinition("insights");
    definition.query.scope = { kind: "custom-average", averageId: "stem" };
    definition.query.window = { kind: "last-grades", count: 1 };
    definition.analysis.dimensions = [];
    definition.visualization.recipe = "value";

    expect(evaluateWidgetDefinition(definition, scopedContext)).toMatchObject({
      kind: "scalar",
      value: 1,
    });
  });

  test("academic year and period windows include their complete boundary days", () => {
    const boundaryContext = context();
    boundaryContext.year = {
      ...boundaryContext.year,
      startsAt: new Date("2026-01-01T12:00:00"),
      endsAt: new Date("2026-02-01T12:00:00"),
    };
    boundaryContext.periods = [
      {
        ...boundaryContext.periods[0]!,
        startAt: new Date("2026-01-01T12:00:00"),
        endAt: new Date("2026-01-10T12:00:00"),
      },
    ];

    const wholeYear = createWidgetDefinition("insights");
    wholeYear.query.window = { kind: "whole-year" };
    wholeYear.analysis.dimensions = [];
    wholeYear.visualization.recipe = "value";
    const wholeYearResult = evaluateWidgetDefinition(
      wholeYear,
      boundaryContext,
    );
    expect(wholeYearResult.kind).toBe("scalar");
    if (wholeYearResult.kind === "scalar") {
      expect(wholeYearResult.value).toBeCloseTo(0.775);
    }

    const period = createWidgetDefinition("insights");
    period.query.window = { kind: "period", periodId: "p1" };
    period.analysis.dimensions = [];
    period.visualization.recipe = "value";
    const periodResult = evaluateWidgetDefinition(period, boundaryContext);
    expect(periodResult.kind).toBe("scalar");
    if (periodResult.kind === "scalar") {
      expect(periodResult.value).toBeCloseTo(0.7);
    }
  });

  test("time grouping produces real bucket and running series", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.window = { kind: "whole-year" };
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "month",
        accumulation: "bucket",
        fill: "observed",
      },
    ];
    let result = evaluateWidgetDefinition(definition, context());
    expect(result.kind).toBe("data-frame");
    if (result.kind === "data-frame") {
      expect(plotted(result).map((item) => item.value)).toEqual([0.7, 1]);
    }

    // The same monthly buckets, accumulated: bucket k reports every mark to date.
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "month",
        accumulation: "running",
        fill: "observed",
      },
    ];
    result = evaluateWidgetDefinition(definition, context());
    if (result.kind === "data-frame") {
      expect(plotted(result)[0]?.value).toBeCloseTo(0.7);
      expect(plotted(result)[1]?.value).toBeCloseTo(0.775);
      expect(plotted(result).map((item) => item.count)).toEqual([3, 4]);
    }
  });

  test("two dimensions split one measure into a series per subject", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["math", "science"],
      includeDescendants: true,
    };
    definition.query.window = { kind: "whole-year" };
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "month",
        accumulation: "running",
        fill: "observed",
      },
    ];
    // The audit's "generalised time × subject": the *analysis* says there are two axes,
    // and the encoding only decides which channel shows the second. Before this, a card
    // got several series when its series channel happened to name `category` — the split
    // was hidden in the drawing rather than declared in the question.
    definition.analysis.dimensions.push({
      id: "split",
      kind: "subject",
      level: "root",
      includeCategories: false,
      limit: 8,
    });
    definition.visualization.encoding.series = {
      field: "split",
      type: "nominal",
    };
    const result = evaluateWidgetDefinition(definition, context());
    expect(result.kind).toBe("data-frame");
    if (result.kind === "data-frame") {
      expect([...new Set(plotted(result).map((item) => item.series))]).toEqual([
        "Mathematics",
        "Science",
      ]);
      expect(plotted(result)).toHaveLength(3);
    }
  });

  test("long categorical time series are sampled fairly per subject", () => {
    const dailySubjects = ["math", "science"].map((id, subjectIndex) => ({
      ...subjects[subjectIndex],
      id,
      parentId: null,
      grades: Array.from({ length: 365 }, (_, day) => {
        const passedAt = new Date(Date.UTC(2025, 0, day + 1))
          .toISOString()
          .slice(0, 10);
        return grade(`${id}-${day}`, id, 10 + subjectIndex, passedAt);
      }),
    })) as Subject[];
    const longContext = context();
    longContext.subjects = dailySubjects;
    longContext.yearSubjects = dailySubjects;
    longContext.graph = new SubjectGraph(dailySubjects);
    longContext.from = new Date("2025-01-01T00:00:00");
    longContext.to = new Date("2025-12-31T23:59:59");
    longContext.year = {
      startsAt: longContext.from,
      endsAt: longContext.to,
      scale: 20,
    };
    longContext.now = longContext.to;

    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["math", "science"],
      includeDescendants: true,
    };
    definition.query.window = { kind: "whole-year" };
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "day",
        accumulation: "bucket",
        fill: "observed",
      },
    ];
    definition.analysis.dimensions.push({
      id: "split",
      kind: "subject",
      level: "root",
      includeCategories: false,
      limit: 8,
    });
    definition.visualization.encoding.series = {
      field: "split",
      type: "nominal",
    };

    const result = evaluateWidgetDefinition(definition, longContext);
    expect(result.kind).toBe("data-frame");
    if (result.kind === "data-frame") {
      expect(plotted(result)).toHaveLength(500);
      for (const label of ["Mathematics", "Science"]) {
        const series = plotted(result).filter((item) => item.series === label);
        expect(series).toHaveLength(250);
        expect(series[0]?.label).toBe("2025-01-01");
        expect(series.at(-1)?.label).toBe("2025-12-31");
      }
    }
  });

  test("subject grouping includes category aggregates only when requested", () => {
    const categorizedSubjects: Subject[] = [
      {
        id: "stem",
        name: "STEM",
        shortName: null,
        parentId: null,
        coefficient: 1,
        kind: "category",
        isMain: true,
        sortOrder: 0,
        grades: [],
      },
      { ...subjects[0], parentId: "stem", sortOrder: 0 },
      { ...subjects[1], sortOrder: 1 },
    ];
    const categorizedContext = context();
    categorizedContext.subjects = categorizedSubjects;
    categorizedContext.yearSubjects = categorizedSubjects;
    categorizedContext.graph = new SubjectGraph(categorizedSubjects);

    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "metric",
          metric: "subjectRanking",
          goalId: null,
        },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "all",
        limit: 10,
        includeCategories: false,
      },
    ];
    definition.visualization.recipe = "list";

    let result = evaluateWidgetDefinition(definition, categorizedContext);
    expect(result.kind).toBe("data-frame");
    if (result.kind === "data-frame") {
      expect(plotted(result).map((item) => item.key)).not.toContain("stem");
    }

    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "all",
        limit: 10,
        includeCategories: true,
      },
    ];
    result = evaluateWidgetDefinition(definition, categorizedContext);
    expect(result.kind).toBe("data-frame");
    if (result.kind === "data-frame") {
      expect(plotted(result).map((item) => item.key)).toContain("stem");
    }
  });

  test("subject limits are applied after sorting the evaluated values", () => {
    const rankedSubjects: Subject[] = [
      {
        ...subjects[0],
        id: "first",
        name: "First in display order",
        grades: [grade("first-grade", "first", 5, "2026-01-01")],
      },
      {
        ...subjects[1],
        id: "middle",
        name: "Middle",
        grades: [grade("middle-grade", "middle", 10, "2026-01-01")],
      },
      {
        ...subjects[1],
        id: "best",
        name: "Best",
        grades: [grade("best-grade", "best", 20, "2026-01-01")],
      },
    ];
    const rankedContext = context();
    rankedContext.subjects = rankedSubjects;
    rankedContext.yearSubjects = rankedSubjects;
    rankedContext.graph = new SubjectGraph(rankedSubjects);
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "all",
        limit: 1,
        includeCategories: false,
      },
    ];
    definition.analysis.transforms = [
      { kind: "sort", direction: "descending" },
    ];
    definition.visualization.recipe = "bar";
    definition.visualization.encoding.x = {
      field: "group",
      type: "nominal",
    };
    definition.visualization.encoding.y = {
      field: "measure",
      type: "quantitative",
    };

    const result = evaluateWidgetDefinition(definition, rankedContext);
    expect(result.kind).toBe("data-frame");
    if (result.kind === "data-frame") {
      expect(plotted(result)).toHaveLength(1);
      expect(plotted(result)[0]?.key).toBe("best");
    }
  });

  test("subject comparisons use the same subject in the previous window", () => {
    const comparisonSubjects = subjects.map((subject) => ({
      ...subject,
      grades:
        subject.id === "science"
          ? [...subject.grades, grade("g5", "science", 14, "2026-01-31")]
          : [...subject.grades],
    }));
    const comparisonContext = context();
    comparisonContext.graph = new SubjectGraph(comparisonSubjects);
    comparisonContext.subjects = comparisonSubjects;
    comparisonContext.yearSubjects = comparisonSubjects;
    const definition = createWidgetDefinition("insights");
    definition.query.window = {
      kind: "date-range",
      from: "2026-02-01",
      to: "2026-02-01",
    };
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "all",
        limit: 10,
        includeCategories: false,
      },
    ];
    definition.analysis.comparison = { kind: "previous-window" };
    definition.visualization.recipe = "bar";
    definition.visualization.encoding.x = {
      field: "group",
      type: "nominal",
    };
    definition.visualization.encoding.y = {
      field: "measure",
      type: "quantitative",
    };

    const result = evaluateWidgetDefinition(definition, comparisonContext);
    expect(result.kind).toBe("data-frame");
    if (result.kind === "data-frame") {
      expect(
        plotted(result).find((item) => item.key === "science")?.delta,
      ).toBeCloseTo(0.3);
      expect(
        plotted(result).find((item) => item.key === "math")?.delta,
      ).toBeNull();
    }
  });

  test("time comparisons align buckets with the previous window", () => {
    const history: Subject = {
      id: "history",
      name: "History",
      shortName: null,
      parentId: null,
      coefficient: 1,
      kind: "subject",
      isMain: true,
      sortOrder: 0,
      grades: [
        grade("old", "history", 10, "2026-01-02"),
        grade("current", "history", 14, "2026-01-17"),
      ],
    };
    const comparisonContext = context();
    comparisonContext.graph = new SubjectGraph([history]);
    comparisonContext.subjects = [history];
    comparisonContext.yearSubjects = [history];

    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["history"],
      includeDescendants: true,
    };
    definition.query.window = {
      kind: "date-range",
      from: "2026-01-16",
      to: "2026-01-31",
    };
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "day",
        accumulation: "bucket",
        fill: "observed",
      },
    ];
    definition.analysis.comparison = { kind: "previous-window" };
    definition.visualization.encoding.y = {
      field: "measure.delta",
      type: "quantitative",
    };

    const result = evaluateWidgetDefinition(definition, comparisonContext);
    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    expect(plotted(result)).toHaveLength(1);
    expect(plotted(result)[0]?.value).toBeCloseTo(0.7);
    expect(plotted(result)[0]?.delta).toBeCloseTo(0.2);
  });

  test("last-grades comparison uses the immediately preceding grade batch", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.window = { kind: "last-grades", count: 2 };
    definition.analysis.dimensions = [];
    definition.analysis.comparison = { kind: "previous-window" };
    definition.visualization.recipe = "value";

    const result = evaluateWidgetDefinition(definition, context());
    expect(result.kind).toBe("scalar");
    if (result.kind === "scalar") {
      expect(result.value).toBeCloseTo(0.95);
      expect(result.delta).toBeCloseTo(0.35);
    }
  });

  test("formula widgets and distribution summaries are computed from real grades", () => {
    const formula = createWidgetDefinition("insights");
    formula.query.window = { kind: "whole-year" };
    formula.analysis.dimensions = [];
    formula.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "formula",
          formula: { kind: "aggregate", operation: "mean", field: "ratio" },
          valueType: "ratio",
        },
      },
    ];
    formula.visualization.recipe = "value";
    expect(evaluateWidgetDefinition(formula, context())).toMatchObject({
      kind: "scalar",
      value: 0.775,
    });

    const distribution = widgetDefinitionFromCard({
      metric: "distribution",
      targetKind: "general",
      targetId: null,
      goalId: null,
      display: "chart",
    });
    distribution.query.window = { kind: "whole-year" };
    const result = evaluateWidgetDefinition(distribution, context());
    expect(result.kind).toBe("distribution");
    if (result.kind === "distribution") {
      expect(result.total).toBe(4);
      expect(result.summary).toMatchObject({ min: 0.5, median: 0.8, max: 1 });
    }
    distribution.visualization.options = { kind: "histogram", bins: 12 };
    const rebinned = evaluateWidgetDefinition(distribution, context());
    expect(
      rebinned.kind === "distribution" ? rebinned.buckets : [],
    ).toHaveLength(12);
  });
});

/**
 * A calendar heatmap has to have a square for every day, and a day missing from
 * the result is indistinguishable from a day outside the window. The audit asks
 * for the domain to be *completed* rather than for the drawing to guess, and for
 * each measure to keep its own answer about an empty day: a count is zero, an
 * average is nothing at all, and a running accumulation carries forward.
 */
describe("calendar completion", () => {
  const calendarDefinition = (
    metric: "gradeCount" | "average",
    accumulation: "bucket" | "running",
  ) => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric, goalId: null },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "day",
        accumulation,
        fill: "calendar",
      },
    ];
    definition.visualization.recipe = "heatmap";
    definition.visualization.encoding.x = { field: "group", type: "temporal" };
    definition.visualization.encoding.y = {
      field: "measure",
      type: "quantitative",
    };
    return definition;
  };

  test("gives every day in the window a bucket, in calendar order", () => {
    const evaluationContext = context();
    evaluationContext.from = new Date("2026-01-01T00:00:00");
    evaluationContext.to = new Date("2026-01-31T23:59:59");
    const result = evaluateWidgetDefinition(
      calendarDefinition("gradeCount", "bucket"),
      evaluationContext,
    );

    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    const keys = plotted(result).map((item) => item.label);
    // Thirty-one days seeded, in order, from the first to the last.
    expect(keys.slice(0, 31)).toEqual(
      Array.from(
        { length: 31 },
        (_, day) => `2026-01-${String(day + 1).padStart(2, "0")}`,
      ),
    );
    expect([...keys].sort()).toEqual(keys);
    // Completion adds buckets and never takes one away: an active-period window
    // trusts the graph it was handed, and this fixture's graph carries a mark on
    // the 1st of February. Dropping it to make the calendar tidy would lose data.
    expect(keys).toContain("2026-02-01");
  });

  test("a calendar recipe canonicalises its required day domain", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.recipe = "calendar";
    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });

    expect(compiled.valid).toBe(true);
    expect(compiled.plan?.definition.analysis.dimensions[0]).toEqual({
      id: "group",
      kind: "time",
      grain: "day",
      accumulation: "running",
      fill: "calendar",
    });
  });

  test("counts an empty day as none, and averages it as nothing", () => {
    const evaluationContext = context();
    evaluationContext.from = new Date("2026-01-01T00:00:00");
    evaluationContext.to = new Date("2026-01-31T23:59:59");

    const counted = evaluateWidgetDefinition(
      calendarDefinition("gradeCount", "bucket"),
      evaluationContext,
    );
    const averaged = evaluateWidgetDefinition(
      calendarDefinition("average", "bucket"),
      evaluationContext,
    );
    if (counted.kind !== "data-frame" || averaged.kind !== "data-frame") {
      throw new Error("expected two series");
    }

    // The 2nd of January has no mark in the fixture.
    const emptyCount = plotted(counted).find(
      (item) => item.label === "2026-01-02",
    );
    const emptyAverage = plotted(averaged).find(
      (item) => item.label === "2026-01-02",
    );
    expect(emptyCount?.value).toBe(0);
    expect(emptyCount?.count).toBe(0);
    // Not zero: nobody scored nothing that day, there was nothing to score.
    expect(emptyAverage?.value).toBeNull();
    expect(emptyAverage?.count).toBe(0);

    // And a day that *did* happen is unaffected by the completion.
    const observed = plotted(counted).find(
      (item) => item.label === "2026-01-01",
    );
    expect(observed?.count).toBe(1);
    expect(observed?.value).toBe(1);
  });

  test("carries a running accumulation across an empty day", () => {
    const evaluationContext = context();
    evaluationContext.from = new Date("2026-01-01T00:00:00");
    evaluationContext.to = new Date("2026-01-31T23:59:59");
    const result = evaluateWidgetDefinition(
      calendarDefinition("average", "running"),
      evaluationContext,
    );
    if (result.kind !== "data-frame") throw new Error("expected a series");

    const first = plotted(result).find((item) => item.label === "2026-01-01");
    const next = plotted(result).find((item) => item.label === "2026-01-02");
    // Nothing happened on the 2nd, so the average to date is the average to
    // date — a gap here would draw a line falling to zero and back.
    expect(next?.value).toBe(first?.value ?? null);
    expect(next?.value).not.toBeNull();
  });

  test("observed fill still reports only the days that happened", () => {
    const definition = calendarDefinition("gradeCount", "bucket");
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "day",
        accumulation: "bucket",
        fill: "observed",
      },
    ];
    const evaluationContext = context();
    evaluationContext.from = new Date("2026-01-01T00:00:00");
    evaluationContext.to = new Date("2026-01-31T23:59:59");
    const result = evaluateWidgetDefinition(definition, evaluationContext);
    if (result.kind !== "data-frame") throw new Error("expected a series");

    expect(plotted(result).length).toBeLessThan(31);
    expect(plotted(result).every((item) => item.count > 0)).toBe(true);
  });
});

describe("formula metric operands", () => {
  function formulaDefinition(formula: WidgetFormula): WidgetDefinition {
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [];
    definition.visualization.recipe = "value";
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "formula",
          formula,
          valueType: "ratio",
        },
      },
    ];
    return definition;
  }

  test("a metric operand equals the standalone metric", () => {
    const viaFormula = evaluateWidgetDefinition(
      formulaDefinition({ kind: "metric", metric: "average" }),
      context(),
    );

    const standalone = createWidgetDefinition("insights");
    standalone.analysis.dimensions = [];
    standalone.visualization.recipe = "value";
    standalone.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "average", goalId: null },
      },
    ];
    const viaMetric = evaluateWidgetDefinition(standalone, context());

    expect(viaFormula.kind).toBe("scalar");
    expect(viaMetric.kind).toBe("scalar");
    const formulaValue = viaFormula.kind === "scalar" ? viaFormula.value : null;
    const metricValue = viaMetric.kind === "scalar" ? viaMetric.value : null;
    expect(formulaValue).not.toBeNull();
    expect(formulaValue).toBeCloseTo(metricValue as number, 10);
  });

  test("cross-scope subtraction: one subject against the whole selection", () => {
    const definition = formulaDefinition({
      kind: "binary",
      operation: "subtract",
      left: {
        kind: "metric",
        metric: "average",
        scope: {
          kind: "subjects",
          subjectIds: ["math"],
          includeDescendants: true,
        },
        window: { kind: "whole-year" },
      },
      right: {
        kind: "metric",
        metric: "average",
        window: { kind: "whole-year" },
      },
    });
    definition.query.window = { kind: "whole-year" };

    const result = evaluateWidgetDefinition(definition, context());
    expect(result.kind).toBe("scalar");
    // Math averages 0.7; the whole selection averages 0.775.
    expect(result.kind === "scalar" ? result.value : null).toBeCloseTo(
      -0.075,
      10,
    );
  });

  test("references flow through metric operand overrides", () => {
    const definition = formulaDefinition({
      kind: "binary",
      operation: "add",
      left: {
        kind: "metric",
        metric: "average",
        scope: {
          kind: "subjects",
          subjectIds: ["math"],
          includeDescendants: true,
        },
        window: { kind: "period", periodId: "p1" },
      },
      right: {
        kind: "metric",
        metric: "median",
        scope: { kind: "custom-average", averageId: "stem" },
      },
    });

    const references = collectWidgetReferences(definition);
    expect(references.subjectIds).toContain("math");
    expect(references.customAverageIds).toContain("stem");
    expect(references.periodIds).toContain("p1");
    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).valid,
    ).toBe(true);
  });

  test("non-scalar metrics are rejected as operands", () => {
    const parsed = parseWidgetFormula({
      kind: "metric",
      metric: "subjectRanking",
    });
    expect(parsed.formula).toBeNull();
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        messageKey: "widget.error.formula-metric",
      }),
    );
  });

  test("the editor's inherit choice is stripped from the stored node", () => {
    const parsed = parseWidgetFormula({
      kind: "metric",
      metric: "average",
      scope: { kind: "inherit" },
      window: { kind: "inherit" },
    });
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.formula).toEqual({ kind: "metric", metric: "average" });
  });

  test("the metric-operand budget is enforced", () => {
    let formula: WidgetFormula = { kind: "metric", metric: "average" };
    for (let index = 0; index < WIDGET_LIMITS.formulaMetricNodes; index += 1) {
      formula = {
        kind: "binary",
        operation: "add",
        left: formula,
        right: { kind: "metric", metric: "average" },
      };
    }
    const parsed = parseWidgetFormula(formula);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: "complexity-limit" }),
    );
  });
});

/**
 * The two invariants a weight chart lives or dies by. A treemap whose leaves do not
 * sum to the whole is drawing areas that mean nothing, and one that counts a branch
 * *and* its children adds up to two hundred per cent — the classic way such a chart
 * lies.
 */
describe("effective weights", () => {
  const nested = (): Subject[] => [
    {
      id: "sciences",
      name: "Sciences",
      shortName: null,
      parentId: null,
      coefficient: 4,
      kind: "category",
      isMain: true,
      sortOrder: 0,
      grades: [],
    },
    {
      id: "maths",
      name: "Maths",
      shortName: null,
      parentId: "sciences",
      coefficient: 1,
      kind: "subject",
      isMain: true,
      sortOrder: 0,
      grades: [grade("m1", "maths", 12, "2026-01-05T10:00:00")],
    },
    {
      id: "physique",
      name: "Physique",
      shortName: null,
      parentId: "sciences",
      coefficient: 3,
      kind: "subject",
      isMain: true,
      sortOrder: 1,
      grades: [grade("p1", "physique", 14, "2026-01-06T10:00:00")],
    },
    {
      id: "art",
      name: "Art",
      shortName: null,
      parentId: null,
      coefficient: 1,
      kind: "subject",
      isMain: false,
      sortOrder: 1,
      // No marks at all, and it still carries its weight.
      grades: [],
    },
  ];

  test("leaves sum to the whole", () => {
    const nodes = weightHierarchy(new SubjectGraph(nested()), null);
    const leaves = nodes.filter((node) => node.leaf);

    expect(leaves.map((node) => node.id).sort()).toEqual([
      "art",
      "maths",
      "physique",
    ]);
    expect(leaves.reduce((sum, node) => sum + node.value, 0)).toBeCloseTo(
      1,
      10,
    );
  });

  test("a branch is exactly the sum of its children", () => {
    const nodes = weightHierarchy(new SubjectGraph(nested()), null);
    const branch = nodes.find((node) => node.id === "sciences");
    const children = nodes.filter((node) => node.parentId === "sciences");

    expect(branch?.leaf).toBe(false);
    expect(branch?.value).toBeCloseTo(
      children.reduce((sum, node) => sum + node.value, 0),
      10,
    );
    // And four fifths of the average, since Sciences is coefficient 4 of 5.
    expect(branch?.value).toBeCloseTo(0.8, 10);
  });

  test("dissolves a category rather than multiplying by its coefficient", () => {
    const nodes = weightHierarchy(new SubjectGraph(nested()), null);

    // Sciences is a category of coefficient 4, and that 4 weighs nothing: its
    // children compete at the level above, so the year's coefficients are 1, 3 and
    // 1. Reading the path as a product — the formula the audit proposes — would put
    // Maths at four fifths of the year instead of one fifth.
    expect(nodes.find((node) => node.id === "maths")?.value).toBeCloseTo(
      0.2,
      10,
    );
    expect(nodes.find((node) => node.id === "physique")?.value).toBeCloseTo(
      0.6,
      10,
    );
    expect(nodes.find((node) => node.id === "art")?.value).toBeCloseTo(0.2, 10);
  });

  test("is structural, where leverage is the sensitivity of today's average", () => {
    // Art has no marks, so the average currently excludes it: moving Art from
    // nothing to full marks *adds* it, and `leverage` reports that. This reading
    // answers a different question — what each subject is worth — so it does not
    // move when a mark arrives, which is what makes a weight card stable.
    const graph = new SubjectGraph(nested());
    const nodes = weightHierarchy(graph, null);
    const maths = nodes.find((node) => node.id === "maths");

    expect(maths?.value).toBeCloseTo(0.2, 10);
    // Today's average is Sciences alone, so Maths' sensitivity is a quarter.
    expect(leverageOf(graph, null, "maths", null)).toBeCloseTo(0.25, 10);
  });

  test("splits a subject that carries marks of its own beside its children", () => {
    const withOwn: Subject[] = [
      {
        id: "langues",
        name: "Langues",
        shortName: null,
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        // One mark of its own, coefficient 1, against one sub-subject of 3.
        grades: [grade("l1", "langues", 15, "2026-01-05T10:00:00")],
      },
      {
        id: "anglais",
        name: "Anglais",
        shortName: null,
        parentId: "langues",
        coefficient: 3,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [grade("a1", "anglais", 16, "2026-01-06T10:00:00")],
      },
    ];
    const nodes = weightHierarchy(new SubjectGraph(withOwn), null);
    const own = nodes.find((node) => node.kind === "own-marks");
    const child = nodes.find((node) => node.id === "anglais");

    // A quarter to its own mark, three quarters to the sub-subject — and both are
    // nodes, so the leaves still sum to the whole.
    expect(own?.value).toBeCloseTo(0.25, 10);
    expect(child?.value).toBeCloseTo(0.75, 10);
    expect(
      nodes
        .filter((node) => node.leaf)
        .reduce((sum, node) => sum + node.value, 0),
    ).toBeCloseTo(1, 10);
  });

  test("carries the depth so a list never walks the tree", () => {
    const nodes = weightHierarchy(new SubjectGraph(nested()), null);

    expect(nodes.find((node) => node.id === "sciences")?.depth).toBe(0);
    expect(nodes.find((node) => node.id === "maths")?.depth).toBe(1);
    expect(nodes.find((node) => node.id === "art")?.depth).toBe(0);
  });
});

describe("widgetLiveStreak", () => {
  const wrap = (
    value: Extract<CardResult, { kind: "streak" }>,
  ): WidgetEvaluationResult => ({ kind: "structured", shape: "streak", value });
  const streak = (alive: boolean) =>
    ({ kind: "streak", current: 4, longest: 9, alive }) as const;

  test("finds a live streak through the wrapper it arrives in", () => {
    expect(widgetLiveStreak(wrap(streak(true)))).toEqual(streak(true));
  });

  test("says nothing for a streak that has gone out", () => {
    // A dead streak is still a streak result; it just does not dress the card.
    expect(widgetLiveStreak(wrap(streak(false)))).toBeNull();
  });

  test("says nothing for the results that are not streaks", () => {
    expect(widgetLiveStreak({ kind: "empty", shape: "scalar" })).toBeNull();
    expect(
      widgetLiveStreak({
        kind: "scalar",
        shape: "scalar",
        value: 1,
        valueType: "count",
        delta: null,
      }),
    ).toBeNull();
    // A `structured` result carrying something else, so the inner check is doing
    // work too — and the shape tag is deliberately not `"streak"` here either,
    // since the value is what is read and the tag is not consulted.
    expect(
      widgetLiveStreak({
        kind: "structured",
        shape: "records",
        value: { kind: "list", items: [] },
      }),
    ).toBeNull();
  });
});

/**
 * The two readings the goal planner already computed and nothing exposed.
 *
 * Both are selections rather than derivations, which is the point: a card and the
 * goal screen read the same `planGoal`, so they cannot disagree about a subject
 * or about a required mark.
 */
describe("planner-backed cards", () => {
  function subjectSeries(): Subject[] {
    return [
      {
        id: "maths",
        name: "Maths",
        shortName: null,
        parentId: null,
        coefficient: 4,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [grade("m1", "maths", 10, "2026-01-05T10:00:00")],
      },
      {
        id: "art",
        name: "Art",
        shortName: null,
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: false,
        sortOrder: 1,
        grades: [grade("a1", "art", 10, "2026-01-06T10:00:00")],
      },
    ];
  }

  test("leverage ranks subjects by the share of the average they carry", () => {
    const subjects = subjectSeries();
    const graph = new SubjectGraph(subjects);
    const definition = canonicalizeWidgetDefinition(
      {
        ...createWidgetDefinition("overview"),
        analysis: {
          measures: [
            {
              id: "measure",
              label: null,
              expression: { kind: "metric", metric: "leverage", goalId: null },
            },
          ],
          dimensions: [
            {
              id: "group",
              kind: "subject",
              level: "all",
              limit: 10,
              includeCategories: false,
            },
          ],
          comparison: { kind: "none" },
          transforms: [],
        },
        visualization: {
          ...createWidgetDefinition("overview").visualization,
          recipe: "lollipop",
        },
      },
      { surface: "overview" },
    );

    const result = evaluateWidgetDefinition(definition, {
      ...context(),
      graph,
      subjects,
      yearSubjects: subjects,
      resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
    });

    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    // Four to one in coefficients, so four fifths against one fifth of the
    // average — and the heavier subject is first, because the question is which
    // ones carry it.
    expect(plotted(result).map((item) => item.key)).toEqual(["maths", "art"]);
    expect(plotted(result)[0]!.value).toBeCloseTo(0.8, 5);
    expect(plotted(result)[1]!.value).toBeCloseTo(0.2, 5);
    // The shares of one average sum to the whole of it.
    const total = plotted(result).reduce(
      (sum, item) => sum + (item.value ?? 0),
      0,
    );
    expect(total).toBeCloseTo(1, 5);
  });

  test("the required mark picks the cheapest route that still gets there", () => {
    const subjects = subjectSeries();
    const graph = new SubjectGraph(subjects);
    const definition = canonicalizeWidgetDefinition(
      {
        ...createWidgetDefinition("overview"),
        analysis: {
          measures: [
            {
              id: "measure",
              label: null,
              expression: {
                kind: "metric",
                metric: "requiredResult",
                goalId: "goal-1",
              },
            },
          ],
          dimensions: [],
          comparison: { kind: "none" },
          transforms: [],
        },
      },
      { surface: "overview" },
    );

    const result = evaluateWidgetDefinition(definition, {
      ...context(),
      graph,
      subjects,
      yearSubjects: subjects,
      goals: [
        {
          id: "goal-1",
          name: "Above 12",
          kind: "general",
          referenceId: null,
          targetRatio: 0.6,
          periodId: null,
          dueAt: null,
          createdAt: new Date("2026-01-01T00:00:00"),
          achievedAt: null,
        },
      ],
      remaining: () => 2,
      resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
    });

    expect(result.kind).toBe("structured");
    if (result.kind !== "structured") return;
    const value = result.value as Extract<CardResult, { kind: "required" }>;
    expect(value.kind).toBe("required");
    expect(value.goalName).toBe("Above 12");
    expect(value.target).toBeCloseTo(0.6, 5);
    // Both subjects sit at ten out of twenty against a target of twelve, so
    // something is required, and the route named must be a real subject.
    expect(value.next).not.toBeNull();
    expect(["maths", "art"]).toContain(value.next!.subjectId);
    expect(value.next!.coefficient).toBeGreaterThan(0);
    // A mark above the scale is reported as it is rather than clamped: that is
    // the honest answer to a goal that has slipped.
    expect(value.next!.requiredRatio).toBeGreaterThan(0);
    expect(value.gap).toBeCloseTo(0.1, 5);
  });

  test("a goal card with no goal reads as empty rather than throwing", () => {
    const definition = canonicalizeWidgetDefinition(
      {
        ...createWidgetDefinition("overview"),
        analysis: {
          measures: [
            {
              id: "measure",
              label: null,
              expression: {
                kind: "metric",
                metric: "requiredResult",
                goalId: "missing",
              },
            },
          ],
          dimensions: [],
          comparison: { kind: "none" },
          transforms: [],
        },
      },
      { surface: "overview" },
    );

    expect(evaluateWidgetDefinition(definition, context()).kind).toBe("empty");
  });

  test("coverage completes its domain instead of reporting what it found", () => {
    const subjects: Subject[] = [
      {
        id: "maths",
        name: "Maths",
        shortName: null,
        parentId: null,
        coefficient: 4,
        kind: "subject",
        isMain: true,
        sortOrder: 0,
        grades: [
          grade("m1", "maths", 10, "2026-01-05T10:00:00"),
          grade("m2", "maths", 14, "2026-01-09T10:00:00"),
        ],
      },
      {
        id: "music",
        name: "Music",
        shortName: null,
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: false,
        sortOrder: 1,
        grades: [],
      },
      {
        id: "art",
        name: "Art",
        shortName: null,
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: false,
        sortOrder: 2,
        grades: [grade("a1", "art", 0, "2026-01-06T10:00:00")],
      },
    ];
    const graph = new SubjectGraph(subjects);
    const definition = canonicalizeWidgetDefinition(
      {
        ...createWidgetDefinition("overview"),
        analysis: {
          measures: [
            {
              id: "measure",
              label: null,
              expression: { kind: "metric", metric: "coverage", goalId: null },
            },
          ],
          dimensions: [
            {
              id: "group",
              kind: "subject",
              level: "all",
              limit: 10,
              includeCategories: false,
            },
          ],
          comparison: { kind: "none" },
          transforms: [],
        },
        visualization: {
          ...createWidgetDefinition("overview").visualization,
          recipe: "list",
        },
      },
      { surface: "overview" },
    );

    const result = evaluateWidgetDefinition(definition, {
      ...context(),
      graph,
      subjects,
      yearSubjects: subjects,
      resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
    });

    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    // The whole scope, and nothing outside it: the audit's invariant.
    expect(new Set(plotted(result).map((item) => item.key))).toEqual(
      new Set(["maths", "music", "art"]),
    );
    // Never assessed comes first, because that is the reading.
    expect(plotted(result)[0]!.key).toBe("music");
    expect(plotted(result)[0]!.count).toBe(0);
    // An average of zero is not the same state as no grades at all, and both
    // survive into the datum.
    const art = plotted(result).find((item) => item.key === "art");
    expect(art?.count).toBe(1);
    // A ranking of averages, by contrast, still reports only what it found.
    const ranking = canonicalizeWidgetDefinition(
      {
        ...createWidgetDefinition("overview"),
        analysis: {
          measures: [
            {
              id: "measure",
              label: null,
              expression: {
                kind: "metric",
                metric: "subjectRanking",
                goalId: null,
              },
            },
          ],
          dimensions: [
            {
              id: "group",
              kind: "subject",
              level: "all",
              limit: 10,
              includeCategories: false,
            },
          ],
          comparison: { kind: "none" },
          transforms: [],
        },
        visualization: {
          ...createWidgetDefinition("overview").visualization,
          recipe: "list",
        },
      },
      { surface: "overview" },
    );
    const ranked = evaluateWidgetDefinition(ranking, {
      ...context(),
      graph,
      subjects,
      yearSubjects: subjects,
      resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
    });
    if (ranked.kind !== "data-frame") throw new Error("expected a series");
    expect(plotted(ranked).map((item) => item.key)).not.toContain("music");
  });
});

describe("composable categorical domains", () => {
  const subjectCross = (
    split:
      | { id: string; kind: "grade-band"; thresholds: number[] }
      | {
          id: string;
          kind: "status";
          values: Array<"passed" | "failed" | "missing">;
        },
    metric: CardMetric = "average",
  ) => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric, goalId: null },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 8,
      },
      split,
    ];
    definition.visualization = createWidgetVisualization("bar", {
      dimensionId: "group",
      measureId: "measure",
    });
    definition.visualization.encoding.x = {
      field: "group",
      type: "nominal",
    };
    definition.visualization.encoding.series = {
      field: split.id,
      type: "nominal",
    };
    return definition;
  };

  test("materialises subject × grade-band and subject × status", () => {
    const definitions = [
      subjectCross({ id: "band", kind: "grade-band", thresholds: [0.5] }),
      subjectCross({
        id: "status",
        kind: "status",
        values: ["passed", "failed"],
      }),
    ];

    for (const definition of definitions) {
      const compiled = compileWidgetDefinition(definition, {
        surface: "insights",
      });
      expect(compiled.valid).toBe(true);
      const result = evaluateWidgetDefinition(definition, context());
      expect(result.kind).toBe("data-frame");
      if (result.kind !== "data-frame") continue;
      expect(result.frame.schema.dimensions.map((item) => item.id)).toEqual([
        "group",
        definition.analysis.dimensions[1]?.id,
      ]);
      // Two subjects crossed with two configured inner categories, including the null
      // cells: absence in one band must not erase the domain member.
      expect(result.frame.rows).toHaveLength(4);
    }
  });

  test("materialises missing only for subject coverage", () => {
    const unassessed: Subject = {
      id: "art",
      name: "Art",
      shortName: null,
      parentId: null,
      coefficient: 1,
      kind: "subject",
      isMain: true,
      sortOrder: 2,
      grades: [],
    };
    const scoped = [...subjects, unassessed];
    const graph = new SubjectGraph(scoped);
    const evaluationContext: WidgetEvaluationContext = {
      ...context(),
      subjects: scoped,
      yearSubjects: scoped,
      graph,
      resolveTarget: () => ({
        graph,
        subjects: scoped,
        scope: null,
        subjectId: null,
      }),
    };
    const definition = subjectCross(
      {
        id: "status",
        kind: "status",
        values: ["passed", "failed", "missing"],
      },
      "coverage",
    );

    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).valid,
    ).toBe(true);
    const result = evaluateWidgetDefinition(definition, evaluationContext);
    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    const values = plotted(result);
    const missing = (label: string) =>
      values.find(
        (item) =>
          item.label === label &&
          widgetStatusFromLabel(item.series ?? "") === "missing",
      )?.value;
    expect(missing("Art")).toBe(1);
    expect(missing("Mathematics")).toBe(0);
  });
});

describe("recipe semantic limits", () => {
  const radar = (limit: number) => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit,
      },
    ];
    definition.visualization.recipe = "radar";
    return definition;
  };

  test.each([1, 9])("refuses a radar configured for %i spokes", (limit) => {
    expect(
      compileWidgetDefinition(radar(limit), { surface: "insights" }).issues,
    ).toContainEqual({
      path: "analysis.dimensions.0",
      code: "unsupported",
      messageKey: "widget.error.radar-cardinality",
    });
  });

  test("refuses a materialised radar with fewer than three axes", () => {
    const definition = radar(3);
    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).valid,
    ).toBe(true);
    expect(evaluateWidgetDefinition(definition, context())).toEqual({
      kind: "empty",
      shape: "categorical-series",
      reason: { kind: "insufficient-sample", count: 2, minimum: 3 },
    });
  });
});

describe("global widget row budget", () => {
  test("rejects dimensions × series × measures before transforms", () => {
    const denseSubjects: Subject[] = Array.from(
      { length: 8 },
      (_, subject) => ({
        id: `subject-${subject}`,
        name: `Subject ${subject}`,
        shortName: null,
        parentId: null,
        coefficient: 1,
        kind: "subject" as const,
        isMain: true,
        sortOrder: subject,
        grades: Array.from({ length: 126 }, (_, day) => {
          const at = new Date(2025, 0, day + 1, 12, 0, 0);
          return grade(
            `grade-${subject}-${day}`,
            `subject-${subject}`,
            10 + (subject % 4),
            at.toISOString().slice(0, 10),
          );
        }),
      }),
    );
    const graph = new SubjectGraph(denseSubjects);
    const evaluationContext: WidgetEvaluationContext = {
      ...context(),
      graph,
      subjects: denseSubjects,
      yearSubjects: denseSubjects,
      from: new Date(2025, 0, 1),
      to: new Date(2025, 4, 6, 23, 59, 59),
      year: {
        startsAt: new Date(2025, 0, 1),
        endsAt: new Date(2025, 11, 31, 23, 59, 59),
        scale: 20,
      },
      resolveTarget: () => ({
        graph,
        subjects: denseSubjects,
        scope: null,
        subjectId: null,
      }),
    };
    // Preparing the window reads `now` once. Every scalar cell walk reads it again while
    // building its CardContext, so this accessor proves an over-budget request stops at
    // the structural preflight rather than computing 4 032 values and rejecting them.
    let nowReads = 0;
    Object.defineProperty(evaluationContext, "now", {
      configurable: true,
      get: () => {
        nowReads += 1;
        return new Date(2025, 4, 6, 12, 0, 0);
      },
    });
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      ["average", "average"],
      ["median", "median"],
      ["count", "gradeCount"],
      ["pass", "passRate"],
    ].map(([id, metric]) => ({
      id: id as string,
      label: id as string,
      expression: {
        kind: "metric" as const,
        metric: metric as CardMetric,
        goalId: null,
      },
    }));
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "time",
        grain: "day",
        fill: "observed",
        accumulation: "bucket",
      },
      {
        id: "subject",
        kind: "subject",
        level: "root",
        includeCategories: false,
        limit: 8,
      },
    ];
    definition.analysis.transforms = [{ kind: "cumulative" }];
    definition.visualization = createWidgetVisualization("line", {
      dimensionId: "group",
      measureId: "average",
    });
    definition.visualization.encoding.series = {
      field: "subject",
      type: "nominal",
    };

    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).valid,
    ).toBe(true);
    const result = evaluateWidgetDefinition(definition, evaluationContext);
    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    expect(result.reason).toEqual({
      kind: "complexity-limit",
      actual: 8 * 126 * 4,
      limit: WIDGET_LIMITS.rows,
    });
    expect(nowReads).toBe(1);
  });
});

describe("a second measure is a reading too", () => {
  /**
   * The table is read from the primary because the primary decides the card's shape.
   * That is right, and it made every measure after the first unchecked: a goal gauge
   * asked for beside an average over time compiled cleanly, saved, and drew one series
   * where two were asked for, because `goalProgress` groups by nothing and nobody looked.
   */
  const twoMeasures = (second: CardMetric) => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "primary",
        label: null,
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "secondary",
        label: null,
        expression: { kind: "metric", metric: second, goalId: null },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "axis",
        kind: "time",
        grain: "week",
        fill: "observed",
        accumulation: "bucket",
      },
    ];
    definition.visualization.recipe = "line";
    return compileWidgetDefinition(definition, { surface: "insights" });
  };

  test("refuses one that cannot be drawn on the axis the card uses", () => {
    const compiled = twoMeasures("goalProgress");

    expect(compiled.valid).toBe(false);
    expect(
      compiled.issues.some(
        (found) =>
          found.path === "analysis.measures.1.expression" &&
          found.messageKey === "widget.error.measure-grouping",
      ),
    ).toBe(true);
  });

  test("says nothing about one that can", () => {
    // Both read over time. The fixture is missing labels and channels, so it does not
    // compile — the claim here is only that this check is not what stops it.
    expect(
      twoMeasures("median").issues.filter((found) =>
        found.path.startsWith("analysis.measures.1"),
      ),
    ).toEqual([
      {
        path: "analysis.measures.1.label",
        code: "required",
        messageKey: "widget.error.measure-label",
      },
    ]);
  });
});

describe("every reference the compiler demands, the flow offers", () => {
  /**
   * The two halves have to agree, and twice they did not.
   *
   * `safetyMargin` is in the compiler's `GOAL_METRICS` and was not in the flow's, so the
   * goal picker never appeared and the card could not be saved. The three friend readings
   * are in `MEMBER_METRICS` and the only member control was the cohort's, visible for
   * `memberAverage` alone — same outcome. A metric that requires a reference and offers
   * no way to give one is a metric nobody can use.
   */
  const flowFor = (metric: CardMetric) => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric, goalId: null },
      },
    ];
    return resolveWidgetFlow(definition, { surface: "insights" });
  };

  test.each([
    ["goalProgress", "analysis.measures.0.expression.goalId"],
    ["requiredResult", "analysis.measures.0.expression.goalId"],
    ["safetyMargin", "analysis.measures.0.expression.goalId"],
    ["cohortRank", "analysis.measures.0.expression.groupId"],
    ["memberAverage", "analysis.measures.0.expression.memberId"],
    ["friendAverage", "analysis.measures.0.expression.memberId"],
    ["friendCurves", "analysis.measures.0.expression.memberId"],
    ["friendSubjects", "analysis.measures.0.expression.memberId"],
  ] as Array<[CardMetric, string]>)(
    "%s can be told which one",
    (metric, path) => {
      expect(flowFor(metric).activePaths).toContain(path);
    },
  );

  test("and the friend control is not the cohort's", () => {
    // Two lists, two consents: a group opened itself, a friendship did. Offering one
    // through the other's control would offer people neither rule opened.
    const fields = (metric: CardMetric) => {
      const flow = flowFor(metric);
      return [...flow.definition, ...flow.visualization]
        .flatMap((section) => section.fields)
        .filter(
          (field) =>
            field.active &&
            field.path === "analysis.measures.0.expression.memberId",
        )
        .map((field) => field.optionProvider);
    };

    expect(fields("memberAverage")).toEqual(["cohort-members"]);
    expect(fields("friendAverage")).toEqual(["friends"]);
  });
});

describe("paired-measure contracts", () => {
  test("refuses independent measures when no result frame can carry them", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "median",
        label: "Median",
        expression: { kind: "metric", metric: "median", goalId: null },
      },
    ];

    expect(
      compileWidgetDefinition(definition, { surface: "overview" }).issues,
    ).toContainEqual({
      path: "analysis.measures",
      code: "unsupported",
      messageKey: "widget.error.multiple-measures-need-dimension",
    });
  });
  test("refuses a distribution as a scatter axis instead of materializing nulls", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "distribution",
        label: "Distribution",
        expression: {
          kind: "metric",
          metric: "distribution",
          goalId: null,
        },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 10,
      },
    ];
    definition.visualization.recipe = "scatter";

    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).issues,
    ).toContainEqual({
      path: "analysis.measures.1.expression",
      code: "unsupported",
      messageKey: "widget.error.measure-shape",
    });
  });

  test("checks the selected comparison against the second measure", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "ranking",
        label: "Ranking",
        expression: {
          kind: "metric",
          metric: "subjectRanking",
          goalId: null,
        },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 10,
      },
    ];
    definition.analysis.comparison = { kind: "previous-window" };
    definition.visualization.recipe = "scatter";

    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).issues,
    ).toContainEqual({
      path: "analysis.measures.1.expression",
      code: "unsupported",
      messageKey: "widget.error.measure-comparison",
    });
  });

  test.each([
    ["scatter", "widget.error.scatter-needs-two"],
    ["difference-area", "widget.error.difference-needs-two"],
  ] as const)("requires exactly two measures for %s", (recipe, messageKey) => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "median",
        label: "Median",
        expression: { kind: "metric", metric: "median", goalId: null },
      },
      {
        id: "improvement",
        label: "Improvement",
        expression: {
          kind: "metric",
          metric: "improvement",
          goalId: null,
        },
      },
    ];
    if (recipe === "scatter") {
      definition.analysis.dimensions = [
        {
          id: "subject",
          kind: "subject",
          level: "leaf",
          includeCategories: false,
          limit: 10,
        },
      ];
    }
    definition.visualization.recipe = recipe;

    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).issues,
    ).toContainEqual({
      path: "visualization.recipe",
      code: "unsupported",
      messageKey,
    });
  });

  test("refuses missing status for a measure that cannot quantify absence", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 10,
      },
      {
        id: "status",
        kind: "status",
        values: ["passed", "failed", "missing"],
      },
    ];
    definition.visualization.recipe = "bar";
    definition.visualization.encoding = {
      x: { field: "subject", type: "nominal" },
      y: { field: "measure", type: "quantitative" },
      color: null,
      series: null,
      facet: null,
    };

    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).issues,
    ).toContainEqual({
      path: "analysis.dimensions.1.values",
      code: "unsupported",
      messageKey: "widget.error.missing-status-measure",
    });
  });

  test("round-trips a valid multi-measure line without dropping its reading", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "median",
        label: "Median",
        expression: { kind: "metric", metric: "median", goalId: null },
      },
    ];
    definition.visualization.recipe = "line";

    const flow = resolveWidgetFlow(definition, { surface: "insights" });

    expect(flow.prunedDefinition.analysis.measures).toEqual(
      definition.analysis.measures,
    );
    expect(
      compileWidgetDefinition(flow.prunedDefinition, {
        surface: "insights",
      }).valid,
    ).toBe(true);
  });

  test("keeps a complete second measure when a scatter becomes a bar", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "median",
        label: "Median",
        expression: { kind: "metric", metric: "median", goalId: null },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 10,
      },
    ];
    definition.visualization.recipe = "scatter";
    const scatter = resolveWidgetFlow(definition, {
      surface: "insights",
    }).prunedDefinition;
    const changed = {
      ...scatter,
      visualization: { ...scatter.visualization, recipe: "bar" as const },
    };

    const flow = resolveWidgetFlow(changed, { surface: "insights" });

    expect(flow.prunedDefinition.analysis.measures).toEqual(
      definition.analysis.measures,
    );
    expect(
      compileWidgetDefinition(flow.prunedDefinition, {
        surface: "insights",
      }).valid,
    ).toBe(true);
  });

  test("offers every field required to author a secondary formula", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "target",
        label: "Target",
        expression: {
          kind: "formula",
          valueType: "ratio",
          formula: { kind: "literal", value: 0.75 },
        },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 10,
      },
    ];
    definition.visualization.recipe = "scatter";

    const flow = resolveWidgetFlow(definition, { surface: "insights" });

    expect(flow.activePaths).toContain(
      "analysis.measures.1.expression.valueType",
    );
    expect(flow.activePaths).toContain(
      "analysis.measures.1.expression.formula",
    );
    expect(flow.activePaths).not.toContain(
      "analysis.measures.1.expression.metric",
    );
    expect(
      compileWidgetDefinition(flow.prunedDefinition, {
        surface: "insights",
      }).valid,
    ).toBe(true);
  });

  test("does not offer a secondary metric that cannot become a frame value", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "median",
        label: "Median",
        expression: { kind: "metric", metric: "median", goalId: null },
      },
    ];
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 10,
      },
    ];
    definition.visualization.recipe = "scatter";

    const field = resolveWidgetFlow(definition, { surface: "insights" })
      .definition.flatMap((section) => section.fields)
      .find((candidate) => candidate.id === "second-metric");

    expect(field?.options.map((option) => option.value)).not.toContain(
      "distribution",
    );
  });
});

describe("authored formula units", () => {
  test("keeps rows materialised only by a secondary measure", () => {
    const frame = widgetFrameFromSeries(
      [
        {
          measure: {
            id: "average",
            label: "Average",
            expression: { kind: "metric", metric: "average", goalId: null },
          },
          values: [
            {
              key: "first",
              label: "First",
              date: null,
              value: 0.5,
              delta: null,
              count: 1,
              series: null,
            },
          ],
        },
        {
          measure: {
            id: "count",
            label: "Count",
            expression: {
              kind: "metric",
              metric: "gradeCount",
              goalId: null,
            },
          },
          values: [
            {
              key: "second",
              label: "Second",
              date: null,
              value: 1,
              delta: null,
              count: 1,
              series: null,
            },
          ],
        },
      ],
      [
        {
          id: "subject",
          kind: "subject",
          level: "leaf",
          includeCategories: false,
          limit: 8,
        },
      ],
    );

    expect(frame.rows.map((row) => row.key)).toEqual(["first", "second"]);
    expect(frame.rows[1]?.measures.count).toBe(1);
    expect(frame.rows[1]?.measures.average).toBeUndefined();
  });
  test("carries a formula value type into its frame value and delta columns", () => {
    const frame = widgetFrameFromSeries(
      [
        {
          measure: {
            id: "rate",
            label: "Rate",
            expression: {
              kind: "formula",
              valueType: "percent",
              formula: { kind: "literal", value: 0.5 },
            },
          },
          values: [
            {
              key: "math",
              label: "Math",
              date: null,
              value: 0.5,
              delta: 0.1,
              count: 1,
              series: null,
            },
          ],
        },
      ],
      [
        {
          id: "subject",
          kind: "subject",
          level: "leaf",
          includeCategories: false,
          limit: 10,
        },
      ],
    );

    expect(frame.schema.measures).toEqual([
      { id: "rate", type: "number", valueType: "percent" },
      { id: "rate.delta", type: "number", valueType: "percent" },
      { id: "rate.count", type: "number", valueType: "count" },
    ]);
  });

  test("accepts a difference area when a formula declares the primary unit", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "average",
        label: "Average",
        expression: { kind: "metric", metric: "average", goalId: null },
      },
      {
        id: "target",
        label: "Target",
        expression: {
          kind: "formula",
          valueType: "ratio",
          formula: { kind: "literal", value: 0.75 },
        },
      },
    ];
    definition.visualization.recipe = "difference-area";

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });

    expect(
      compiled.issues.filter(
        (issue) =>
          issue.messageKey === "widget.error.difference-needs-one-unit",
      ),
    ).toEqual([]);
    expect(compiled.valid).toBe(true);
  });
});

describe("social template slots", () => {
  test("collects and remaps cohort members separately from friends", () => {
    const cohort = createWidgetDefinition("overview");
    cohort.analysis.measures = [
      {
        id: "member",
        label: null,
        expression: {
          kind: "metric",
          metric: "memberAverage",
          goalId: null,
          groupId: "class-a",
          memberId: "classmate-a",
        },
      },
    ];
    const friend = createWidgetDefinition("overview");
    friend.analysis.measures = [
      {
        id: "friend",
        label: null,
        expression: {
          kind: "metric",
          metric: "friendAverage",
          goalId: null,
          memberId: "friend-a",
        },
      },
    ];

    expect(collectWidgetReferences(cohort)).toMatchObject({
      cohortIds: ["class-a"],
      cohortMemberIds: ["classmate-a"],
      friendIds: [],
    });
    expect(templateSlots(cohort)).toEqual([
      { kind: "cohort", placeholderId: "class-a" },
      { kind: "cohort-member", placeholderId: "classmate-a" },
    ]);
    expect(collectWidgetReferences(friend)).toMatchObject({
      cohortIds: [],
      cohortMemberIds: [],
      friendIds: ["friend-a"],
    });
    expect(templateSlots(friend)).toEqual([
      {
        kind: "friend",
        placeholderId: "friend-a",
        friendRequirement: "generalAverage",
      },
    ]);

    const mixed = createWidgetDefinition("overview");
    mixed.analysis.measures = [
      {
        id: "member",
        label: "Classmate",
        expression: {
          kind: "metric",
          metric: "memberAverage",
          goalId: null,
          groupId: "class-a",
          memberId: "shared-user",
        },
      },
      {
        id: "friend",
        label: "Friend",
        expression: {
          kind: "metric",
          metric: "friendAverage",
          goalId: null,
          memberId: "shared-user",
        },
      },
    ];
    const slots = templateSlots(mixed);
    const mapping = resolveSlotMapping(
      slots,
      {
        subject: [],
        "custom-average": [],
        goal: [],
        period: [],
        cohort: [{ value: "class-b" }],
        "cohort-member": [{ value: "classmate-b" }],
        friend: [{ value: "friend-b" }],
      },
      // A legacy pick cannot say which relationship this shared user id refers to. It
      // must not override both kind-specific defaults.
      new Map([["shared-user", "ambiguous-legacy-pick"]]),
    );
    const remapped = substituteSlots(mixed, mapping);

    expect(
      mapping.get(
        templateSlotKey({
          kind: "cohort-member",
          placeholderId: "shared-user",
        }),
      ),
    ).toBe("classmate-b");
    expect(
      mapping.get(
        templateSlotKey({
          kind: "friend",
          placeholderId: "shared-user",
          friendRequirement: "generalAverage",
        }),
      ),
    ).toBe("friend-b");
    expect(mapping.has("shared-user")).toBe(false);
    expect(
      remapped.analysis.measures.map((entry) =>
        entry.expression.kind === "metric" ? entry.expression.memberId : null,
      ),
    ).toEqual(["classmate-b", "friend-b"]);
  });

  test("keeps each friend sharing requirement as a distinct dependent slot", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "average",
        label: null,
        expression: {
          kind: "metric",
          metric: "friendAverage",
          goalId: null,
          memberId: "author-friend",
        },
      },
      {
        id: "curves",
        label: null,
        expression: {
          kind: "metric",
          metric: "friendCurves",
          goalId: null,
          memberId: "author-friend",
        },
      },
      {
        id: "subjects",
        label: null,
        expression: {
          kind: "metric",
          metric: "friendSubjects",
          goalId: null,
          memberId: "author-friend",
        },
      },
    ];

    const slots = templateSlots(definition);
    expect(slots).toEqual([
      {
        kind: "friend",
        placeholderId: "author-friend",
        friendRequirement: "generalAverage",
      },
      {
        kind: "friend",
        placeholderId: "author-friend",
        friendRequirement: "history",
      },
      {
        kind: "friend",
        placeholderId: "author-friend",
        friendRequirement: "subjects",
      },
    ]);

    const averageKey = templateSlotKey(slots[0]!);
    const historyKey = templateSlotKey(slots[1]!);
    const subjectsKey = templateSlotKey(slots[2]!);
    const mapping = resolveSlotMapping(
      slots,
      {
        subject: [],
        "custom-average": [],
        goal: [],
        period: [],
        cohort: [],
        "cohort-member": [],
        friend: [],
      },
      new Map([
        [averageKey, "friend-average"],
        [historyKey, "friend-without-history"],
      ]),
      (slot) => {
        switch (slot.friendRequirement) {
          case "generalAverage":
            return [{ value: "friend-average" }];
          case "history":
            return [{ value: "friend-history" }];
          case "subjects":
            return [{ value: "friend-subjects" }];
          default:
            return undefined;
        }
      },
    );

    expect(mapping.get(averageKey)).toBe("friend-average");
    expect(mapping.get(historyKey)).toBe("friend-history");
    expect(mapping.get(subjectsKey)).toBe("friend-subjects");
    expect(mapping.has("author-friend")).toBe(false);
    expect(
      substituteSlots(definition, mapping).analysis.measures.map((measure) =>
        measure.expression.kind === "metric"
          ? measure.expression.memberId
          : null,
      ),
    ).toEqual(["friend-average", "friend-history", "friend-subjects"]);
  });

  test("drops a stale dependent pick when its current option set changes", () => {
    const slot = { kind: "cohort-member", placeholderId: "member-a" } as const;
    const key = templateSlotKey(slot);
    const mapping = resolveSlotMapping(
      [slot],
      {
        subject: [],
        "custom-average": [],
        goal: [],
        period: [],
        cohort: [],
        "cohort-member": [{ value: "member-b" }],
        friend: [],
      },
      new Map([[key, "member-from-previous-class"]]),
    );

    expect(mapping.get(key)).toBe("member-b");
  });
});
