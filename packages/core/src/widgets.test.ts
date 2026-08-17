import { describe, expect, test } from "bun:test";
import { CARD_METRICS, type CardResult } from "./cards";
import { SubjectGraph } from "./graph";
import { widgetLiveStreak, type WidgetEvaluationResult } from "./widget-types";
import {
  canonicalizeWidgetDefinition,
  collectWidgetReferences,
  compileWidgetDefinition,
  validateWidgetDefinition,
} from "./widget-definition";
import {
  createWidgetDefinition,
  defaultInsightWidgets,
  widgetDefinitionFromCard,
  cardSemanticsFromDefinition,
} from "./widget-defaults";
import { evaluateWidgetDefinition } from "./widget-evaluator";
import { evaluateWidgetFormula, parseWidgetFormula } from "./widget-formula";
import { resolveWidgetFlow } from "./widget-flow";
import { WIDGET_CAPABILITIES, widgetCompatibleMarks } from "./widget-registry";
import { WIDGET_LIMITS } from "./widget-types";
import type {
  WidgetDefinitionV1,
  WidgetEvaluationContext,
  WidgetFormula,
} from "./widget-types";
import type { Grade, Subject } from "./types";

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

    expect(spark.visualization.mark).toBe("area");
    expect(spark.visualization.axes).toEqual({
      x: { visible: false, grid: false, label: null },
      y: { visible: false, grid: false, label: null },
    });
    // Both still walk time, so both have a curve to draw.
    expect(spark.analysis.groupBy.kind).toBe("time");
    expect(chart.analysis.groupBy.kind).toBe("time");

    // And a card that asked for a chart keeps one.
    expect(chart.visualization.mark).toBe("line");
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
      expect(["line", "area"], display).not.toContain(
        definition.visualization.mark,
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
  test("mark changes replace incompatible option objects canonically", () => {
    const definition = createWidgetDefinition("insights");
    const changed = {
      ...definition,
      visualization: {
        ...definition.visualization,
        mark: "bar",
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
    definition.analysis.groupBy = { kind: "none" };
    definition.visualization.mark = "value";
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
    streak.analysis.measure = {
      kind: "metric",
      metric: "activityStreak",
      goalId: null,
    };
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
    definition.visualization.mark = "line";
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
    expect(
      encodingFields.find((field) => field.id === "encoding-series")?.options,
    ).toEqual([{ value: "category", messageKey: "widget.encoding.category" }]);
    expect(
      encodingFields
        .find((field) => field.id === "encoding-y")
        ?.options.map((option) => option.value),
    ).toEqual(["value", "count"]);
    definition.analysis.comparison = { kind: "baseline", value: 0.5 };
    const comparedY = resolveWidgetFlow(definition, {
      surface: "insights",
      options: { subjects: [{ value: "math", messageKey: "Math" }] },
    })
      .visualization.flatMap((section) => section.fields)
      .find((field) => field.id === "encoding-y");
    expect(comparedY?.options.map((option) => option.value)).toEqual([
      "value",
      "delta",
      "count",
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
    goal.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "goal-1",
    };
    expect(collectWidgetReferences(goal).goalIds).toEqual(["goal-1"]);
  });

  test("changing away from goal progress removes the stale goal reference", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measure = {
      kind: "metric",
      metric: "average",
      goalId: "old-goal",
    };

    const canonical = canonicalizeWidgetDefinition(definition, {
      surface: "overview",
    });
    expect(canonical.analysis.measure).toEqual({
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
    definition.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "goal-1",
    };

    const flow = resolveWidgetFlow(definition, {
      surface: "overview",
      options: { goals: [{ value: "goal-1", messageKey: "Goal" }] },
    });
    const active = flow.activePaths;
    expect(active).toContain("analysis.measure.goalId");
    expect(active).not.toContain("query.scope.kind");
    expect(active).not.toContain("query.window.kind");
    expect(active).not.toContain("query.filters");
    expect(active).not.toContain("analysis.groupBy.kind");
    expect(active).not.toContain("analysis.comparison.kind");
    expect(active).not.toContain("visualization.mark");
    expect(flow.prunedDefinition.query.scope).toEqual({ kind: "general" });
    expect(collectWidgetReferences(flow.prunedDefinition)).toEqual({
      subjectIds: [],
      customAverageIds: [],
      goalIds: ["goal-1"],
      periodIds: [],
    });
  });

  test("capabilities prevent nonsensical chart combinations", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measure = {
      kind: "metric",
      metric: "lastGrade",
      goalId: null,
    };
    definition.visualization.mark = "histogram";
    const compiled = compileWidgetDefinition(definition, {
      surface: "overview",
    });
    expect(compiled.valid).toBe(false);
    expect(
      compiled.issues.some((item) => item.path === "visualization.mark"),
    ).toBe(true);
    expect(
      widgetCompatibleMarks(definition.analysis.measure, { kind: "none" }),
    ).toEqual(["value"]);
  });

  test("scalar and record measures never advertise fake one-point charts", () => {
    expect(
      widgetCompatibleMarks(
        { kind: "metric", metric: "average" },
        { kind: "none" },
      ),
    ).toEqual(["value", "gauge"]);
    expect(
      widgetCompatibleMarks(
        { kind: "metric", metric: "spread" },
        { kind: "none" },
      ),
    ).toEqual(["value"]);
    expect(
      widgetCompatibleMarks(
        { kind: "metric", metric: "goalProgress" },
        { kind: "none" },
      ),
    ).toEqual(["gauge"]);
  });

  test("encoding channels reject fields the evaluator cannot materialize", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.encoding.y = {
      field: "category",
      type: "nominal",
    };
    definition.visualization.encoding.series = {
      field: "value",
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
      field: "delta",
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
    definition.analysis.measure = {
      kind: "metric",
      metric: "distribution",
      goalId: null,
    };
    definition.analysis.groupBy = { kind: "none" };
    definition.visualization.mark = "histogram";

    let flow = resolveWidgetFlow(definition, { surface: "insights" });
    let y = flow.visualization
      .flatMap((section) => section.fields)
      .find((field) => field.id === "encoding-y");
    expect(y).toBeUndefined();

    definition.visualization.mark = "bar";
    definition.visualization.encoding.y = {
      field: "count",
      type: "quantitative",
    };
    flow = resolveWidgetFlow(definition, { surface: "insights" });
    y = flow.visualization
      .flatMap((section) => section.fields)
      .find((field) => field.id === "encoding-y");
    expect(y?.options.map((option) => option.value)).toEqual(["count"]);
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
    bars.visualization.mark = "bar";
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

    bars.visualization.encoding.series = {
      field: "category",
      type: "nominal",
    };
    expect(
      resolveWidgetFlow(bars, { surface: "insights" }).activePaths,
    ).toContain("visualization.options.stacked");
  });

  test("subject grouping exposes only transformations with subject semantics", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.groupBy = {
      kind: "subject",
      limit: 10,
      includeCategories: false,
    };
    definition.visualization.mark = "bar";
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
    definition.analysis.measure = {
      kind: "formula",
      formula: { kind: "literal", value: null } as unknown as WidgetFormula,
      valueType: "number",
    };

    const flow = resolveWidgetFlow(definition, { surface: "overview" });
    expect(flow.issues).toContainEqual(
      expect.objectContaining({ path: "analysis.measure.formula.value" }),
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
    definition.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "science-p1",
    };
    definition.visualization.mark = "gauge";
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
    definition.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "new-goal",
    };
    definition.visualization.mark = "gauge";
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
    definition.analysis.groupBy = { kind: "none" };
    definition.visualization.mark = "value";
    definition.analysis.measure = {
      kind: "formula",
      formula: { kind: "literal", value: 5 },
      valueType: "number",
    };
    expect(evaluateWidgetDefinition(definition, emptyContext)).toMatchObject({
      kind: "scalar",
      value: 5,
    });

    definition.analysis.measure.formula = {
      kind: "aggregate",
      operation: "count",
      field: "ratio",
    };
    expect(evaluateWidgetDefinition(definition, emptyContext)).toMatchObject({
      kind: "scalar",
      value: 0,
    });
  });

  test("missing period references fail closed", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.groupBy = { kind: "none" };
    definition.visualization.mark = "value";
    definition.query.window = { kind: "period", periodId: "deleted" };

    expect(evaluateWidgetDefinition(definition, context())).toEqual({
      kind: "empty",
      shape: "scalar",
    });
  });

  test("windows and filters are applied before aggregation", () => {
    const rolling = createWidgetDefinition("insights");
    rolling.analysis.groupBy = { kind: "none" };
    rolling.visualization.mark = "value";
    rolling.query.window = { kind: "rolling-days", days: 15 };
    expect(evaluateWidgetDefinition(rolling, context())).toMatchObject({
      kind: "scalar",
      value: 1,
    });

    const filtered = createWidgetDefinition("insights");
    filtered.analysis.groupBy = { kind: "none" };
    filtered.visualization.mark = "value";
    filtered.query.window = { kind: "whole-year" };
    filtered.query.filters = [
      { kind: "grade-ratio", operator: "gte", value: 0.8 },
    ];
    expect(evaluateWidgetDefinition(filtered, context())).toMatchObject({
      kind: "scalar",
      value: 0.95,
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
    definition.analysis.groupBy = { kind: "none" };
    definition.visualization.mark = "value";

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
    wholeYear.analysis.groupBy = { kind: "none" };
    wholeYear.visualization.mark = "value";
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
    period.analysis.groupBy = { kind: "none" };
    period.visualization.mark = "value";
    const periodResult = evaluateWidgetDefinition(period, boundaryContext);
    expect(periodResult.kind).toBe("scalar");
    if (periodResult.kind === "scalar") {
      expect(periodResult.value).toBeCloseTo(0.7);
    }
  });

  test("time grouping produces real bucket and running series", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.window = { kind: "whole-year" };
    definition.analysis.groupBy = {
      kind: "time",
      interval: "month",
      accumulation: "bucket",
    };
    let result = evaluateWidgetDefinition(definition, context());
    expect(result.kind).toBe("series");
    if (result.kind === "series") {
      expect(result.values.map((item) => item.value)).toEqual([0.7, 1]);
    }

    definition.analysis.groupBy.accumulation = "running";
    result = evaluateWidgetDefinition(definition, context());
    if (result.kind === "series") {
      expect(result.values[0]?.value).toBeCloseTo(0.7);
      expect(result.values[1]?.value).toBeCloseTo(0.775);
      expect(result.values.map((item) => item.count)).toEqual([3, 4]);
    }
  });

  test("a categorical series encoding splits selected subjects into real series", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["math", "science"],
      includeDescendants: true,
    };
    definition.query.window = { kind: "whole-year" };
    definition.analysis.groupBy = {
      kind: "time",
      interval: "month",
      accumulation: "running",
    };
    definition.visualization.encoding.series = {
      field: "category",
      type: "nominal",
    };
    const result = evaluateWidgetDefinition(definition, context());
    expect(result.kind).toBe("series");
    if (result.kind === "series") {
      expect([...new Set(result.values.map((item) => item.series))]).toEqual([
        "Mathematics",
        "Science",
      ]);
      expect(result.values).toHaveLength(3);
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
    definition.analysis.groupBy = {
      kind: "time",
      interval: "day",
      accumulation: "bucket",
    };
    definition.visualization.encoding.series = {
      field: "category",
      type: "nominal",
    };

    const result = evaluateWidgetDefinition(definition, longContext);
    expect(result.kind).toBe("series");
    if (result.kind === "series") {
      expect(result.values).toHaveLength(500);
      for (const label of ["Mathematics", "Science"]) {
        const series = result.values.filter((item) => item.series === label);
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
    definition.analysis.measure = {
      kind: "metric",
      metric: "subjectRanking",
      goalId: null,
    };
    definition.analysis.groupBy = {
      kind: "subject",
      limit: 10,
      includeCategories: false,
    };
    definition.visualization.mark = "list";

    let result = evaluateWidgetDefinition(definition, categorizedContext);
    expect(result.kind).toBe("series");
    if (result.kind === "series") {
      expect(result.values.map((item) => item.key)).not.toContain("stem");
    }

    definition.analysis.groupBy.includeCategories = true;
    result = evaluateWidgetDefinition(definition, categorizedContext);
    expect(result.kind).toBe("series");
    if (result.kind === "series") {
      expect(result.values.map((item) => item.key)).toContain("stem");
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
    definition.analysis.groupBy = {
      kind: "subject",
      limit: 1,
      includeCategories: false,
    };
    definition.analysis.transforms = [
      { kind: "sort", direction: "descending" },
    ];
    definition.visualization.mark = "bar";
    definition.visualization.encoding.x = {
      field: "category",
      type: "nominal",
    };
    definition.visualization.encoding.y = {
      field: "value",
      type: "quantitative",
    };

    const result = evaluateWidgetDefinition(definition, rankedContext);
    expect(result.kind).toBe("series");
    if (result.kind === "series") {
      expect(result.values).toHaveLength(1);
      expect(result.values[0]?.key).toBe("best");
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
    definition.analysis.groupBy = {
      kind: "subject",
      limit: 10,
      includeCategories: false,
    };
    definition.analysis.comparison = { kind: "previous-window" };
    definition.visualization.mark = "bar";
    definition.visualization.encoding.x = {
      field: "category",
      type: "nominal",
    };
    definition.visualization.encoding.y = {
      field: "value",
      type: "quantitative",
    };

    const result = evaluateWidgetDefinition(definition, comparisonContext);
    expect(result.kind).toBe("series");
    if (result.kind === "series") {
      expect(
        result.values.find((item) => item.key === "science")?.delta,
      ).toBeCloseTo(0.3);
      expect(
        result.values.find((item) => item.key === "math")?.delta,
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
    definition.analysis.groupBy = {
      kind: "time",
      interval: "day",
      accumulation: "bucket",
    };
    definition.analysis.comparison = { kind: "previous-window" };
    definition.visualization.encoding.y = {
      field: "delta",
      type: "quantitative",
    };

    const result = evaluateWidgetDefinition(definition, comparisonContext);
    expect(result.kind).toBe("series");
    if (result.kind !== "series") return;
    expect(result.values).toHaveLength(1);
    expect(result.values[0]?.value).toBeCloseTo(0.7);
    expect(result.values[0]?.delta).toBeCloseTo(0.2);
  });

  test("last-grades comparison uses the immediately preceding grade batch", () => {
    const definition = createWidgetDefinition("insights");
    definition.query.window = { kind: "last-grades", count: 2 };
    definition.analysis.groupBy = { kind: "none" };
    definition.analysis.comparison = { kind: "previous-window" };
    definition.visualization.mark = "value";

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
    formula.analysis.groupBy = { kind: "none" };
    formula.analysis.measure = {
      kind: "formula",
      formula: { kind: "aggregate", operation: "mean", field: "ratio" },
      valueType: "ratio",
    };
    formula.visualization.mark = "value";
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

describe("formula metric operands", () => {
  function formulaDefinition(formula: WidgetFormula): WidgetDefinitionV1 {
    const definition = createWidgetDefinition("insights");
    definition.analysis.groupBy = { kind: "none" };
    definition.visualization.mark = "value";
    definition.analysis.measure = {
      kind: "formula",
      formula,
      valueType: "ratio",
    };
    return definition;
  }

  test("a metric operand equals the standalone metric", () => {
    const viaFormula = evaluateWidgetDefinition(
      formulaDefinition({ kind: "metric", metric: "average" }),
      context(),
    );

    const standalone = createWidgetDefinition("insights");
    standalone.analysis.groupBy = { kind: "none" };
    standalone.visualization.mark = "value";
    standalone.analysis.measure = {
      kind: "metric",
      metric: "average",
      goalId: null,
    };
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
