import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import {
  createWidgetDefinition,
  createWidgetVisualization,
} from "./widget-defaults";
import { compileWidgetDefinition } from "./widget-definition";
import { evaluateWidgetDefinition } from "./widget-evaluator";
import { widgetFrameSeries } from "./widget-frame";
import {
  widgetRecipeAtWidth,
  widgetRecipeDescriptor,
  widgetRecipeForPlatform,
} from "./widget-recipes";
import { WIDGET_LIMITS } from "./widget-types";
import type {
  WidgetDefinition,
  WidgetEvaluationContext,
  WidgetMeasureEntry,
  WidgetResultShape,
} from "./widget-types";
import type { Grade, GradeType, Subject } from "./types";

function grade(
  id: string,
  subjectId: string,
  value: number,
  passedAt: string,
  typeId: string | null = null,
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
    typeId,
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

const gradeTypes: GradeType[] = [
  {
    id: "quiz",
    name: "Quiz",
    titlePrefix: "",
    coefficient: 1,
    outOf: 20,
    accent: null,
    sortOrder: 0,
  },
  {
    id: "exam",
    name: "Exam",
    titlePrefix: "",
    coefficient: 1,
    outOf: 20,
    accent: null,
    sortOrder: 1,
  },
];

const crossedSubjects: Subject[] = [
  subject("math", [
    grade("math-fail", "math", 8, "2026-01-02", "quiz"),
    grade("math-pass", "math", 18, "2026-01-03", "exam"),
  ]),
  subject("science", [
    grade("science-pass", "science", 14, "2026-01-04", "quiz"),
    grade("science-high", "science", 20, "2026-01-05", "exam"),
  ]),
  subject("art", []),
];

function evaluationContext(
  subjects: Subject[] = crossedSubjects,
  from = new Date("2026-01-01T00:00:00"),
  to = new Date("2026-12-31T23:59:59"),
): WidgetEvaluationContext {
  const graph = new SubjectGraph(subjects);
  return {
    surface: "insights",
    graph,
    subjects,
    scope: null,
    from,
    to,
    year: { startsAt: from, endsAt: to, scale: 20 },
    yearSubjects: subjects,
    periods: [],
    customAverages: [],
    gradeTypes,
    passingRatio: 0.5,
    goals: [],
    now: to,
    resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
  };
}

function measure(
  id: string,
  metric: Extract<
    WidgetMeasureEntry["expression"],
    { kind: "metric" }
  >["metric"],
): WidgetMeasureEntry {
  return {
    id,
    label: id,
    expression: { kind: "metric", metric, goalId: null },
  };
}

function subjectCross(
  split: WidgetDefinition["analysis"]["dimensions"][number],
  metric: Extract<
    WidgetMeasureEntry["expression"],
    { kind: "metric" }
  >["metric"] = "average",
): WidgetDefinition {
  const definition = createWidgetDefinition("insights");
  definition.analysis.measures = [measure("value", metric)];
  definition.analysis.dimensions = [
    {
      id: "subject",
      kind: "subject",
      level: "leaf",
      includeCategories: false,
      limit: 8,
    },
    split,
  ];
  definition.visualization = createWidgetVisualization("bar", {
    dimensionId: "subject",
    measureId: "value",
  });
  definition.visualization.encoding.x = {
    field: "subject",
    type: "nominal",
  };
  definition.visualization.encoding.series = {
    field: split.id,
    type: "nominal",
  };
  return definition;
}

const PLOT_SLOTS = {
  x: null,
  y: "value",
  color: null,
  series: null,
  facet: null,
} as const;

describe("audit execution invariants", () => {
  test("refuses several scalar measures instead of dropping all but the first", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      measure("average", "average"),
      measure("median", "median"),
    ];

    const compiled = compileWidgetDefinition(definition, {
      surface: "overview",
    });

    expect(compiled.valid).toBe(false);
    expect(compiled.issues).toContainEqual(
      expect.objectContaining({
        path: "analysis.measures",
        messageKey: "widget.error.multiple-measures-need-dimension",
      }),
    );
  });

  test("keeps a grouped distribution as a distribution in plan and result", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [measure("distribution", "distribution")];
    definition.analysis.dimensions = [
      {
        id: "subject",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 8,
      },
    ];
    definition.visualization = createWidgetVisualization("violin", {
      dimensionId: "subject",
      measureId: "distribution",
    });

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });
    const result = evaluateWidgetDefinition(definition, evaluationContext());

    expect(compiled.valid).toBe(true);
    expect(compiled.plan?.resultShape).toBe("distribution");
    expect(result.shape).toBe("distribution");
    expect(result.kind).toBe("distribution-set");
  });

  test("never follows a platform or width fallback that rejects the result", () => {
    const cases: Array<{
      recipe: Parameters<typeof widgetRecipeAtWidth>[0];
      shape: WidgetResultShape;
    }> = [
      { recipe: "bar", shape: "temporal-series" },
      { recipe: "bar", shape: "categorical-series" },
      { recipe: "treemap", shape: "hierarchy" },
      { recipe: "waterfall", shape: "waterfall" },
      { recipe: "projection-band", shape: "interval-series" },
    ];

    for (const { recipe, shape } of cases) {
      const narrow = widgetRecipeAtWidth(recipe, 1, 4, shape);
      const mobile = widgetRecipeForPlatform(recipe, "mobile", shape);
      expect(
        widgetRecipeDescriptor(narrow).acceptedResults,
        `${recipe} narrow`,
      ).toContain(shape);
      expect(
        widgetRecipeDescriptor(mobile).acceptedResults,
        `${recipe} mobile`,
      ).toContain(shape);
    }

    expect(widgetRecipeAtWidth("bar", 1, 4, "temporal-series")).toBe("bar");
    expect(widgetRecipeAtWidth("bar", 1, 4, "categorical-series")).toBe(
      "lollipop",
    );
    expect(
      widgetRecipeForPlatform("projection-band", "mobile", "interval-series"),
    ).toBe("line");
  });

  test.each([
    {
      name: "assessment type",
      split: {
        id: "type",
        kind: "assessment-type",
        includeUntyped: false,
      } as WidgetDefinition["analysis"]["dimensions"][number],
      expectedSeries: ["Exam", "Quiz"],
    },
    {
      name: "grade band",
      split: {
        id: "band",
        kind: "grade-band",
        thresholds: [0.5],
      } as WidgetDefinition["analysis"]["dimensions"][number],
      expectedSeries: ["0–10", "10–20"],
    },
    {
      name: "status",
      split: {
        id: "status",
        kind: "status",
        values: ["passed", "failed"],
      } as WidgetDefinition["analysis"]["dimensions"][number],
      expectedSeries: ["__status:failed__", "__status:passed__"],
    },
  ])(
    "materialises subject × $name as a real cross-product",
    ({ split, expectedSeries }) => {
      const definition = subjectCross(split);
      const compiled = compileWidgetDefinition(definition, {
        surface: "insights",
      });
      const result = evaluateWidgetDefinition(definition, evaluationContext());

      expect(compiled.valid).toBe(true);
      expect(result.kind).toBe("data-frame");
      if (result.kind !== "data-frame") return;
      const values = widgetFrameSeries(result.frame, PLOT_SLOTS);
      expect(new Set(values.map((entry) => entry.label))).toEqual(
        new Set(["math", "science", "art"]),
      );
      expect(new Set(values.map((entry) => entry.series))).toEqual(
        new Set(expectedSeries),
      );
    },
  );

  test("gives missing an explicit completed coverage domain and refuses it elsewhere", () => {
    const coverage = subjectCross(
      { id: "status", kind: "status", values: ["missing"] },
      "coverage",
    );
    const compiled = compileWidgetDefinition(coverage, {
      surface: "insights",
    });
    const result = evaluateWidgetDefinition(coverage, evaluationContext());

    expect(compiled.valid).toBe(true);
    expect(result.kind).toBe("data-frame");
    if (result.kind !== "data-frame") return;
    expect(
      widgetFrameSeries(result.frame, PLOT_SLOTS)
        .map(({ label, value }) => ({
          label,
          value,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    ).toEqual([
      { label: "art", value: 1 },
      { label: "math", value: 0 },
      { label: "science", value: 0 },
    ]);

    const average = subjectCross({
      id: "status",
      kind: "status",
      values: ["missing"],
    });
    expect(
      compileWidgetDefinition(average, { surface: "insights" }).issues,
    ).toContainEqual(
      expect.objectContaining({
        path: "analysis.dimensions.1.values",
        messageKey: "widget.error.missing-status-measure",
      }),
    );
  });

  test("canonicalises calendar to day + calendar and bounds radar axes", () => {
    const calendar = createWidgetDefinition("insights");
    calendar.visualization = createWidgetVisualization("calendar", {
      dimensionId: "group",
      measureId: "measure",
    });
    const compiledCalendar = compileWidgetDefinition(calendar, {
      surface: "insights",
    });
    expect(compiledCalendar.valid).toBe(true);
    expect(
      compiledCalendar.plan?.definition.analysis.dimensions[0],
    ).toMatchObject({
      kind: "time",
      grain: "day",
      fill: "calendar",
    });

    for (const limit of [2, 9]) {
      const radar = subjectCross({
        id: "status",
        kind: "status",
        values: ["passed", "failed"],
      });
      radar.analysis.dimensions = [
        {
          id: "subject",
          kind: "subject",
          level: "leaf",
          includeCategories: false,
          limit,
        },
      ];
      radar.visualization = createWidgetVisualization("radar", {
        dimensionId: "subject",
        measureId: "value",
      });
      expect(
        compileWidgetDefinition(radar, { surface: "insights" }).issues,
      ).toContainEqual(
        expect.objectContaining({
          messageKey: "widget.error.radar-cardinality",
        }),
      );
    }
  });

  test("applies the global cell budget to dimensions crossed with measures", () => {
    const from = new Date("2025-01-01T00:00:00");
    const to = new Date(from);
    to.setDate(to.getDate() + 500);
    const budgetSubjects = crossedSubjects.slice(0, 2);
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      measure("average", "average"),
      measure("median", "median"),
      measure("count", "gradeCount"),
      measure("pass", "passRate"),
    ];
    definition.analysis.dimensions = [
      {
        id: "day",
        kind: "time",
        grain: "day",
        accumulation: "bucket",
        fill: "calendar",
      },
      {
        id: "subject",
        kind: "subject",
        level: "root",
        includeCategories: false,
        limit: 2,
      },
    ];
    definition.visualization = createWidgetVisualization("line", {
      dimensionId: "day",
      measureId: "average",
    });
    definition.visualization.encoding.series = {
      field: "subject",
      type: "nominal",
    };

    const result = evaluateWidgetDefinition(
      definition,
      evaluationContext(budgetSubjects, from, to),
    );

    expect(result).toEqual({
      kind: "empty",
      shape: "temporal-series",
      reason: {
        kind: "complexity-limit",
        actual: 4_008,
        limit: WIDGET_LIMITS.rows,
      },
    });
  });
});
