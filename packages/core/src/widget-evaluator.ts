import {
  evaluateCard,
  type CardContext,
  type CardResult,
  type CardSpec,
} from "./cards";
import {
  averageOverTime,
  dayRange,
  dispersionMinimum,
  distribution,
  quantile,
  rankByConsistency,
  rankByImprovement,
  rankSubjects,
} from "./analytics";
import { estimateRemaining, leverageOf, nextAssessmentLeverage } from "./goals";
import { contributionBreakdown } from "./contributions";
import { cohortStanding, COHORT_MINIMUM_SHARING } from "./cohort";
import { compareSubjects } from "./friend";
import { widgetFrameFromSeries } from "./widget-frame";
import { WIDGET_DEFAULT_DIMENSION_ID } from "./widget-defaults";
import { compileWidgetDefinition } from "./widget-definition";
import {
  widgetCapability,
  widgetMeasureId,
  widgetMeasureValueType,
  WIDGET_HIERARCHY_MARKS,
} from "./widget-registry";
import { cardSemanticsFromDefinition } from "./widget-defaults";
import { evaluateWidgetFormula } from "./widget-formula";
import { widgetDefinitionMark } from "./widget-recipes";
import { gradeRatio, resolveCustomAverage, SubjectGraph } from "./graph";
import type { Grade, Subject } from "./types";
import type { CardMetric } from "./cards";
import type {
  WidgetDefinition,
  WidgetEvaluationContext,
  WidgetEvaluationResult,
  WidgetFilter,
  WidgetFormulaContext,
  WidgetDimension,
  WidgetMeasure,
  WidgetMeasureEntry,
  WidgetNumericOperator,
  WidgetSeriesDatum,
  WidgetTransform,
  WidgetValueType,
  WidgetWindow,
} from "./widget-types";
import {
  widgetPrimaryDimension,
  widgetPrimaryMeasure,
  WIDGET_LIMITS,
} from "./widget-types";

const DAY_MS = 24 * 60 * 60 * 1_000;

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

interface PreparedWidgetData {
  subjects: Subject[];
  graph: SubjectGraph;
  scope: ReturnType<typeof resolveCustomAverage>["scope"] | null;
  from: Date;
  to: Date;
}

function localDate(value: string, endOfDay = false): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
      )
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function cloneWithGrades(
  subjects: readonly Subject[],
  keep: (grade: Grade) => boolean,
): Subject[] {
  return subjects.map((subject) => ({
    ...subject,
    grades: subject.grades.filter(keep),
  }));
}

function compare(
  operator: WidgetNumericOperator,
  left: number,
  right: number,
): boolean {
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  return left === right;
}

function passesFilter(
  grade: Grade,
  filter: WidgetFilter,
  passingRatio: number,
): boolean {
  if (filter.kind === "grade-ratio") {
    const ratio = gradeRatio(grade);
    return ratio !== null && compare(filter.operator, ratio, filter.value);
  }
  if (filter.kind === "coefficient") {
    return compare(filter.operator, grade.coefficient, filter.value);
  }
  if (filter.kind === "has-note") {
    return Boolean(grade.note?.trim()) === filter.value;
  }
  if (filter.kind === "passed") {
    const ratio = gradeRatio(grade);
    return ratio !== null && ratio >= passingRatio === filter.value;
  }
  const contains = grade.name
    .toLocaleLowerCase()
    .includes(filter.value.toLocaleLowerCase());
  return filter.operator === "contains" ? contains : !contains;
}

function windowedSubjects(
  definition: WidgetDefinition,
  context: WidgetEvaluationContext,
): {
  subjects: Subject[];
  graphOptions: SubjectGraph["options"];
  from: Date;
  to: Date;
} {
  const window = definition.query.window;
  const now = context.now ?? new Date();
  if (window.kind === "active-period") {
    return {
      subjects: [...context.graph.subjects],
      graphOptions: context.graph.options,
      from: context.from,
      to: context.to,
    };
  }

  let from = startOfLocalDay(context.year.startsAt);
  let to = new Date(
    Math.min(endOfLocalDay(context.year.endsAt).getTime(), now.getTime()),
  );
  const selectedPeriod =
    window.kind === "period"
      ? context.periods.find((item) => item.id === window.periodId)
      : undefined;
  if (window.kind === "period") {
    const period = selectedPeriod;
    if (period) {
      from = new Date(
        Math.max(
          from.getTime(),
          period.isCumulative
            ? from.getTime()
            : startOfLocalDay(period.startAt).getTime(),
        ),
      );
      to = new Date(
        Math.min(to.getTime(), endOfLocalDay(period.endAt).getTime()),
      );
    }
  } else if (window.kind === "rolling-days") {
    const firstDay = startOfLocalDay(to);
    firstDay.setDate(firstDay.getDate() - window.days + 1);
    from = new Date(Math.max(from.getTime(), firstDay.getTime()));
  } else if (window.kind === "date-range") {
    const requestedFrom = localDate(window.from);
    const requestedTo = localDate(window.to, true);
    if (requestedFrom) {
      from = new Date(Math.max(from.getTime(), requestedFrom.getTime()));
    }
    if (requestedTo) {
      to = new Date(Math.min(to.getTime(), requestedTo.getTime()));
    }
  }
  const currentSubjects = new Map(
    context.graph.subjects.map((subject) => [subject.id, subject] as const),
  );
  const adjustedSubjects = context.yearSubjects.map((subject) => ({
    ...subject,
    bonus: selectedPeriod
      ? (subject.periodBonuses?.[selectedPeriod.id] ?? 0)
      : window.kind === "whole-year"
        ? subject.bonus
        : (currentSubjects.get(subject.id)?.bonus ?? subject.bonus),
  }));
  const subjects = cloneWithGrades(
    adjustedSubjects,
    (grade) => grade.passedAt >= from && grade.passedAt <= to,
  );
  return {
    subjects,
    graphOptions: selectedPeriod
      ? {
          ...context.graph.options,
          generalBonus: selectedPeriod.generalBonus ?? 0,
        }
      : window.kind === "whole-year"
        ? {
            ...context.graph.options,
            generalBonus: context.year.generalBonus ?? 0,
          }
        : context.graph.options,
    from,
    to,
  };
}

function scopeSubjects(
  definition: WidgetDefinition,
  subjects: readonly Subject[],
  graphOptions: SubjectGraph["options"],
): { subjects: Subject[]; scope: PreparedWidgetData["scope"] } {
  const selected = definition.query.scope;
  const graph = new SubjectGraph(subjects, graphOptions);
  if (selected.kind === "general")
    return { subjects: [...subjects], scope: null };
  if (selected.kind === "subjects") {
    const ids = new Set(selected.subjectIds);
    if (selected.includeDescendants) {
      for (const id of selected.subjectIds) {
        for (const child of graph.descendantsOf(id)) ids.add(child.id);
      }
    }
    return {
      subjects: subjects.filter((subject) => ids.has(subject.id)),
      scope: null,
    };
  }
  return { subjects: [...subjects], scope: null };
}

function prepareWidgetData(
  definition: WidgetDefinition,
  context: WidgetEvaluationContext,
): PreparedWidgetData {
  const windowed = windowedSubjects(definition, context);
  let selected = scopeSubjects(
    definition,
    windowed.subjects,
    windowed.graphOptions,
  );

  if (definition.query.scope.kind === "custom-average") {
    const averageId = definition.query.scope.averageId;
    const custom = context.customAverages.find((item) => item.id === averageId);
    if (custom) {
      const resolved = resolveCustomAverage(
        new SubjectGraph(selected.subjects, windowed.graphOptions),
        custom,
      );
      selected = {
        subjects: [...resolved.graph.subjects],
        scope: resolved.scope,
      };
    } else {
      selected = { subjects: [], scope: null };
    }
  }

  if (definition.query.window.kind === "last-grades") {
    const graph = new SubjectGraph(selected.subjects, windowed.graphOptions);
    const keepIds = new Set(
      graph
        .allGrades()
        .slice(-definition.query.window.count)
        .map((grade) => grade.id),
    );
    selected = {
      ...selected,
      subjects: cloneWithGrades(selected.subjects, (grade) =>
        keepIds.has(grade.id),
      ),
    };
  }

  let subjects = cloneWithGrades(selected.subjects, (grade) =>
    definition.query.filters.every((filter) =>
      passesFilter(grade, filter, context.passingRatio),
    ),
  );
  let graph = new SubjectGraph(subjects, windowed.graphOptions);
  return {
    subjects,
    graph,
    scope: selected.scope,
    from: windowed.from,
    to: windowed.to,
  };
}

function cardContext(
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  definition?: WidgetDefinition,
): CardContext {
  return {
    ...context,
    graph: data.graph,
    subjects: data.subjects,
    scope: data.scope,
    from: data.from,
    to: data.to,
    // How many assessments each subject still has ahead of it, on the same estimate
    // the goal planner uses. Every card that looks forward needs it, and deriving it
    // here means one answer per evaluation rather than one per card that asks.
    //
    // The horizon is the *end* of the period or year, not `data.to`: a window is
    // clamped to today, so passing it would say the term is over and nothing is left
    // to sit. Measured — the projection band drew "Not enough data yet" on a year
    // with a term still to run.
    remaining: estimateRemaining(
      data.graph,
      data.from,
      horizonFor(definition, context),
      context.now ?? new Date(),
    ),
    resolveTarget: () => ({
      graph: data.graph,
      subjects: data.subjects,
      scope: data.scope,
      subjectId: null,
    }),
  };
}

/**
 * When the assessments still to come would be over.
 *
 * The end of the window the card is *about* — a period's last day, or the year's —
 * rather than the end of the data, which is today. Everything that looks forward reads
 * this: how many marks are left is the difference between the two.
 */
function horizonFor(
  definition: WidgetDefinition | undefined,
  context: WidgetEvaluationContext,
): Date {
  const window = definition?.query.window;
  if (!window) return endOfLocalDay(context.year.endsAt);
  if (window.kind === "period") {
    const period = context.periods.find((item) => item.id === window.periodId);
    if (period) return endOfLocalDay(period.endAt);
  }
  if (window.kind === "active-period") return endOfLocalDay(context.to);
  return endOfLocalDay(context.year.endsAt);
}

/**
 * The same definition, asking one measure.
 *
 * Every walk in this file measures one thing: the card path, the formula path and the
 * bucket evaluation all read `widgetPrimaryMeasure`. A card with several measures is
 * therefore several walks, each of them a definition that carries exactly one — which is
 * cheaper to reason about than threading a measure through six functions, and it keeps
 * the single-measure paths honest rather than quietly reading the first of four.
 */
/**
 * A frame from rows a measure produced directly.
 *
 * The two readings that come out of `evaluateCard` already shaped — a ranking, a coverage
 * list, a weight tree flattened to its leaves — rather than from a bucket walk. They are
 * still one column of one measure over one categorical axis, so they take the same frame
 * as everything else; what they skip is the walk, not the shape.
 */
function widgetFrameOfRows(
  definition: WidgetDefinition,
  rows: WidgetSeriesDatum[],
): ReturnType<typeof widgetFrameFromSeries> {
  const measure = definition.analysis.measures[0];
  const dimensions = definition.analysis.dimensions;
  return widgetFrameFromSeries(
    measure ? [{ measure, values: rows }] : [],
    dimensions.length > 0
      ? dimensions
      : // A ranking is categorical even where the document did not say so: these
        // readings *are* their own grouping, and the frame needs an axis to key on.
        [
          {
            id: WIDGET_DEFAULT_DIMENSION_ID,
            kind: "subject",
            level: "all",
            includeCategories: false,
            limit: rows.length,
          },
        ],
  );
}

function withSingleMeasure(
  definition: WidgetDefinition,
  measure: WidgetMeasureEntry,
): WidgetDefinition {
  return definition.analysis.measures.length === 1
    ? definition
    : {
        ...definition,
        analysis: { ...definition.analysis, measures: [measure] },
      };
}

function cardSpec(definition: WidgetDefinition): CardSpec {
  const projection = cardSemanticsFromDefinition(definition);
  const measure = widgetPrimaryMeasure(definition.analysis);
  return {
    id: "widget-evaluation",
    metric: projection.metric,
    target: { kind: "general", referenceId: null },
    display: projection.display,
    // Layout never asks this bridge anything — it exists to reuse `evaluateCard`
    // — but the field is not optional, and deriving it from the definition is the
    // one answer that cannot drift from what the dashboard would compute.
    recipe: definition.visualization.recipe,
    span: 1,
    title: null,
    accent: null,
    goalId: projection.goalId,
    // A spread measured as a middle half on the dashboard must be a middle half
    // here too: the estimator changes the number, so it travels with the measure
    // rather than being re-chosen by whoever evaluates it.
    ...(measure.kind === "metric" && measure.dispersion !== undefined
      ? { dispersion: measure.dispersion }
      : {}),
    sortOrder: 0,
    hidden: false,
  };
}

function formulaContext(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
): WidgetFormulaContext {
  return {
    grades: data.graph.allGrades().flatMap((grade) => {
      const ratio = gradeRatio(grade);
      return ratio === null
        ? []
        : [
            {
              ratio,
              value: grade.value,
              outOf: grade.outOf,
              coefficient: grade.coefficient,
            },
          ];
    }),
    passingRatio: context.passingRatio,
    yearScale: context.year.scale,
    // A metric operand is the real evaluator run on a derived definition:
    // the card's query with the node's scope/window overrides, measured by
    // the node's metric. No override means the card's own prepared data is
    // reused as-is.
    resolveMetric: (node) => {
      const subDefinition: WidgetDefinition = {
        ...definition,
        query: {
          ...definition.query,
          scope: node.scope ?? definition.query.scope,
          window: node.window ?? definition.query.window,
        },
        analysis: {
          // One measure, ungrouped: a formula operand is a number, and evaluating it
          // through a grouped definition would ask for a series and take its first row.
          measures: [
            {
              id: "operand",
              label: null,
              expression: { kind: "metric", metric: node.metric, goalId: null },
            },
          ],
          dimensions: [],
          comparison: { kind: "none" },
          transforms: [],
        },
      };
      const subData =
        node.scope || node.window
          ? prepareWidgetData(subDefinition, context)
          : data;
      const result = evaluateCard(
        cardSpec(subDefinition),
        cardContext(subData, context, definition),
      );
      return scalarFromCardResult(result);
    },
  };
}

function scalarFromCardResult(result: CardResult): number | null {
  if (result.kind === "ratio" || result.kind === "percent") return result.ratio;
  if (result.kind === "count") return result.count;
  if (result.kind === "scalar") return result.value;
  if (result.kind === "subject" || result.kind === "grade") return result.ratio;
  return null;
}

function evaluateScalar(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
): { value: number | null; card: CardResult | null } {
  const measure = widgetPrimaryMeasure(definition.analysis);
  if (measure.kind === "formula") {
    return {
      value: evaluateWidgetFormula(
        measure.formula,
        formulaContext(definition, data, context),
      ),
      card: null,
    };
  }
  const result = evaluateCard(
    cardSpec(definition),
    cardContext(data, context, definition),
  );
  return { value: scalarFromCardResult(result), card: result };
}

function dateKey(date: Date, interval: "day" | "week" | "month"): string {
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  if (interval === "week") {
    const day = (local.getDay() + 6) % 7;
    local.setDate(local.getDate() - day);
  } else if (interval === "month") {
    local.setDate(1);
  }
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

/**
 * Thin a series down to a drawing budget, keeping both ends.
 *
 * This used to run *inside* the bucket walk, which put it before every
 * transform — so `cumulative` summed a sample of the buckets rather than all of
 * them, and a seven-point moving average averaged seven points that were no
 * longer seven consecutive days. Measured on 600 daily buckets: 500 points out,
 * with gaps of one day and two. The numbers on screen were wrong, not just the
 * shape.
 *
 * It belongs at the end, and it has to keep the last point: for a cumulative
 * that point *is* the answer.
 */
function downsampleForRender<T>(values: readonly T[], limit: number): T[] {
  if (values.length <= limit) return [...values];
  if (limit <= 1) return values.length === 0 ? [] : [values[values.length - 1]];
  if (limit === 2) return [values[0] as T, values[values.length - 1] as T];
  const inner = Array.from({ length: limit - 2 }, (_, index) => {
    const source = Math.round(
      ((index + 1) * (values.length - 1)) / (limit - 1),
    );
    return values[Math.min(values.length - 2, Math.max(1, source))] as T;
  });
  return [values[0] as T, ...inner, values[values.length - 1] as T];
}

/** Per-series drawing budget, shared out when a card draws several lines. */
function renderBudget(seriesCount: number): number {
  return Math.max(
    2,
    Math.floor(WIDGET_LIMITS.resultPoints / Math.max(1, seriesCount)),
  );
}

/** Thin every series independently, so one long line cannot starve another. */
function downsampleSeriesForRender(
  values: readonly WidgetSeriesDatum[],
): WidgetSeriesDatum[] {
  const keys = [...new Set(values.map((item) => item.series))];
  if (keys.length <= 1) {
    return downsampleForRender(values, renderBudget(1));
  }
  const budget = renderBudget(keys.length);
  return keys.flatMap((key) =>
    downsampleForRender(
      values.filter((item) => item.series === key),
      budget,
    ),
  );
}

/** Refuse a complete logical frame rather than truncate any of its semantic inputs. */
function widgetCellBudget(
  rows: number,
  measures: number,
): { actual: number; limit: number } | null {
  const actual = rows * Math.max(1, measures);
  return actual > WIDGET_LIMITS.rows
    ? { actual, limit: WIDGET_LIMITS.rows }
    : null;
}

/**
 * Number of buckets one time-series part will materialise, without evaluating a measure.
 *
 * Kept structurally identical to `datumForTimeSingle`: completed calendar keys, every
 * declared period, then every observed mark. This preflight is intentionally about keys
 * only. A rejected request must not run thousands of averages merely to learn that its
 * cross-product was too large.
 */
function widgetTimeBucketCount(
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: Extract<WidgetDimension, { kind: "time" }>,
): number {
  const keys = new Set<string>();
  const calendarGrain = widgetCalendarGrain(dimension.grain);
  if (dimension.fill === "calendar" && calendarGrain) {
    for (const key of calendarKeys(data.from, data.to, calendarGrain))
      keys.add(key);
  }
  if (dimension.grain === "period") {
    for (const period of context.periods) keys.add(period.id);
  }
  for (const grade of data.graph.allGrades()) {
    keys.add(bucketKeyFor(grade, dimension.grain));
  }
  return keys.size;
}

/** The exact output row domain for a time axis and its optional split. */
function widgetTimeRowCount(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: Extract<WidgetDimension, { kind: "time" }>,
): number {
  const split = definition.analysis.dimensions[1];
  if (split?.kind === "subject") {
    const requestedIds =
      definition.query.scope.kind === "subjects"
        ? definition.query.scope.subjectIds
        : split.level === "leaf"
          ? data.graph.contributorsOf(null).map((subject) => subject.id)
          : data.graph.roots.map((subject) => subject.id);
    const targets = requestedIds
      .map((id) => data.graph.byId(id))
      .filter((subject): subject is Subject => Boolean(subject))
      .filter(
        (subject) => split.includeCategories || subject.kind !== "category",
      )
      .slice(0, Math.min(split.limit, WIDGET_LIMITS.series));
    if (targets.length > 0) {
      return targets.reduce((rows, subject) => {
        const ids = new Set([
          subject.id,
          ...data.graph.descendantsOf(subject.id).map((item) => item.id),
        ]);
        const subjects = data.subjects.filter((item) => ids.has(item.id));
        return (
          rows +
          widgetTimeBucketCount(
            {
              ...data,
              subjects,
              graph: new SubjectGraph(subjects, data.graph.options),
              scope: null,
            },
            context,
            dimension,
          )
        );
      }, 0);
    }
  }

  const slices = split ? categorySlices(split, context) : null;
  if (slices && slices.length > 0) {
    return slices.slice(0, WIDGET_LIMITS.series).reduce((rows, slice) => {
      const subjects = cloneWithGrades(data.subjects, slice.keeps);
      return (
        rows +
        widgetTimeBucketCount(
          {
            ...data,
            subjects,
            graph: new SubjectGraph(subjects, data.graph.options),
          },
          context,
          dimension,
        )
      );
    }, 0);
  }
  return widgetTimeBucketCount(data, context, dimension);
}

/** The configured categorical cross-product, before any cell is evaluated. */
function widgetCategoricalRowCount(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: Extract<
    WidgetDimension,
    { kind: "subject" | "grade-band" | "status" | "assessment-type" }
  >,
): number {
  const split = definition.analysis.dimensions[1];
  const inner = split ? categorySlices(split, context) : null;
  const parts =
    inner && inner.length > 0
      ? Math.min(inner.length, WIDGET_LIMITS.series)
      : 1;
  if (dimension.kind === "subject") {
    const subjects = data.graph
      .flatten()
      .filter(
        (subject) => dimension.includeCategories || subject.kind !== "category",
      ).length;
    return Math.min(subjects, dimension.limit) * parts;
  }
  return (categorySlices(dimension, context)?.length ?? 0) * parts;
}

function datumForTime(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: Extract<WidgetDimension, { kind: "time" }>,
): WidgetSeriesDatum[] {
  /**
   * The second dimension, when there is one, splits the series.
   *
   * This is the audit's "generalised time × subject", and it used to be a special case
   * hidden behind an encoding channel: a card got several series only if its colour or
   * series channel happened to name `category`. Now the *analysis* says so — a second
   * subject dimension — and the encoding merely decides which channel shows it.
   */
  const split = definition.analysis.dimensions[1];
  if (split?.kind === "subject") {
    const requestedIds =
      definition.query.scope.kind === "subjects"
        ? definition.query.scope.subjectIds
        : split.level === "leaf"
          ? data.graph.contributorsOf(null).map((subject) => subject.id)
          : data.graph.roots.map((subject) => subject.id);
    const targets = requestedIds
      .map((id) => data.graph.byId(id))
      .filter((subject): subject is Subject => Boolean(subject))
      .filter(
        (subject) => split.includeCategories || subject.kind !== "category",
      )
      // Eight series is the ceiling everywhere: past it a chart is a texture, and the
      // renderer's own budget then thins it further per card width.
      .slice(0, Math.min(split.limit, WIDGET_LIMITS.series));
    if (targets.length > 0) {
      // Each series keeps its own full set of buckets. Sharing the *drawing*
      // budget between series is right and happens at the end; sharing the
      // bucket budget was what cut an eight-series card to 62 buckets a line
      // and made every transform on it wrong.
      return targets.flatMap((subject) => {
        const ids = new Set([
          subject.id,
          ...data.graph.descendantsOf(subject.id).map((item) => item.id),
        ]);
        const subjects = data.subjects.filter((item) => ids.has(item.id));
        return datumForTimeSingle(
          definition,
          {
            ...data,
            subjects,
            graph: new SubjectGraph(subjects, data.graph.options),
            scope: null,
          },
          context,
          dimension,
          subject.id,
          subject.name,
        );
      });
    }
  }
  /**
   * And every other way of splitting, which is a filter on the marks rather than a
   * subset of the tree.
   *
   * A grade band, a status, a kind of assessment: each is a `CategorySlice`, the same one
   * the categorical path cuts, so "the average over time, per kind" draws the lines the
   * bar chart of the same two dimensions draws bars for. Only the subject split needs the
   * graph rebuilt, because only it changes what the average is *of*.
   *
   * This is what the second dimension used to be worth outside `time × subject`: nothing.
   * The axis was accepted, saved, and silently dropped at render.
   */
  const slices = split ? categorySlices(split, context) : null;
  if (slices && slices.length > 0) {
    return slices.slice(0, WIDGET_LIMITS.series).flatMap((slice) => {
      const subjects = cloneWithGrades(data.subjects, slice.keeps);
      return datumForTimeSingle(
        definition,
        {
          ...data,
          subjects,
          graph: new SubjectGraph(subjects, data.graph.options),
        },
        context,
        dimension,
        slice.key,
        slice.label,
      );
    });
  }
  return datumForTimeSingle(definition, data, context, dimension, "all", null);
}

/**
 * The slices a dimension cuts, where it cuts by filtering marks.
 *
 * `subject` is absent on purpose: splitting by subject is a different operation — it
 * changes which tree the average is computed over, not which marks are kept — and its
 * callers handle it before reaching here.
 */
function categorySlices(
  dimension: WidgetDimension,
  context: WidgetEvaluationContext,
): CategorySlice[] | null {
  if (dimension.kind === "grade-band") {
    return gradeBandSlices(dimension.thresholds, context);
  }
  if (dimension.kind === "status")
    return statusSlices(dimension.values, context);
  if (dimension.kind === "assessment-type") {
    return assessmentTypeSlices(dimension, context);
  }
  return null;
}

/**
 * Every bucket key between two dates, at the given interval.
 *
 * Walks the calendar rather than adding a fixed number of milliseconds, so a
 * month step lands on the first of each month and a day step survives the hour
 * that daylight saving takes away. Bounded by the same guard as the observed walk:
 * a window that somehow exceeds it is cut at the end, and a school year cannot.
 */
function calendarKeys(
  from: Date,
  to: Date,
  interval: "day" | "week" | "month",
): string[] {
  const keys: string[] = [];
  const cursor = localDate(dateKey(from, interval)) ?? startOfLocalDay(from);
  const last = dateKey(to, interval);
  // One sentinel bucket beyond the budget lets the caller reject the full request. A
  // hard stop at the limit silently looked like a complete calendar.
  for (let step = 0; step <= WIDGET_LIMITS.seriesBuckets; step += 1) {
    const key = dateKey(cursor, interval);
    keys.push(key);
    if (key >= last) break;
    if (interval === "month") cursor.setMonth(cursor.getMonth() + 1);
    else if (interval === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
    // Adding days across a daylight-saving boundary can land at 23:00 the day
    // before; the key is computed from a normalised copy either way, but keeping
    // the cursor at midnight stops the error accumulating over a year.
    cursor.setHours(0, 0, 0, 0);
  }
  return keys;
}

/**
 * The grain that walks a calendar, or `null` for the two that do not.
 *
 * An event is a mark and a period is a period: neither is a step on a calendar, so
 * neither can be materialised from one. Saying so here keeps the three helpers that *do*
 * walk a calendar honestly typed to the three grains they understand.
 */
function widgetCalendarGrain(
  grain: Extract<WidgetDimension, { kind: "time" }>["grain"],
): "day" | "week" | "month" | null {
  return grain === "day" || grain === "week" || grain === "month"
    ? grain
    : null;
}

/**
 * The bucket a mark falls into.
 *
 * `event` gives every mark its own bucket, which is the whole point of the grain: two
 * results on the same afternoon are two results, and a day grain merges them into one
 * average that neither of them is. `period` buckets by the period the mark belongs to —
 * stored on the mark, not inferred from its date, because a catch-up test sat in April
 * can belong to the term that ended in March.
 */
function bucketKeyFor(
  grade: Grade,
  grain: Extract<WidgetDimension, { kind: "time" }>["grain"],
): string {
  if (grain === "event") return `event:${grade.id}`;
  if (grain === "period") return grade.periodId ?? PERIODLESS_BUCKET;
  return dateKey(grade.passedAt, grain);
}

/** Marks that belong to no period, kept as their own bucket rather than dropped. */
const PERIODLESS_BUCKET = "__no-period__";

/**
 * The buckets in the order a reader reads them.
 *
 * A date key sorts as a string because it is written to; an event sorts by when it
 * happened, and a period by where it sits in the year. Sorting event keys as strings
 * would order the marks by id, which is to say at random.
 */
function widgetOrderedBuckets(
  buckets: Map<string, Grade[]>,
  grain: Extract<WidgetDimension, { kind: "time" }>["grain"],
  context: WidgetEvaluationContext,
): Array<[string, Grade[]]> {
  const entries = [...buckets.entries()];
  if (grain === "event") {
    return entries.sort(([, left], [, right]) => {
      const a = left[0];
      const b = right[0];
      if (!a || !b) return 0;
      return (
        a.passedAt.getTime() - b.passedAt.getTime() || a.id.localeCompare(b.id)
      );
    });
  }
  if (grain === "period") {
    const order = new Map(
      context.periods.map((period, index) => [period.id, index]),
    );
    return entries.sort(
      ([left], [right]) =>
        (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * What a bucket is called and when it happened.
 *
 * A date key is both; an event is named by the mark and dated by when it was sat; a
 * period is named by the period and dated by its start, so a temporal axis still places
 * it. A period the year does not know keeps its own label rather than showing an id.
 */
function widgetBucketIdentity(
  key: string,
  grades: readonly Grade[],
  grain: Extract<WidgetDimension, { kind: "time" }>["grain"],
  context: WidgetEvaluationContext,
): { label: string; date: Date | null } {
  if (grain === "event") {
    const grade = grades[0];
    return {
      label: grade?.name.trim() || key,
      date: grade?.passedAt ?? null,
    };
  }
  if (grain === "period") {
    const period = context.periods.find((item) => item.id === key);
    return period
      ? { label: period.name, date: period.startAt }
      : { label: "", date: null };
  }
  return { label: key, date: localDate(key) };
}

function datumForTimeSingle(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: Extract<WidgetDimension, { kind: "time" }>,
  seriesKey: string,
  seriesLabel: string | null,
): WidgetSeriesDatum[] {
  const buckets = new Map<string, Grade[]>();
  // Whether "no marks" is a number for this measure. Read from the capability so
  // the rule follows the measure rather than a list kept here.
  const countedMeasure =
    widgetMeasureValueType(widgetPrimaryMeasure(definition.analysis)) ===
    "count";
  // Every bucket in the window when the card asked for a calendar, whether
  // anything happened in it or not: a year of squares has to have a square for
  // every day, and a day missing from the map is indistinguishable from a day
  // outside the window. Seeded first so the observed marks fall into buckets that
  // already exist, which also keeps them in calendar order rather than in the
  // order the marks were found.
  const calendarGrain = widgetCalendarGrain(dimension.grain);
  // `calendar` only means anything on a calendar grain: there is no "every event that
  // did not happen", and the periods are the periods whether marks landed in them or
  // not — the period grain seeds all of them below regardless.
  if (dimension.fill === "calendar" && calendarGrain) {
    for (const key of calendarKeys(data.from, data.to, calendarGrain)) {
      buckets.set(key, []);
    }
  }
  // Every period in the year, in order, so a period axis has a slot for a term nobody
  // was assessed in — which is a fact about the term, not a gap in the chart.
  if (dimension.grain === "period") {
    for (const period of context.periods) buckets.set(period.id, []);
  }
  for (const grade of data.graph.allGrades()) {
    const key = bucketKeyFor(grade, dimension.grain);
    const list = buckets.get(key);
    if (list) list.push(grade);
    else buckets.set(key, [grade]);
  }
  const ordered = widgetOrderedBuckets(buckets, dimension.grain, context);
  const running = new Set<string>();
  const values = ordered.map(([key, grades]) => {
    if (dimension.accumulation === "running") {
      for (const grade of grades) running.add(grade.id);
    }
    const ids =
      dimension.accumulation === "running"
        ? running
        : new Set(grades.map((grade) => grade.id));
    const subjects = cloneWithGrades(data.subjects, (grade) =>
      ids.has(grade.id),
    );
    const bucketData: PreparedWidgetData = {
      ...data,
      subjects,
      graph: new SubjectGraph(subjects, data.graph.options),
    };
    const evaluated = evaluateScalar(definition, bucketData, context);
    const bucket = widgetBucketIdentity(key, grades, dimension.grain, context);
    return {
      key: `${seriesKey}:${key}`,
      label: bucket.label,
      date: bucket.date,
      // What nothing means is the measure's answer, not the walk's: a count of no
      // marks is nought — which is the reading a heatmap of activity is made of —
      // while an average of no marks is nothing at all, and drawing that as zero
      // would invent a catastrophic day. Only a materialised bucket asks the
      // question; an observed bucket has marks by construction.
      value:
        evaluated.value === null && ids.size === 0 && countedMeasure
          ? 0
          : evaluated.value,
      delta: null,
      count: dimension.accumulation === "running" ? ids.size : grades.length,
      series: seriesLabel,
    };
  });
  // Never truncate here: transforms downstream have to see every bucket. The global row
  // budget rejects an over-limit request before any transform is applied.
  return values;
}

/**
 * A categorical axis, whichever kind it is.
 *
 * Subjects are one categorical dimension among several now. A grade band and a status
 * slice the *marks* rather than the tree — "how many of my results are between twelve and
 * fourteen", "how many passed" — so each slice narrows the data to the marks it owns and
 * the measure is then evaluated over that slice like any other. That is what makes them
 * work with every measure rather than only with a count.
 */
/**
 * The groups a distribution is cut into, each with its own graph.
 *
 * Only the groupings a *distribution* means something over: by subject, by period, and by
 * kind of assessment. A distribution per grade band is one bucket by construction, and the
 * capability table refuses it rather than drawing a violin of a single value.
 */
function distributionGroups(
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: WidgetDimension,
): Array<{ key: string; label: string; graph: SubjectGraph }> {
  if (dimension.kind === "subject") {
    return data.graph
      .flatten()
      .filter(
        (subject) => dimension.includeCategories || subject.kind !== "category",
      )
      .slice(0, dimension.limit)
      .map((subject) => {
        const ids = new Set([
          subject.id,
          ...data.graph.descendantsOf(subject.id).map((item) => item.id),
        ]);
        return {
          key: subject.id,
          label: subject.name,
          graph: new SubjectGraph(
            data.subjects.filter((item) => ids.has(item.id)),
            data.graph.options,
          ),
        };
      });
  }
  if (dimension.kind === "period") {
    return context.periods.map((period) => ({
      key: period.id,
      label: period.name,
      graph: new SubjectGraph(
        cloneWithGrades(data.subjects, (grade) => grade.periodId === period.id),
        data.graph.options,
      ),
    }));
  }
  if (dimension.kind === "assessment-type") {
    // The same slices the categorical path cuts, so a box plot per kind and a bar per
    // kind cannot disagree about which results belong to which — including the bucket of
    // results that carry no type.
    return assessmentTypeSlices(dimension, context).map((slice) => ({
      key: slice.key,
      label: slice.label,
      graph: new SubjectGraph(
        cloneWithGrades(data.subjects, slice.keeps),
        data.graph.options,
      ),
    }));
  }
  return [];
}

function datumForCategories(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: Extract<
    WidgetDimension,
    { kind: "subject" | "grade-band" | "status" | "assessment-type" }
  >,
): WidgetSeriesDatum[] {
  if (dimension.kind === "subject") {
    return datumForSubjects(definition, data, context, dimension);
  }
  const slices = categorySlices(dimension, context) ?? [];
  /**
   * The second dimension, when it is one this path can cut.
   *
   * A bar per kind of assessment, split by status, is one bar per pair — which is what a
   * grouped or stacked bar chart draws, and what `series` carries. Without this the axis
   * was accepted and thrown away: the card drew the outer dimension alone and said
   * nothing about the one it had been told to split by.
   *
   * A subject as the *second* dimension is not here, for the reason `categorySlices`
   * gives: it changes what the average is of rather than which marks are kept, and the
   * compiler refuses that pairing rather than letting it fall through silently.
   */
  const split = definition.analysis.dimensions[1];
  const inner = split ? categorySlices(split, context) : null;
  return slices.flatMap((slice): WidgetSeriesDatum[] => {
    const subjects = cloneWithGrades(data.subjects, slice.keeps);
    const sliceData: PreparedWidgetData = {
      ...data,
      subjects,
      graph: new SubjectGraph(subjects, data.graph.options),
    };
    if (!inner || inner.length === 0) {
      const evaluated = evaluateScalar(definition, sliceData, context);
      return [
        {
          key: slice.key,
          label: slice.label,
          date: null,
          value: evaluated.value,
          delta: null,
          count: sliceData.graph.allGrades().length,
          series: null,
        },
      ];
    }
    return inner.slice(0, WIDGET_LIMITS.series).map((part) => {
      const nested = cloneWithGrades(sliceData.subjects, part.keeps);
      const nestedData: PreparedWidgetData = {
        ...sliceData,
        subjects: nested,
        graph: new SubjectGraph(nested, sliceData.graph.options),
      };
      const evaluated = evaluateScalar(definition, nestedData, context);
      return {
        key: `${slice.key}:${part.key}`,
        label: slice.label,
        date: null,
        value: evaluated.value,
        delta: null,
        count: nestedData.graph.allGrades().length,
        series: part.label,
      };
    });
  });
}

/**
 * The label a status slice carries.
 *
 * A stable token rather than a word, so a renderer can translate it and a subject genuinely
 * named "passed" cannot be mistaken for one. Read by `widgetStatusFromLabel`.
 */
export const WIDGET_STATUS_LABEL = Object.freeze({
  passed: "__status:passed__",
  failed: "__status:failed__",
  missing: "__status:missing__",
});

/** The status a label names, or `null` when it is an ordinary category. */
export function widgetStatusFromLabel(
  label: string,
): "passed" | "failed" | "missing" | null {
  if (label === WIDGET_STATUS_LABEL.passed) return "passed";
  if (label === WIDGET_STATUS_LABEL.failed) return "failed";
  if (label === WIDGET_STATUS_LABEL.missing) return "missing";
  return null;
}

interface CategorySlice {
  key: string;
  label: string;
  keeps: (grade: Grade) => boolean;
  /** Only status owns a domain member that is not a mark at all. */
  status?: "passed" | "failed" | "missing";
}

/**
 * One slice per kind of assessment the year defines.
 *
 * In the year's own order rather than by how many results each holds: the types are a list
 * somebody arranged, and reordering them by count would make the axis jump about as marks
 * arrive.
 *
 * Results with no type get a slice of their own when the dimension asks for one — which it
 * does by default. Dropping them would report a share of the year as if it were all of
 * it, and every year has results written before its types existed.
 */
function assessmentTypeSlices(
  dimension: Extract<WidgetDimension, { kind: "assessment-type" }>,
  context: WidgetEvaluationContext,
): CategorySlice[] {
  const types = context.gradeTypes ?? [];
  const slices: CategorySlice[] = types.map((type) => ({
    key: `type:${type.id}`,
    label: type.name,
    keeps: (grade: Grade) => grade.typeId === type.id,
  }));
  if (dimension.includeUntyped) {
    const known = new Set(types.map((type) => type.id));
    slices.push({
      key: "type:none",
      // A token rather than a word, for the reason the status labels are: core does not
      // speak the reader's language, and a type genuinely called "Sans type" must not be
      // mistaken for this bucket.
      label: WIDGET_UNTYPED_LABEL,
      keeps: (grade: Grade) => !grade.typeId || !known.has(grade.typeId),
    });
  }
  return slices;
}

/** The label the untyped bucket carries. Read by `widgetIsUntypedLabel`. */
export const WIDGET_UNTYPED_LABEL = "__type:none__";

/** Whether a label names the bucket of results with no type. */
export function widgetIsUntypedLabel(label: string): boolean {
  return label === WIDGET_UNTYPED_LABEL;
}

/**
 * Bands between the cut points, plus the two open ends.
 *
 * Cut points rather than bands, because that is what a reader thinks in — "ten, twelve,
 * fourteen" — and the bands between them follow. Half-open upward so a mark of exactly
 * twelve is in the twelve band rather than in both or neither, with the top band closed
 * so full marks land somewhere.
 */
function gradeBandSlices(
  thresholds: readonly number[],
  context: WidgetEvaluationContext,
): CategorySlice[] {
  const cuts = [...thresholds].sort((left, right) => left - right);
  const bounds = [0, ...cuts, 1];
  const scale = context.year.scale;
  const label = (value: number) =>
    String(Math.round(value * scale * 100) / 100);
  return bounds.slice(0, -1).map((low, index) => {
    const high = bounds[index + 1] as number;
    const last = index === bounds.length - 2;
    return {
      key: `band:${low}:${high}`,
      label: `${label(low)}–${label(high)}`,
      keeps: (grade: Grade) => {
        const ratio = gradeRatio(grade);
        if (ratio === null) return false;
        return ratio >= low && (last ? ratio <= high : ratio < high);
      },
    };
  });
}

/**
 * Passed, failed — and `missing`, which is not a slice of the marks.
 *
 * A mark cannot be missing; a *subject* can be unassessed. So the missing state is left
 * to the coverage measure, which completes its own domain, and asking for it here yields
 * nothing rather than an empty slice that reads as "no subjects are missing marks".
 */
function statusSlices(
  values: ReadonlyArray<"passed" | "failed" | "missing">,
  context: WidgetEvaluationContext,
): CategorySlice[] {
  const slices: CategorySlice[] = [];
  const passing = context.passingRatio;
  if (values.includes("passed")) {
    slices.push({
      key: "status:passed",
      // The *state*, not the word: core does not speak the reader's language, so a renderer
      // translates the key it finds here. Sending "passed" through as a label would ship
      // one English word into a French card.
      label: WIDGET_STATUS_LABEL.passed,
      status: "passed",
      keeps: (grade) => {
        const ratio = gradeRatio(grade);
        return ratio !== null && ratio >= passing;
      },
    });
  }
  if (values.includes("failed")) {
    slices.push({
      key: "status:failed",
      label: WIDGET_STATUS_LABEL.failed,
      status: "failed",
      keeps: (grade) => {
        const ratio = gradeRatio(grade);
        return ratio !== null && ratio < passing;
      },
    });
  }
  if (values.includes("missing")) {
    slices.push({
      key: "status:missing",
      label: WIDGET_STATUS_LABEL.missing,
      status: "missing",
      // A missing subject has no mark to retain. The subject cross-product completes
      // this member explicitly; no other caller is allowed to request it.
      keeps: () => false,
    });
  }
  return slices;
}

function datumForSubjects(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  dimension: Extract<WidgetDimension, { kind: "subject" }>,
): WidgetSeriesDatum[] {
  const measure = widgetPrimaryMeasure(definition.analysis);
  const split = definition.analysis.dimensions[1];
  const parts = split ? categorySlices(split, context) : null;

  /**
   * The honest subject × categorical cross-product.
   *
   * The subject is the outer row and the inner dimension filters that subject's own
   * marks. Coverage is the one measure for which `missing` is numeric: one when the
   * subject has no observations, zero otherwise. The compiler excludes `missing` for
   * every other measure, so no average of an absence is invented here.
   */
  if (parts && parts.length > 0) {
    const candidates = data.graph
      .flatten()
      .filter(
        (subject) => dimension.includeCategories || subject.kind !== "category",
      )
      .slice(0, dimension.limit);
    return candidates.flatMap((subject) => {
      const ids = new Set([
        subject.id,
        ...data.graph.descendantsOf(subject.id).map((item) => item.id),
      ]);
      const subjects = data.subjects.filter((item) => ids.has(item.id));
      const subjectData: PreparedWidgetData = {
        ...data,
        subjects,
        graph: new SubjectGraph(subjects, data.graph.options),
        scope: null,
      };
      const gradeCount = subjectData.graph.allGrades().length;
      return parts.slice(0, WIDGET_LIMITS.series).map((part) => {
        const nested = cloneWithGrades(subjectData.subjects, part.keeps);
        const nestedData: PreparedWidgetData = {
          ...subjectData,
          subjects: nested,
          graph: new SubjectGraph(nested, subjectData.graph.options),
        };
        const coverage =
          measure.kind === "metric" && measure.metric === "coverage";
        const evaluated = coverage
          ? {
              value:
                part.status === "missing"
                  ? gradeCount === 0
                    ? 1
                    : 0
                  : nestedData.graph.allGrades().length,
            }
          : evaluateScalar(definition, nestedData, context);
        return {
          key: `${subject.id}:${part.key}`,
          label: subject.name,
          date: null,
          value: evaluated.value,
          delta: null,
          count: nestedData.graph.allGrades().length,
          series: part.label,
        };
      });
    });
  }

  if (measure.kind === "metric") {
    const options = { includeCategories: dimension.includeCategories };
    const general = data.graph.ratio(null, data.scope);
    const direct =
      measure.metric === "subjectRanking"
        ? rankSubjects(data.graph, options).map((entry) => ({
            id: entry.subject.id,
            label: entry.subject.name,
            value: entry.ratio,
            delta: general === null ? null : entry.ratio - general,
          }))
        : measure.metric === "mostImproved"
          ? rankByImprovement(data.graph, options).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              value: entry.delta,
              delta: entry.delta,
            }))
          : measure.metric === "steadiest"
            ? rankByConsistency(data.graph, options).map((entry) => ({
                id: entry.subject.id,
                label: entry.subject.name,
                value: entry.consistency,
                delta: null,
              }))
            : measure.metric === "coverage"
              ? // Completed, not found: every subject in scope gets a row, and a
                // subject that has never been assessed gets one with no grades.
                // Fewest first, because the question is what is missing — the
                // answer belongs at the top of the list.
                data.graph
                  .flatten()
                  .filter(
                    (subject) =>
                      dimension.includeCategories ||
                      subject.kind !== "category",
                  )
                  .map((subject) => ({
                    id: subject.id,
                    label: subject.name,
                    value: data.graph.allGrades(subject.id).length,
                    delta: null,
                  }))
                  .sort((left, right) => left.value - right.value)
              : measure.metric === "leverage" ||
                  measure.metric === "nextLeverage"
                ? // Two questions with one shape. `leverageOf` is a subject's structural
                  // share — the same function the goal planner's levers use, so a card and
                  // the goal screen cannot disagree — and `nextAssessmentLeverage` is what
                  // one further mark in it can move, which is that share diluted by
                  // everything already graded. Descending either way: the question is
                  // which subjects matter and the answer belongs at the top.
                  (() => {
                    const next = measure.metric === "nextLeverage";
                    return data.graph
                      .flatten()
                      .filter(
                        (subject) =>
                          dimension.includeCategories ||
                          subject.kind !== "category",
                      )
                      .map((subject) => ({
                        id: subject.id,
                        label: subject.name,
                        value: next
                          ? nextAssessmentLeverage(
                              data.graph,
                              null,
                              subject.id,
                              1,
                              data.scope,
                            )
                          : leverageOf(
                              data.graph,
                              null,
                              subject.id,
                              data.scope,
                            ),
                        delta: null,
                      }))
                      .sort((left, right) => right.value - left.value);
                  })()
                : null;
    if (direct) {
      return direct.map((item) => ({
        key: item.id,
        label: item.label,
        date: null,
        value: item.value,
        delta: item.delta,
        count: data.graph.allGrades(item.id).length,
        series: null,
      }));
    }
  }
  const candidates = data.graph
    .flatten()
    .filter(
      (subject) => dimension.includeCategories || subject.kind !== "category",
    );
  return candidates.map((subject) => {
    const ids = new Set([
      subject.id,
      ...data.graph.descendantsOf(subject.id).map((item) => item.id),
    ]);
    const subjects = data.subjects.filter((item) => ids.has(item.id));
    const subjectData: PreparedWidgetData = {
      ...data,
      subjects,
      graph: new SubjectGraph(subjects, data.graph.options),
      scope: null,
    };
    const evaluated = evaluateScalar(definition, subjectData, context);
    return {
      key: subject.id,
      label: subject.name,
      date: null,
      value: evaluated.value,
      delta: null,
      count: subjectData.graph.allGrades().length,
      series: null,
    };
  });
}

function applyTransforms(
  values: WidgetSeriesDatum[],
  transforms: WidgetTransform[],
): WidgetSeriesDatum[] {
  let result = [...values];
  for (const transform of transforms) {
    if (transform.kind === "sort") {
      const sign = transform.direction === "ascending" ? 1 : -1;
      // Missing is not zero. `?? 0` ranked an empty bucket among the real zeros —
      // so a period with no results outranked every subject that had actually
      // dropped, and a descending sort put "nothing happened" above the worst news
      // on the page. Absent values go last whichever way the sort runs, because
      // last is where a reader looks for what could not be measured.
      result.sort((left, right) => {
        if (left.value === null) return right.value === null ? 0 : 1;
        if (right.value === null) return -1;
        return sign * (left.value - right.value);
      });
    } else if (transform.kind === "limit") {
      result = result.slice(0, transform.count);
    } else if (transform.kind === "moving-average") {
      /**
       * One pass per series with a running sum, rather than a scan per point.
       *
       * This used to `filter` the whole result and `findIndex` within it *for every
       * row* — quadratic, with two allocations a row. It was survivable while the
       * drawing budget thinned the series to a few hundred points before the
       * transforms ran; that was also the bug where a seven-day mean averaged seven
       * points three days apart. Fixing the order left the arithmetic correct and
       * the cost pathological: transforms now see the full series, up to
       * `WIDGET_LIMITS.seriesBuckets`, so 4 000 buckets meant sixteen million scans
       * where there had been a quarter of a million.
       *
       * Linear now, and the window is still the same `points` consecutive buckets of
       * one series.
       */
      const points = Math.max(1, Math.floor(transform.points));
      const bySeries = new Map<string | null, WidgetSeriesDatum[]>();
      for (const item of result) {
        const group = bySeries.get(item.series);
        if (group) group.push(item);
        else bySeries.set(item.series, [item]);
      }
      const means = new Map<WidgetSeriesDatum, number | null>();
      for (const group of bySeries.values()) {
        let sum = 0;
        let counted = 0;
        for (let index = 0; index < group.length; index += 1) {
          const entering = (group[index] as WidgetSeriesDatum).value;
          if (entering !== null) {
            sum += entering;
            counted += 1;
          }
          if (index >= points) {
            const leaving = (group[index - points] as WidgetSeriesDatum).value;
            if (leaving !== null) {
              sum -= leaving;
              counted -= 1;
            }
          }
          // A window of nothing but gaps is a gap, not a zero — the same answer the
          // filtered version gave, reached without building the window.
          means.set(
            group[index] as WidgetSeriesDatum,
            counted > 0 ? sum / counted : null,
          );
        }
      }
      result = result.map((item) => ({
        ...item,
        value: means.get(item) ?? null,
      }));
    } else if (transform.kind === "cumulative") {
      const totals = new Map<string | null, number>();
      result = result.map((item) => {
        const total = (totals.get(item.series) ?? 0) + (item.value ?? 0);
        totals.set(item.series, total);
        return { ...item, value: total };
      });
    }
  }
  // No budget here. A slice in the middle of the pipeline is a semantic
  // truncation dressed as a safeguard: it dropped points before the comparison
  // had seen them, and before the caller had a chance to draw them.
  return result;
}

function withComparison(
  value: number,
  definition: WidgetDefinition,
): number | null {
  const comparison = definition.analysis.comparison;
  return comparison.kind === "baseline" ? value - comparison.value : null;
}

function distributionSummary(values: number[]): {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
} {
  const sorted = [...values].sort((a, b) => a - b);
  /**
   * The package's own quantile, not a second one written here.
   *
   * There *was* a second one, and it was wrong in a way only an odd-sized group shows:
   * its two interpolation weights were `high - index` and `index - low`, which both
   * collapse to zero when the position lands exactly on an index — so the median of
   * thirteen marks was reported as **0**. Even-sized groups interpolate between two
   * neighbours and never hit that case, which is why every fixture happened to hide it.
   */
  const at = (fraction: number) => quantile(sorted, fraction) ?? 0;
  const q1 = at(0.25);
  const q3 = at(0.75);
  const fence = (q3 - q1) * 1.5;
  return {
    min: sorted[0] ?? 0,
    q1,
    median: at(0.5),
    q3,
    max: sorted.at(-1) ?? 0,
    outliers: sorted.filter(
      (value) => value < q1 - fence || value > q3 + fence,
    ),
  };
}

function compareSeries(
  values: WidgetSeriesDatum[],
  definition: WidgetDefinition,
): WidgetSeriesDatum[] {
  const comparison = definition.analysis.comparison;
  if (comparison.kind === "none") return values;
  /**
   * A pair is two windows, and this function only has one.
   *
   * It falls through to "the point before this one in the same series" for anything it
   * does not recognise, which for a window pair is a real number answering a question
   * nobody asked — the previous bucket, reported as the difference between two terms. The
   * shapes that *can* honour a pair do it before they reach here; the rest say nothing,
   * which is what an unanswered comparison is.
   */
  if (comparison.kind === "window-pair") {
    return values.map((item) => ({ ...item, delta: null }));
  }
  return values.map((item, index) => {
    if (item.value === null) return { ...item, delta: null };
    const previous = values
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.series === item.series);
    const baseline =
      comparison.kind === "baseline"
        ? comparison.value
        : (previous?.value ?? null);
    return {
      ...item,
      delta: baseline === null ? null : item.value - baseline,
    };
  });
}

function relativeBucketIndex(
  date: Date,
  from: Date,
  interval: "day" | "week" | "month",
): number {
  const bucket = localDate(dateKey(date, interval)) ?? date;
  const first = localDate(dateKey(from, interval)) ?? from;
  if (interval === "month") {
    return (
      (bucket.getFullYear() - first.getFullYear()) * 12 +
      bucket.getMonth() -
      first.getMonth()
    );
  }
  const utc = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.round((utc(bucket) - utc(first)) / DAY_MS);
  return interval === "week" ? Math.round(days / 7) : days;
}

/**
 * One series held against the same series over another window.
 *
 * Both comparisons that name a second window come through here — the previous one, which
 * is derived, and a pair, which is named — because the hard part is the same for both and
 * it is not the arithmetic: it is deciding *which bucket answers which*.
 */
function compareTimeSeriesToWindow(
  values: WidgetSeriesDatum[],
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  other: { definition: WidgetDefinition; data: PreparedWidgetData },
  context: WidgetEvaluationContext,
  dimension: Extract<WidgetDimension, { kind: "time" }>,
  alignment: "calendar" | "ordinal",
): WidgetSeriesDatum[] {
  const { definition: previousDefinition, data: previousData } = other;
  const previousValues = applyTransforms(
    datumForTime(previousDefinition, previousData, context, dimension),
    definition.analysis.transforms,
  );
  const calendarGrain =
    alignment === "calendar" ? widgetCalendarGrain(dimension.grain) : null;
  /**
   * How a bucket lines up with one in the window before.
   *
   * On a calendar grain it is the offset from the window's start — day seven against day
   * seven — which is what makes "the same week last term" mean something. On an event or
   * a period grain there is no offset to compute, so it is the *ordinal within the
   * series*: the third mark against the third mark, the second term against the second.
   * Comparing a mark to whichever mark shares its date would compare it to nothing most
   * of the time.
   */
  const alignmentKeys = (items: readonly WidgetSeriesDatum[]) => {
    const ordinals = new Map<string, number>();
    return items.map((item) => {
      const series = item.series ?? "";
      if (calendarGrain && item.date) {
        return `${series}:${relativeBucketIndex(
          item.date,
          items === values ? data.from : previousData.from,
          calendarGrain,
        )}`;
      }
      const ordinal = ordinals.get(series) ?? 0;
      ordinals.set(series, ordinal + 1);
      return `${series}:#${ordinal}`;
    });
  };
  const previousKeys = alignmentKeys(previousValues);
  const previousByBucket = new Map(
    previousValues.map((item, index) => [previousKeys[index]!, item.value]),
  );
  const keys = alignmentKeys(values);
  return values.map((item, index) => {
    if (item.value === null) return { ...item, delta: null };
    const previous = previousByBucket.get(keys[index]!);
    return {
      ...item,
      delta:
        previous === undefined || previous === null
          ? null
          : item.value - previous,
    };
  });
}

function dateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function previousWindowValue(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
): number | null {
  const { definition: previous, data: previousData } = previousWidgetData(
    definition,
    data,
    context,
  );
  return evaluateScalar(previous, previousData, context).value;
}

/**
 * The card, read over a window of its own naming.
 *
 * What a `window-pair` needs on both sides: the same scope, the same filters and the same
 * measure, over a window the comparison names rather than the query. The comparison is
 * cleared on the way in, or each side would try to compare itself to something.
 */
function windowSideData(
  definition: WidgetDefinition,
  window: WidgetWindow,
  context: WidgetEvaluationContext,
): { definition: WidgetDefinition; data: PreparedWidgetData } {
  const side: WidgetDefinition = {
    ...definition,
    query: { ...definition.query, window },
    analysis: { ...definition.analysis, comparison: { kind: "none" } },
  };
  return { definition: side, data: prepareWidgetData(side, context) };
}

function previousWidgetData(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
): { definition: WidgetDefinition; data: PreparedWidgetData } {
  if (definition.query.window.kind === "last-grades") {
    const withoutComparison: WidgetDefinition = {
      ...definition,
      query: {
        ...definition.query,
        window: { kind: "whole-year" },
      },
      analysis: {
        ...definition.analysis,
        comparison: { kind: "none" },
      },
    };
    const full = prepareWidgetData(withoutComparison, context);
    const count = definition.query.window.count;
    const all = full.graph.allGrades();
    const previousGrades = all.slice(
      Math.max(0, all.length - count * 2),
      Math.max(0, all.length - count),
    );
    const ids = new Set(previousGrades.map((grade) => grade.id));
    const subjects = cloneWithGrades(full.subjects, (grade) =>
      ids.has(grade.id),
    );
    return {
      definition: withoutComparison,
      data: {
        ...full,
        subjects,
        graph: new SubjectGraph(subjects, full.graph.options),
        from: previousGrades[0]?.passedAt ?? data.from,
        to: previousGrades.at(-1)?.passedAt ?? data.from,
      },
    };
  }
  const previous = previousWindowDefinition(definition, data);
  return { definition: previous, data: prepareWidgetData(previous, context) };
}

function previousWindowDefinition(
  definition: WidgetDefinition,
  data: PreparedWidgetData,
): WidgetDefinition {
  const fromDay = Date.UTC(
    data.from.getFullYear(),
    data.from.getMonth(),
    data.from.getDate(),
  );
  const toDay = Date.UTC(
    data.to.getFullYear(),
    data.to.getMonth(),
    data.to.getDate(),
  );
  const days = Math.max(1, Math.round((toDay - fromDay) / DAY_MS) + 1);
  const previousTo = startOfLocalDay(data.from);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - days + 1);
  return {
    ...definition,
    query: {
      ...definition.query,
      window: {
        kind: "date-range",
        from: dateOnly(previousFrom),
        to: dateOnly(previousTo),
      },
    },
    analysis: {
      ...definition.analysis,
      comparison: { kind: "none" },
    },
  };
}

function goalEvaluationDefinition(
  definition: WidgetDefinition,
  context: WidgetEvaluationContext,
): { definition: WidgetDefinition; horizonTo: Date } | null {
  const measure = widgetPrimaryMeasure(definition.analysis);
  if (measure.kind !== "metric" || measure.metric !== "goalProgress") {
    return null;
  }
  const goalId = measure.goalId;
  const goal = context.goals.find((item) => item.id === goalId);
  if (!goal) return null;
  const scope =
    goal.kind === "subject" && goal.referenceId
      ? {
          kind: "subjects" as const,
          subjectIds: [goal.referenceId],
          includeDescendants: true,
        }
      : goal.kind === "custom" && goal.referenceId
        ? { kind: "custom-average" as const, averageId: goal.referenceId }
        : { kind: "general" as const };
  const period = goal.periodId
    ? context.periods.find((item) => item.id === goal.periodId)
    : null;
  if (goal.periodId && !period) return null;
  return {
    definition: {
      ...definition,
      query: {
        source: "grades",
        scope,
        window: period
          ? { kind: "period", periodId: period.id }
          : { kind: "whole-year" },
        filters: [],
      },
    },
    horizonTo: endOfLocalDay(period?.endAt ?? context.year.endsAt),
  };
}

/** The metrics answered from a group rather than from the reader's own year. */
const COHORT_READINGS: CardMetric[] = [
  "cohortRank",
  "cohortAverage",
  "cohortGap",
  "memberAverage",
];

/** The metrics answered from one friend's own sharing. */
const FRIEND_READINGS: CardMetric[] = [
  "friendAverage",
  "friendCurves",
  "friendSubjects",
];

/** Points a shared curve is drawn at — the same weekly walk the server samples. */
const FRIEND_CURVE_STEP_DAYS = 7;

/**
 * A reading about one friend, or the honest silence for the lock that is shut.
 *
 * Three locks on the other side and a different sentence for each, because "no data" for
 * a friend who deliberately shares nothing is a card that looks broken. The card cannot
 * say *which* lock — that would report somebody's settings back to their friend — so it
 * says what it does not have rather than why.
 */
function evaluateFriendReading(
  measure: Extract<WidgetMeasure, { kind: "metric" }>,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
): WidgetEvaluationResult {
  const friend = measure.memberId
    ? context.friends?.get(measure.memberId)
    : undefined;
  const shape =
    measure.metric === "friendCurves" ? "interval-series" : "record";
  if (!friend) return { kind: "empty", shape };

  if (measure.metric === "friendAverage") {
    return friend.generalAverage === null
      ? { kind: "empty", shape: "record" }
      : {
          kind: "structured",
          shape: "record",
          value: {
            kind: "member",
            from: friend.name,
            name: friend.name,
            average: friend.generalAverage,
          },
        };
  }

  if (measure.metric === "friendSubjects") {
    const mine = data.graph
      .flatten()
      .filter((subject) => subject.kind !== "category")
      .map((subject) => ({
        name: subject.name,
        average: data.graph.ratio(subject.id, data.scope),
      }));
    const rows = compareSubjects(mine, friend.subjects);
    return rows.length === 0
      ? { kind: "empty", shape: "records" }
      : {
          kind: "structured",
          shape: "records",
          value: {
            kind: "subject-comparison",
            name: friend.name,
            rows,
            // Counted, not listed: how many subjects they keep private is a fact about
            // the comparison, and naming them would defeat the point of keeping them.
            hidden: Math.max(
              0,
              rows.filter((row) => row.theirs === null).length,
            ),
          },
        };
  }

  if (friend.history === null || friend.history.length === 0) {
    return { kind: "empty", shape: "interval-series" };
  }
  const mine = averageOverTime(
    data.subjects,
    dayRange(data.from, data.to, FRIEND_CURVE_STEP_DAYS),
    null,
    data.scope,
    data.graph.options,
  ).flatMap((point) =>
    point.ratio === null ? [] : [{ at: point.date, ratio: point.ratio }],
  );
  /**
   * Their curve, over the reader's window rather than over their whole year.
   *
   * The two sides arrive from different places — this one walks the reader's own window,
   * theirs is sampled across their year by the server, because the server has no idea
   * what the reader is looking at. Drawn together untouched, a card scoped to the second
   * term put the reader's term beside their friend's September-to-June: two curves on one
   * axis measuring different spans, which is a comparison of nothing.
   *
   * Clipped rather than re-sampled: the points are dated, and the honest thing is to show
   * the part of their record that falls in the window being read — including when that
   * leaves nothing, which the card draws as a single line.
   */
  const from = data.from.getTime();
  const to = data.to.getTime();
  const theirs =
    friend.history?.filter((point) => {
      const at = point.at.getTime();
      return at >= from && at <= to;
    }) ?? null;
  return mine.length === 0
    ? { kind: "empty", shape: "interval-series" }
    : {
        kind: "structured",
        shape: "interval-series",
        value: {
          kind: "curves",
          name: friend.name,
          scale: context.year.scale,
          theirScale: friend.scale,
          mine,
          theirs,
        },
      };
}

/**
 * A reading about a group, or an honest silence.
 *
 * Three silences, and they are different sentences on the card:
 *
 * - No cohort at all — the group was never opened to cards, or the figures have not
 *   arrived — which is the ordinary empty.
 * - Too few members sharing, which `cohortStanding` refuses outright: a rank in a group
 *   of three identifies the other two.
 * - The reader shares nothing, so they are not in the list they would be ranked in. Their
 *   own doing, and the card says so rather than showing a blank.
 */
function evaluateCohortReading(
  measure: Extract<WidgetMeasure, { kind: "metric" }>,
  context: WidgetEvaluationContext,
): WidgetEvaluationResult {
  const cohort = measure.groupId
    ? context.cohorts?.get(measure.groupId)
    : undefined;
  const shape = measure.metric === "cohortRank" ? "record" : "scalar";
  if (!cohort) return { kind: "empty", shape };

  if (measure.metric === "memberAverage") {
    const member = cohort.members.find(
      (entry) => entry.userId === measure.memberId,
    );
    // A member who stopped sharing simply is not in the list any more, and the card goes
    // quiet — which is the behaviour a withdrawn consent has to have.
    return member === undefined
      ? { kind: "empty", shape: "record" }
      : {
          kind: "structured",
          shape: "record",
          value: {
            kind: "member",
            from: cohort.name,
            name: member.name,
            average: member.average,
          },
        };
  }

  const standing = cohortStanding(cohort);
  if (standing === null) {
    return {
      kind: "empty",
      shape,
      reason: {
        kind: "insufficient-sample",
        count: cohort.members.length,
        minimum: COHORT_MINIMUM_SHARING,
      },
    };
  }
  if (measure.metric === "cohortAverage") {
    return {
      kind: "scalar",
      shape: "scalar",
      value: standing.groupAverage,
      valueType: "ratio",
      sample: { count: standing.of, unit: "members" },
      delta: null,
    };
  }
  if (measure.metric === "cohortGap") {
    return standing.mine === null
      ? { kind: "empty", shape: "scalar", reason: { kind: "not-sharing" } }
      : {
          kind: "scalar",
          shape: "scalar",
          value: standing.mine - standing.groupAverage,
          valueType: "ratio",
          sample: { count: standing.of, unit: "members" },
          delta: null,
        };
  }
  return standing.rank === null
    ? { kind: "empty", shape: "record", reason: { kind: "not-sharing" } }
    : {
        kind: "structured",
        shape: "record",
        value: { kind: "standing", ...standing },
      };
}

export function evaluateWidgetDefinition(
  input: WidgetDefinition,
  context: WidgetEvaluationContext,
): WidgetEvaluationResult {
  const compiled = compileWidgetDefinition(input, { surface: context.surface });
  if (!compiled.plan) return { kind: "empty", shape: "scalar" };
  const {
    definition: compiledDefinition,
    resultShape,
    valueType,
    capability,
  } = compiled.plan;
  /**
   * A window pair names the window the card is read over.
   *
   * Its right-hand side *is* the reading — "the third term, against the first" shows the
   * third — so the query's own window is replaced here, once, and every path below sees a
   * definition it already knows how to evaluate. The comparison stays on the analysis, so
   * each result shape still knows to hold the left side against it.
   *
   * Done at the entry rather than per shape because the alternative is four places
   * agreeing about which window a pair means, and they would not.
   */
  const definition: WidgetDefinition =
    compiledDefinition.analysis.comparison.kind === "window-pair"
      ? {
          ...compiledDefinition,
          query: {
            ...compiledDefinition.query,
            window: compiledDefinition.analysis.comparison.right,
          },
        }
      : compiledDefinition;
  const requestedPeriodId =
    definition.query.window.kind === "period"
      ? definition.query.window.periodId
      : null;
  if (
    requestedPeriodId &&
    !context.periods.some((period) => period.id === requestedPeriodId)
  ) {
    return { kind: "empty", shape: resultShape };
  }
  const measure = widgetPrimaryMeasure(definition.analysis);
  /**
   * The readings that are about other people.
   *
   * Answered here rather than in `evaluateCard`, and that is a boundary rather than a
   * convenience: `CardContext` is the reader's own year, and putting a class's figures on
   * it would make every metric in the app able to reach them. A cohort reading needs the
   * group the *definition* names and the figures the *host* supplied, which are both
   * here and neither there.
   */
  if (measure.kind === "metric" && COHORT_READINGS.includes(measure.metric)) {
    return evaluateCohortReading(measure, context);
  }
  const goalEvaluation = goalEvaluationDefinition(definition, context);
  if (measure.kind === "metric" && measure.metric === "goalProgress") {
    if (!goalEvaluation) return { kind: "empty", shape: "goal" };
    const data = prepareWidgetData(goalEvaluation.definition, context);
    const evaluated = evaluateCard(cardSpec(goalEvaluation.definition), {
      ...cardContext(data, context, goalEvaluation.definition),
      remaining: estimateRemaining(
        data.graph,
        data.from,
        goalEvaluation.horizonTo,
        context.now ?? new Date(),
      ),
    });
    return evaluated.kind === "goal"
      ? { kind: "structured", shape: "goal", value: evaluated }
      : { kind: "empty", shape: "goal" };
  }
  const data = prepareWidgetData(definition, context);

  /**
   * The readings about one friend.
   *
   * After the data is prepared rather than beside the cohort branch, because two of the
   * three compare against the *reader's own* figures — their subjects, their curve — and
   * those come from the same window every other card is read over.
   */
  if (measure.kind === "metric" && FRIEND_READINGS.includes(measure.metric)) {
    return evaluateFriendReading(measure, data, context);
  }

  /**
   * The one reading that needs two windows.
   *
   * Here rather than in `evaluateCard`, which is handed a single graph: the previous
   * window is built by `previousWidgetData`, and the decomposition needs both sides
   * at once. The arithmetic itself is `contributionBreakdown`, where the invariant —
   * the steps sum to the change, exactly — is stated and tested.
   */
  if (measure.kind === "metric" && measure.metric === "contributions") {
    const previous = previousWidgetData(definition, data, context);
    const breakdown = contributionBreakdown(
      previous.data.graph,
      data.graph,
      data.scope,
    );
    if (breakdown === null) {
      return {
        kind: "empty",
        shape:
          widgetDefinitionMark(definition) === "waterfall"
            ? "waterfall"
            : "categorical-series",
      };
    }
    if (widgetDefinitionMark(definition) !== "waterfall") {
      return {
        kind: "data-frame",
        shape: "categorical-series",
        valueType,
        frame: widgetFrameOfRows(
          definition,
          breakdown.steps.map((step) => ({
            key: step.key,
            label: step.label,
            date: null,
            value: step.delta,
            delta: null,
            count: 0,
            series: null,
          })),
        ),
      };
    }
    return {
      kind: "structured",
      shape: "waterfall",
      value: { kind: "waterfall", ...breakdown },
    };
  }

  // The *first* dimension decides the result's shape; a second one splits what it
  // produced into series, which `datumForTime` reads for itself.
  const dimension = widgetPrimaryDimension(definition.analysis);

  /**
   * A distribution per group.
   *
   * Before the categorical dispatch, because a grouped distribution is not a series of
   * numbers: it is one distribution per group, and reducing each to a scalar — which is
   * what the general path would do — is how "a box plot per subject" became "a bar chart
   * of how many marks each subject has". This is the limitation the audit calls out, and
   * it is what a grouped box plot, a violin and a ridgeline are all drawn from.
   */
  if (capability.resultShape === "distribution" && dimension !== null) {
    const partitions = distributionGroups(data, context, dimension);
    const actual =
      partitions.length * Math.max(1, definition.analysis.measures.length);
    if (actual > WIDGET_LIMITS.rows) {
      return {
        kind: "empty",
        shape: "distribution",
        reason: {
          kind: "complexity-limit",
          actual,
          limit: WIDGET_LIMITS.rows,
        },
      };
    }
    const groups = partitions.flatMap((group) => {
      const ratios = group.graph
        .allGrades()
        .map(gradeRatio)
        .filter((value): value is number => value !== null);
      if (ratios.length === 0) return [];
      const bins =
        definition.visualization.options.kind === "histogram"
          ? definition.visualization.options.bins
          : 10;
      return [
        {
          key: group.key,
          label: group.label,
          buckets: distribution(ratios, bins),
          total: ratios.length,
          values: ratios.slice(-WIDGET_LIMITS.resultPoints),
          summary: distributionSummary(ratios),
        },
      ];
    });
    return groups.length === 0
      ? { kind: "empty", shape: "distribution" }
      : {
          kind: "distribution-set",
          shape: "distribution",
          groups,
          total: groups.reduce((sum, group) => sum + group.total, 0),
        };
  }
  if (dimension?.kind === "time" || dimension?.kind === "period") {
    const timeDimension: Extract<WidgetDimension, { kind: "time" }> =
      dimension.kind === "time"
        ? dimension
        : // A period axis *is* a time axis at a period grain: one dimension kind for
          // "when", one code path, and a `period` dimension is the sugar that says the
          // grain without spelling out a fill and an accumulation nobody chooses there.
          {
            id: dimension.id,
            kind: "time",
            grain: "period",
            fill: "observed",
            accumulation: "bucket",
          };
    // Preflight the structural domain before evaluating a single cell. A transform is
    // allowed to see either the complete cross-product or nothing — never a prefix that
    // changes its arithmetic — and an over-budget request must not pay for the work it is
    // about to refuse.
    const budget = widgetCellBudget(
      widgetTimeRowCount(definition, data, context, timeDimension),
      definition.analysis.measures.length,
    );
    if (budget) {
      return {
        kind: "empty",
        shape: "temporal-series",
        reason: { kind: "complexity-limit", ...budget },
      };
    }
    const rawWalks = definition.analysis.measures.map((measure) => {
      const single = withSingleMeasure(definition, measure);
      return {
        measure,
        values: datumForTime(single, data, context, timeDimension),
      };
    });
    // One transformed walk per measure. A card asking for "current and target" is two
    // passes over the same buckets, merged by row key only after both are complete.
    const walks = rawWalks.map(({ measure, values }) => {
      const single = withSingleMeasure(definition, measure);
      const transformed = applyTransforms(
        [...values],
        definition.analysis.transforms,
      );
      const comparison = definition.analysis.comparison;
      const compared =
        comparison.kind === "previous-window"
          ? compareTimeSeriesToWindow(
              transformed,
              single,
              data,
              previousWidgetData(single, data, context),
              context,
              timeDimension,
              // A derived window is aligned by the calendar where the grain has one — day
              // seven against day seven — and by ordinal where it has none.
              "calendar",
            )
          : comparison.kind === "window-pair"
            ? compareTimeSeriesToWindow(
                transformed,
                single,
                data,
                windowSideData(single, comparison.left, context),
                context,
                timeDimension,
                /**
                 * The pair says how its two windows line up, and the three answers are two
                 * rules: `calendar` measures the offset from each window's own start, so
                 * the same week of two terms meet; `relative` and `period` count buckets,
                 * so the third mark meets the third and the second term meets the second.
                 * A pair of unequal windows has no other honest join.
                 */
                comparison.alignment === "calendar" ? "calendar" : "ordinal",
              )
            : compareSeries(transformed, single);
      return {
        measure,
        values: downsampleSeriesForRender(compared),
      };
    });
    const frame = widgetFrameFromSeries(walks, definition.analysis.dimensions);
    return frame.rows.some((row) =>
      Object.values(row.measures).some((value) => value !== null),
    )
      ? { kind: "data-frame", shape: "temporal-series", frame, valueType }
      : { kind: "empty", shape: "temporal-series" };
  }
  if (
    dimension?.kind === "subject" ||
    dimension?.kind === "grade-band" ||
    dimension?.kind === "status" ||
    dimension?.kind === "assessment-type"
  ) {
    const categorical = dimension;
    const split = definition.analysis.dimensions[1];
    const budget = widgetCellBudget(
      widgetCategoricalRowCount(definition, data, context, categorical),
      definition.analysis.measures.length,
    );
    if (budget) {
      return {
        kind: "empty",
        shape: "categorical-series",
        reason: { kind: "complexity-limit", ...budget },
      };
    }
    const rawWalks = definition.analysis.measures.map((measure) => {
      const single = withSingleMeasure(definition, measure);
      return {
        measure,
        values: datumForCategories(single, data, context, categorical),
      };
    });
    const constrained = (values: WidgetSeriesDatum[]) =>
      categorical.kind === "subject" && !split
        ? values.slice(0, categorical.limit)
        : values;
    /**
     * The comparison, for whichever measure is being walked.
     *
     * Taking a definition rather than closing over the primary is the whole of the fix:
     * this arithmetic ran once, for the first measure, and every measure after it came
     * back with `delta: null`. On the drawings where a delta *is* the mark — a dumbbell,
     * a slope — the second pair had one end and nothing to join it to, on a card that
     * compiled and saved cleanly.
     */
    const withComparison = (
      measureDefinition: WidgetDefinition,
      values: WidgetSeriesDatum[],
    ) =>
      definition.analysis.comparison.kind === "previous-window" ||
      definition.analysis.comparison.kind === "window-pair"
        ? (() => {
            const comparison = definition.analysis.comparison;
            // The same join either way — by row key, which is the subject or the band. A
            // pair names the window to hold against; a previous window derives it.
            const { definition: previousDefinition, data: previousData } =
              comparison.kind === "window-pair"
                ? windowSideData(measureDefinition, comparison.left, context)
                : previousWidgetData(measureDefinition, data, context);
            const previousValues = constrained(
              applyTransforms(
                datumForCategories(
                  previousDefinition,
                  previousData,
                  context,
                  categorical,
                ),
                definition.analysis.transforms,
              ),
            );
            const previousByKey = new Map(
              previousValues.map((item) => [item.key, item.value]),
            );
            return values.map((item) => {
              const previous = previousByKey.get(item.key) ?? null;
              return {
                ...item,
                delta:
                  item.value === null || previous === null
                    ? null
                    : item.value - previous,
              };
            });
          })()
        : compareSeries(values, measureDefinition);
    const walks = rawWalks.map(({ measure, values }) => {
      const single = withSingleMeasure(definition, measure);
      const transformed = constrained(
        applyTransforms([...values], definition.analysis.transforms),
      );
      return {
        measure,
        values: downsampleSeriesForRender(withComparison(single, transformed)),
      };
    });
    const frame = widgetFrameFromSeries(walks, definition.analysis.dimensions);
    if (definition.visualization.recipe === "radar") {
      const axis = frame.schema.dimensions[0];
      const cardinality = axis
        ? new Set(frame.rows.map((row) => row.dimensions[axis.id])).size
        : 0;
      if (cardinality < 3) {
        return {
          kind: "empty",
          shape: "categorical-series",
          reason: {
            kind: "insufficient-sample",
            count: cardinality,
            minimum: 3,
          },
        };
      }
      if (cardinality > 8) {
        return {
          kind: "empty",
          shape: "categorical-series",
          reason: {
            kind: "complexity-limit",
            actual: cardinality,
            limit: 8,
          },
        };
      }
    }
    return frame.rows.some((row) =>
      Object.values(row.measures).some((value) => value !== null),
    )
      ? { kind: "data-frame", shape: "categorical-series", frame, valueType }
      : { kind: "empty", shape: "categorical-series" };
  }

  const evaluated = evaluateScalar(definition, data, context);
  if (evaluated.card?.kind === "distribution") {
    const ratios = data.graph
      .allGrades()
      .map(gradeRatio)
      .filter((value): value is number => value !== null);
    const bins =
      definition.visualization.options.kind === "histogram"
        ? definition.visualization.options.bins
        : evaluated.card.buckets.length;
    return {
      kind: "distribution",
      shape: "distribution",
      buckets: distribution(ratios, bins),
      total: evaluated.card.total,
      values: ratios.slice(-WIDGET_LIMITS.resultPoints),
      summary: distributionSummary(ratios),
    };
  }
  // A value fallback for a band is a declared projection, not the interval structure
  // handed to a renderer that only understands numbers. Projection shows its terminal
  // centre; control shows the latest observation and its distance from the established
  // centre. Both remain honest summaries of the same reading.
  if (
    widgetDefinitionMark(definition) === "value" &&
    (evaluated.card?.kind === "band" || evaluated.card?.kind === "control")
  ) {
    const last = evaluated.card.points[evaluated.card.points.length - 1];
    const value =
      evaluated.card.kind === "band"
        ? (last?.center ?? null)
        : (last?.observed ?? evaluated.card.center);
    if (value === null) return { kind: "empty", shape: "scalar" };
    const delta =
      evaluated.card.kind === "control"
        ? value - evaluated.card.center
        : (() => {
            const first = evaluated.card.points[0]?.center;
            return first === undefined ? null : value - first;
          })();
    return {
      kind: "scalar",
      shape: "scalar",
      value,
      valueType,
      delta,
      sample: { count: evaluated.card.sample },
    };
  }
  // A tree drawn by anything other than a tree is its leaves: the branch cannot be
  // shown by a ranking, but the shares can, and that is the reading the audit asks a
  // narrow card — or a platform with no treemap — to fall back to. Flattened here
  // rather than in a renderer, for the same reason a list is: one place decides what
  // a result *is*, and every renderer then gets a shape it already draws.
  //
  // Which drawings count as trees is `WIDGET_HIERARCHY_MARKS` and not a string written
  // here: this condition named `treemap` alone, so the sunburst — a second tree drawing,
  // correctly compiled and correctly dispatched — was handed a flat frame and drew a bar
  // chart of the leaves.
  if (
    evaluated.card?.kind === "hierarchy" &&
    !WIDGET_HIERARCHY_MARKS.includes(widgetDefinitionMark(definition))
  ) {
    const leaves = evaluated.card.nodes.filter((node) => node.leaf);
    return leaves.length === 0
      ? { kind: "empty", shape: "categorical-series" }
      : {
          kind: "data-frame",
          shape: "categorical-series",
          valueType,
          frame: widgetFrameOfRows(
            definition,
            [...leaves]
              .sort((left, right) => right.value - left.value)
              .map((node) => ({
                key: node.id,
                label: node.label,
                date: null,
                value: node.value,
                delta: null,
                count: data.graph.allGrades(node.id).length,
                series: null,
              })),
          ),
        };
  }
  if (
    evaluated.card &&
    [
      "grade",
      "subject",
      "list",
      "streak",
      "goal",
      "required",
      "margin",
      "concentration",
      "standing",
      "member",
      "curves",
      "subject-comparison",
      "anomaly",
      "priority",
      "impact",
      "hierarchy",
      "band",
      "control",
    ].includes(evaluated.card.kind)
  ) {
    const shape =
      evaluated.card.kind === "list"
        ? "records"
        : evaluated.card.kind === "grade" ||
            evaluated.card.kind === "subject" ||
            // A mark plus the subject it is in: a record, and the capability
            // says so too.
            evaluated.card.kind === "required" ||
            // A cushion and the mark that would spend it: a record, and the
            // capability says so too.
            evaluated.card.kind === "margin" ||
            // A share and the subjects that hold it: neither half is the reading on
            // its own, which is what makes it a record rather than a percentage.
            evaluated.card.kind === "concentration" ||
            // Where the reader stands in a group, and one member's average: both are a
            // number that means nothing without the words beside it.
            evaluated.card.kind === "standing" ||
            evaluated.card.kind === "member" ||
            // A mark and how far it sits from its subject's level.
            evaluated.card.kind === "anomaly" ||
            // A subject and what working on it is worth.
            evaluated.card.kind === "priority" ||
            // A mark, and the average with and without it.
            evaluated.card.kind === "impact"
          ? "record"
          : evaluated.card.kind === "hierarchy"
            ? "hierarchy"
            : // A low, a middle and a high at every step: its own shape, and the
              // result says which kind of interval it is.
              evaluated.card.kind === "band" ||
                // The control band is the same shape and a different claim — where results
                // have been rather than where the average could go.
                evaluated.card.kind === "control"
              ? "interval-series"
              : evaluated.card.kind;
    if (
      (widgetDefinitionMark(definition) === "table" ||
        widgetDefinitionMark(definition) === "list") &&
      evaluated.card.kind === "list"
    ) {
      return {
        kind: "data-frame",
        shape: "categorical-series",
        valueType,
        frame: widgetFrameOfRows(
          definition,
          evaluated.card.items.map((item) => ({
            key: item.id,
            label: item.label,
            date: null,
            value: item.ratio ?? item.delta,
            delta: item.delta,
            count: data.graph.allGrades(item.id).length,
            series: null,
          })),
        ),
      };
    }
    return {
      kind: "structured",
      shape: shape as
        | "record"
        | "records"
        | "streak"
        | "goal"
        | "hierarchy"
        | "waterfall"
        | "interval-series",
      value: evaluated.card,
    };
  }
  // A spread that could not be measured says so with its count: the card then
  // reads "3 marks so far" rather than the blank a deleted subject gets.
  const sample =
    evaluated.card?.kind === "scalar" ? evaluated.card.sample : undefined;
  const dispersion =
    evaluated.card?.kind === "scalar" ? evaluated.card.dispersion : undefined;
  if (evaluated.value === null) {
    return {
      kind: "empty",
      shape: resultShape,
      // A reason the *metric* knows travels with its result — only it can tell "nothing
      // to look at" from "looked, and everything is as usual".
      ...(evaluated.card?.kind === "empty" && evaluated.card.reason
        ? { reason: evaluated.card.reason }
        : {}),
      ...(sample && !sample.sufficient && dispersion
        ? {
            reason: {
              kind: "insufficient-sample" as const,
              count: sample.count,
              minimum: dispersionMinimum(dispersion),
            },
          }
        : {}),
    };
  }
  return {
    kind: "scalar",
    shape: "scalar",
    value: evaluated.value,
    valueType: valueType as WidgetValueType,
    ...(sample ? { sample: { count: sample.count } } : {}),
    ...(dispersion ? { dispersion } : {}),
    delta:
      definition.analysis.comparison.kind === "previous-window"
        ? (() => {
            const previous = previousWindowValue(definition, data, context);
            return previous === null ? null : evaluated.value - previous;
          })()
        : definition.analysis.comparison.kind === "window-pair"
          ? (() => {
              // The reading is already the right-hand window — see `evaluateWidgetDefinition`
              // — so only the left one has to be read here.
              const { definition: left, data: leftData } = windowSideData(
                definition,
                definition.analysis.comparison.left,
                context,
              );
              const before = evaluateScalar(left, leftData, context).value;
              return before === null ? null : evaluated.value - before;
            })()
          : withComparison(evaluated.value, definition),
  };
}
