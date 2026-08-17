import {
  evaluateCard,
  type CardContext,
  type CardResult,
  type CardSpec,
} from "./cards";
import {
  distribution,
  rankByConsistency,
  rankByImprovement,
  rankSubjects,
} from "./analytics";
import { estimateRemaining } from "./goals";
import { compileWidgetDefinition } from "./widget-definition";
import { cardSemanticsFromDefinition } from "./widget-defaults";
import { evaluateWidgetFormula } from "./widget-formula";
import { gradeRatio, resolveCustomAverage, SubjectGraph } from "./graph";
import type { Grade, Subject } from "./types";
import type {
  WidgetDefinitionV1,
  WidgetEvaluationContext,
  WidgetEvaluationResult,
  WidgetFilter,
  WidgetFormulaContext,
  WidgetGroupBy,
  WidgetNumericOperator,
  WidgetSeriesDatum,
  WidgetTransform,
  WidgetValueType,
} from "./widget-types";
import { WIDGET_LIMITS } from "./widget-types";

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
  definition: WidgetDefinitionV1,
  context: WidgetEvaluationContext,
): { subjects: Subject[]; from: Date; to: Date } {
  const window = definition.query.window;
  const now = context.now ?? new Date();
  if (window.kind === "active-period") {
    return {
      subjects: [...context.graph.subjects],
      from: context.from,
      to: context.to,
    };
  }

  let from = startOfLocalDay(context.year.startsAt);
  let to = new Date(
    Math.min(endOfLocalDay(context.year.endsAt).getTime(), now.getTime()),
  );
  if (window.kind === "period") {
    const period = context.periods.find((item) => item.id === window.periodId);
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
  const subjects = cloneWithGrades(
    context.yearSubjects,
    (grade) => grade.passedAt >= from && grade.passedAt <= to,
  );
  return { subjects, from, to };
}

function scopeSubjects(
  definition: WidgetDefinitionV1,
  subjects: readonly Subject[],
): { subjects: Subject[]; scope: PreparedWidgetData["scope"] } {
  const selected = definition.query.scope;
  const graph = new SubjectGraph(subjects);
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
  definition: WidgetDefinitionV1,
  context: WidgetEvaluationContext,
): PreparedWidgetData {
  const windowed = windowedSubjects(definition, context);
  let selected = scopeSubjects(definition, windowed.subjects);

  if (definition.query.scope.kind === "custom-average") {
    const averageId = definition.query.scope.averageId;
    const custom = context.customAverages.find((item) => item.id === averageId);
    if (custom) {
      const resolved = resolveCustomAverage(
        new SubjectGraph(selected.subjects),
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
    const graph = new SubjectGraph(selected.subjects);
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
  let graph = new SubjectGraph(subjects);
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
): CardContext {
  return {
    ...context,
    graph: data.graph,
    subjects: data.subjects,
    scope: data.scope,
    from: data.from,
    to: data.to,
    resolveTarget: () => ({
      graph: data.graph,
      subjects: data.subjects,
      scope: data.scope,
      subjectId: null,
    }),
  };
}

function cardSpec(definition: WidgetDefinitionV1): CardSpec {
  const projection = cardSemanticsFromDefinition(definition);
  return {
    id: "widget-evaluation",
    metric: projection.metric,
    target: { kind: "general", referenceId: null },
    display: projection.display,
    span: 1,
    title: null,
    accent: null,
    goalId: projection.goalId,
    sortOrder: 0,
    hidden: false,
  };
}

function formulaContext(
  definition: WidgetDefinitionV1,
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
      const subDefinition: WidgetDefinitionV1 = {
        ...definition,
        query: {
          ...definition.query,
          scope: node.scope ?? definition.query.scope,
          window: node.window ?? definition.query.window,
        },
        analysis: {
          measure: { kind: "metric", metric: node.metric, goalId: null },
          groupBy: { kind: "none" },
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
        cardContext(subData, context),
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
  definition: WidgetDefinitionV1,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
): { value: number | null; card: CardResult | null } {
  if (definition.analysis.measure.kind === "formula") {
    return {
      value: evaluateWidgetFormula(
        definition.analysis.measure.formula,
        formulaContext(definition, data, context),
      ),
      card: null,
    };
  }
  const result = evaluateCard(cardSpec(definition), cardContext(data, context));
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

function datumForTime(
  definition: WidgetDefinitionV1,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  groupBy: Extract<WidgetGroupBy, { kind: "time" }>,
): WidgetSeriesDatum[] {
  const wantsSeries =
    definition.visualization.encoding.series?.field === "category" ||
    definition.visualization.encoding.color?.field === "category";
  if (wantsSeries) {
    const requestedIds =
      definition.query.scope.kind === "subjects"
        ? definition.query.scope.subjectIds
        : data.graph.roots.map((subject) => subject.id);
    const targets = requestedIds
      .map((id) => data.graph.byId(id))
      .filter((subject): subject is Subject => Boolean(subject))
      .slice(0, WIDGET_LIMITS.series);
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
          { ...data, subjects, graph: new SubjectGraph(subjects), scope: null },
          context,
          groupBy,
          subject.id,
          subject.name,
          WIDGET_LIMITS.seriesBuckets,
        );
      });
    }
  }
  return datumForTimeSingle(
    definition,
    data,
    context,
    groupBy,
    "all",
    null,
    WIDGET_LIMITS.seriesBuckets,
  );
}

function datumForTimeSingle(
  definition: WidgetDefinitionV1,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  groupBy: Extract<WidgetGroupBy, { kind: "time" }>,
  seriesKey: string,
  seriesLabel: string | null,
  bucketLimit: number,
): WidgetSeriesDatum[] {
  const buckets = new Map<string, Grade[]>();
  for (const grade of data.graph.allGrades()) {
    const key = dateKey(grade.passedAt, groupBy.interval);
    const list = buckets.get(key);
    if (list) list.push(grade);
    else buckets.set(key, [grade]);
  }
  const ordered = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  const running = new Set<string>();
  const values = ordered.map(([key, grades]) => {
    if (groupBy.accumulation === "running") {
      for (const grade of grades) running.add(grade.id);
    }
    const ids =
      groupBy.accumulation === "running"
        ? running
        : new Set(grades.map((grade) => grade.id));
    const subjects = cloneWithGrades(data.subjects, (grade) =>
      ids.has(grade.id),
    );
    const bucketData: PreparedWidgetData = {
      ...data,
      subjects,
      graph: new SubjectGraph(subjects),
    };
    const evaluated = evaluateScalar(definition, bucketData, context);
    return {
      key: `${seriesKey}:${key}`,
      label: key,
      date: localDate(key),
      value: evaluated.value,
      delta: null,
      count: groupBy.accumulation === "running" ? ids.size : grades.length,
      series: seriesLabel,
    };
  });
  // Bounded, never sampled: transforms downstream have to see every bucket.
  // If a window somehow exceeds the guard, the most recent buckets are the ones
  // worth keeping — but a year cannot get here.
  return values.length <= bucketLimit ? values : values.slice(-bucketLimit);
}

function datumForSubjects(
  definition: WidgetDefinitionV1,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  groupBy: Extract<WidgetGroupBy, { kind: "subject" }>,
): WidgetSeriesDatum[] {
  if (definition.analysis.measure.kind === "metric") {
    const options = { includeCategories: groupBy.includeCategories };
    const general = data.graph.ratio(null, data.scope);
    const direct =
      definition.analysis.measure.metric === "subjectRanking"
        ? rankSubjects(data.graph, options).map((entry) => ({
            id: entry.subject.id,
            label: entry.subject.name,
            value: entry.ratio,
            delta: general === null ? null : entry.ratio - general,
          }))
        : definition.analysis.measure.metric === "mostImproved"
          ? rankByImprovement(data.graph, options).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              value: entry.delta,
              delta: entry.delta,
            }))
          : definition.analysis.measure.metric === "steadiest"
            ? rankByConsistency(data.graph, options).map((entry) => ({
                id: entry.subject.id,
                label: entry.subject.name,
                value: entry.consistency,
                delta: null,
              }))
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
      (subject) => groupBy.includeCategories || subject.kind !== "category",
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
      graph: new SubjectGraph(subjects),
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
      result.sort((a, b) => sign * ((a.value ?? 0) - (b.value ?? 0)));
    } else if (transform.kind === "limit") {
      result = result.slice(0, transform.count);
    } else if (transform.kind === "moving-average") {
      result = result.map((item) => {
        const group = result.filter((entry) => entry.series === item.series);
        const index = group.findIndex((entry) => entry.key === item.key);
        const window = group
          .slice(Math.max(0, index - transform.points + 1), index + 1)
          .map((entry) => entry.value)
          .filter((value): value is number => value !== null);
        return {
          ...item,
          value: window.length
            ? window.reduce((sum, value) => sum + value, 0) / window.length
            : null,
        };
      });
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
  definition: WidgetDefinitionV1,
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
  const quantile = (p: number) => {
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return (
      (sorted[low] ?? 0) * (high - index) + (sorted[high] ?? 0) * (index - low)
    );
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const fence = (q3 - q1) * 1.5;
  return {
    min: sorted[0] ?? 0,
    q1,
    median: quantile(0.5),
    q3,
    max: sorted.at(-1) ?? 0,
    outliers: sorted.filter(
      (value) => value < q1 - fence || value > q3 + fence,
    ),
  };
}

function compareSeries(
  values: WidgetSeriesDatum[],
  definition: WidgetDefinitionV1,
): WidgetSeriesDatum[] {
  const comparison = definition.analysis.comparison;
  if (comparison.kind === "none") return values;
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

function compareTimeSeriesToPreviousWindow(
  values: WidgetSeriesDatum[],
  definition: WidgetDefinitionV1,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
  groupBy: Extract<WidgetGroupBy, { kind: "time" }>,
): WidgetSeriesDatum[] {
  const { definition: previousDefinition, data: previousData } =
    previousWidgetData(definition, data, context);
  const previousValues = applyTransforms(
    datumForTime(previousDefinition, previousData, context, groupBy),
    definition.analysis.transforms,
  );
  const previousByBucket = new Map(
    previousValues.flatMap((item) =>
      item.date
        ? [
            [
              `${item.series ?? ""}:${relativeBucketIndex(
                item.date,
                previousData.from,
                groupBy.interval,
              )}`,
              item.value,
            ] as const,
          ]
        : [],
    ),
  );
  return values.map((item) => {
    if (!item.date || item.value === null) return { ...item, delta: null };
    const previous = previousByBucket.get(
      `${item.series ?? ""}:${relativeBucketIndex(
        item.date,
        data.from,
        groupBy.interval,
      )}`,
    );
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
  definition: WidgetDefinitionV1,
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

function previousWidgetData(
  definition: WidgetDefinitionV1,
  data: PreparedWidgetData,
  context: WidgetEvaluationContext,
): { definition: WidgetDefinitionV1; data: PreparedWidgetData } {
  if (definition.query.window.kind === "last-grades") {
    const withoutComparison: WidgetDefinitionV1 = {
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
        graph: new SubjectGraph(subjects),
        from: previousGrades[0]?.passedAt ?? data.from,
        to: previousGrades.at(-1)?.passedAt ?? data.from,
      },
    };
  }
  const previous = previousWindowDefinition(definition, data);
  return { definition: previous, data: prepareWidgetData(previous, context) };
}

function previousWindowDefinition(
  definition: WidgetDefinitionV1,
  data: PreparedWidgetData,
): WidgetDefinitionV1 {
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
  definition: WidgetDefinitionV1,
  context: WidgetEvaluationContext,
): { definition: WidgetDefinitionV1; horizonTo: Date } | null {
  if (
    definition.analysis.measure.kind !== "metric" ||
    definition.analysis.measure.metric !== "goalProgress"
  ) {
    return null;
  }
  const goalId = definition.analysis.measure.goalId;
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

export function evaluateWidgetDefinition(
  input: WidgetDefinitionV1,
  context: WidgetEvaluationContext,
): WidgetEvaluationResult {
  const compiled = compileWidgetDefinition(input, { surface: context.surface });
  if (!compiled.plan) return { kind: "empty", shape: "scalar" };
  const { definition, resultShape, valueType } = compiled.plan;
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
  const goalEvaluation = goalEvaluationDefinition(definition, context);
  if (
    definition.analysis.measure.kind === "metric" &&
    definition.analysis.measure.metric === "goalProgress"
  ) {
    if (!goalEvaluation) return { kind: "empty", shape: "goal" };
    const data = prepareWidgetData(goalEvaluation.definition, context);
    const evaluated = evaluateCard(cardSpec(goalEvaluation.definition), {
      ...cardContext(data, context),
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

  if (definition.analysis.groupBy.kind === "time") {
    const transformed = applyTransforms(
      datumForTime(definition, data, context, definition.analysis.groupBy),
      definition.analysis.transforms,
    );
    const values =
      definition.analysis.comparison.kind === "previous-window"
        ? compareTimeSeriesToPreviousWindow(
            transformed,
            definition,
            data,
            context,
            definition.analysis.groupBy,
          )
        : compareSeries(transformed, definition);
    const drawn = downsampleSeriesForRender(values);
    return drawn.some((item) => item.value !== null)
      ? { kind: "series", shape: "temporal-series", values: drawn, valueType }
      : { kind: "empty", shape: "temporal-series" };
  }
  if (definition.analysis.groupBy.kind === "subject") {
    const values = applyTransforms(
      datumForSubjects(definition, data, context, definition.analysis.groupBy),
      definition.analysis.transforms,
    ).slice(0, definition.analysis.groupBy.limit);
    const compared =
      definition.analysis.comparison.kind === "previous-window"
        ? (() => {
            const { definition: previousDefinition, data: previousData } =
              previousWidgetData(definition, data, context);
            const previousValues = applyTransforms(
              datumForSubjects(
                previousDefinition,
                previousData,
                context,
                definition.analysis.groupBy,
              ),
              definition.analysis.transforms,
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
        : compareSeries(values, definition);
    const drawn = downsampleSeriesForRender(compared);
    return drawn.some((item) => item.value !== null)
      ? {
          kind: "series",
          shape: "categorical-series",
          values: drawn,
          valueType,
        }
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
      summary: distributionSummary(ratios),
    };
  }
  if (
    evaluated.card &&
    ["grade", "subject", "list", "streak", "goal"].includes(evaluated.card.kind)
  ) {
    const shape =
      evaluated.card.kind === "list"
        ? "records"
        : evaluated.card.kind === "grade" || evaluated.card.kind === "subject"
          ? "record"
          : evaluated.card.kind;
    if (
      (definition.visualization.mark === "table" ||
        definition.visualization.mark === "list") &&
      evaluated.card.kind === "list"
    ) {
      return {
        kind: "series",
        shape: "categorical-series",
        valueType,
        values: evaluated.card.items.map((item) => ({
          key: item.id,
          label: item.label,
          date: null,
          value: item.ratio ?? item.delta,
          delta: item.delta,
          count: data.graph.allGrades(item.id).length,
          series: null,
        })),
      };
    }
    return {
      kind: "structured",
      shape: shape as "record" | "records" | "streak" | "goal",
      value: evaluated.card,
    };
  }
  if (evaluated.value === null) return { kind: "empty", shape: resultShape };
  return {
    kind: "scalar",
    shape: "scalar",
    value: evaluated.value,
    valueType: valueType as WidgetValueType,
    delta:
      definition.analysis.comparison.kind === "previous-window"
        ? (() => {
            const previous = previousWindowValue(definition, data, context);
            return previous === null ? null : evaluated.value - previous;
          })()
        : withComparison(evaluated.value, definition),
  };
}
