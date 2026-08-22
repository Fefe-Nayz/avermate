import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import { createWidgetDefinition } from "./widget-defaults";
import { compileWidgetDefinition } from "./widget-definition";
import {
  evaluateWidgetDefinition,
  widgetIsUntypedLabel,
} from "./widget-evaluator";
import { widgetFrameSeries } from "./widget-frame";
import type { Grade, GradeType, Subject } from "./types";
import type { WidgetDefinition, WidgetEvaluationContext } from "./widget-types";

/**
 * Grouping by the kind of assessment.
 *
 * The dimension the model has declared since the second version and the compiler refused,
 * because deriving a type from the *name* of a mark would have made a heuristic the
 * canonical truth. A year defines its own kinds now and a result records which one it was,
 * so this reads a stored fact — and what has to hold is that it reads *all* of them,
 * including the results that have no type.
 */

function grade(
  id: string,
  value: number,
  typeId: string | null,
): Grade {
  const at = new Date(2026, 0, 10, 12, 0, 0);
  return {
    id,
    name: id,
    value,
    outOf: 20,
    coefficient: 1,
    passedAt: at,
    createdAt: at,
    subjectId: "maths",
    periodId: null,
    typeId,
    note: null,
    components: [],
  };
}

const subjects: Subject[] = [
  {
    id: "maths",
    name: "Mathematics",
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: true,
    sortOrder: 0,
    grades: [
      grade("ds1", 16, "written"),
      grade("ds2", 14, "written"),
      grade("oral1", 8, "oral"),
      grade("oral2", 10, "oral"),
      // Written before the year had types, or its type was deleted.
      grade("old", 12, null),
    ],
  },
];

const gradeTypes: GradeType[] = [
  {
    id: "written",
    name: "DS",
    titlePrefix: "DS ",
    coefficient: 2,
    outOf: 20,
    accent: null,
    sortOrder: 0,
  },
  {
    id: "oral",
    name: "Colle",
    titlePrefix: "Colle ",
    coefficient: 1,
    outOf: 20,
    accent: null,
    sortOrder: 1,
  },
];

function context(): WidgetEvaluationContext {
  const graph = new SubjectGraph(subjects);
  return {
    surface: "insights",
    graph,
    subjects,
    scope: null,
    from: new Date(2026, 0, 1),
    to: new Date(2026, 1, 1),
    year: {
      startsAt: new Date(2026, 0, 1),
      endsAt: new Date(2026, 11, 31),
      scale: 20,
    },
    yearSubjects: subjects,
    periods: [],
    customAverages: [],
    goals: [],
    gradeTypes,
    passingRatio: 0.5,
    now: new Date(2026, 1, 1),
    resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
  };
}

const byType = (includeUntyped: boolean): WidgetDefinition => {
  const definition = createWidgetDefinition("insights");
  definition.analysis.dimensions = [
    { id: "group", kind: "assessment-type", includeUntyped },
  ];
  definition.visualization.recipe = "bar";
  return definition;
};

const rows = (definition: WidgetDefinition) => {
  const result = evaluateWidgetDefinition(definition, context());
  if (result.kind !== "data-frame") return [];
  return widgetFrameSeries(result.frame, {
    x: null,
    y: "value",
    color: null,
    series: null,
    facet: null,
  });
};

describe("grouping by the kind of assessment", () => {
  test("compiles, now that a result carries one", () => {
    const compiled = compileWidgetDefinition(byType(true), {
      surface: "insights",
    });

    expect(compiled.valid).toBe(true);
    expect(compiled.plan?.definition.analysis.dimensions[0]?.kind).toBe(
      "assessment-type",
    );
  });

  test("crosses every subject with each assessment type", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.dimensions = [
      {
        id: "group",
        kind: "subject",
        level: "leaf",
        includeCategories: false,
        limit: 8,
      },
      { id: "type", kind: "assessment-type", includeUntyped: true },
    ];
    definition.visualization.recipe = "bar";
    definition.visualization.encoding.x = {
      field: "group",
      type: "nominal",
    };

    expect(
      compileWidgetDefinition(definition, { surface: "insights" }).valid,
    ).toBe(true);
    const found = rows(definition);
    expect(found).toHaveLength(3);
    expect(found.map((row) => row.label)).toEqual([
      "Mathematics",
      "Mathematics",
      "Mathematics",
    ]);
    expect(found.map((row) => row.series)).toEqual([
      "DS",
      "Colle",
      "__type:none__",
    ]);
  });

  test("reads each kind against its own results", () => {
    const found = rows(byType(false));

    expect(found.map((row) => row.label)).toEqual(["DS", "Colle"]);
    // 16 and 14 against 8 and 10: the reading the year's own average hides.
    expect(found[0]?.value).toBeCloseTo(0.75, 10);
    expect(found[1]?.value).toBeCloseTo(0.45, 10);
  });

  test("keeps the year's own order, not the order of the counts", () => {
    // The types are a list somebody arranged. Sorting by how many results each holds
    // would make the axis jump about as marks arrive.
    expect(rows(byType(false)).map((row) => row.label)).toEqual(["DS", "Colle"]);
  });

  test("gives results with no type a bucket of their own", () => {
    const found = rows(byType(true));

    expect(found).toHaveLength(3);
    const untyped = found.at(-1);
    expect(widgetIsUntypedLabel(untyped?.label ?? "")).toBe(true);
    expect(untyped?.value).toBeCloseTo(0.6, 10);
    expect(untyped?.count).toBe(1);
  });

  test("names the untyped bucket with a token, not a word", () => {
    // Core does not speak the reader's language, and a type genuinely called "Sans type"
    // must not be mistaken for the bucket of results that have none.
    expect(widgetIsUntypedLabel("Sans type")).toBe(false);
    expect(widgetIsUntypedLabel("__type:none__")).toBe(true);
  });

  test("summarises a group of an odd size", () => {
    /**
     * The bug an odd group is the only one that shows.
     *
     * `distributionSummary` had a quantile of its own whose two interpolation weights were
     * `high - index` and `index - low`. Both collapse to zero when the position lands
     * exactly on an index — which is what the median of an odd-sized group *is* — so the
     * middle of thirteen marks came out as 0 while an even group interpolated correctly
     * and hid it. One implementation now, the package's own.
     */
    const definition = createWidgetDefinition("insights");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "distribution", goalId: null },
      },
    ];
    definition.analysis.dimensions = [
      { id: "group", kind: "assessment-type", includeUntyped: true },
    ];
    definition.visualization.recipe = "boxplot";

    const compiled = compileWidgetDefinition(definition, {
      surface: "insights",
    });
    expect(compiled.valid).toBe(true);
    expect(compiled.plan?.resultShape).toBe("distribution");

    const result = evaluateWidgetDefinition(definition, context());

    expect(result.kind).toBe("distribution-set");
    if (result.kind !== "distribution-set") return;
    // Two marks of the "DS" kind and two of "Colle": the odd one out is the single
    // untyped result, whose median is that result rather than nothing.
    const untyped = result.groups.find((group) =>
      widgetIsUntypedLabel(group.label),
    );
    expect(untyped?.total).toBe(1);
    expect(untyped?.summary.median).toBeCloseTo(0.6, 10);
  });

  test("drops the untyped results only when asked", () => {
    const without = rows(byType(false));

    expect(without).toHaveLength(2);
    expect(
      without.every((row) => !widgetIsUntypedLabel(row.label)),
    ).toBe(true);
  });
});
