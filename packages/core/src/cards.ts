import {
  activityStreaks,
  averageOverTime,
  consistency,
  dayRange,
  distribution,
  gradeRatios,
  improvement,
  median,
  passRate,
  passStreaks,
  projectedRatio,
  rankByConsistency,
  rankByImprovement,
  rankGrades,
  rankSubjects,
  standardDeviation,
  trend,
  type DistributionBucket,
  type SeriesPoint,
} from "./analytics";
import { SubjectGraph, gradeRatio, type Scope } from "./graph";
import { planGoal, type Goal, type GoalPlan } from "./goals";
import type { Ratio, Subject } from "./types";

/**
 * Dashboard cards.
 *
 * A card is data, not code: the user picks a metric, points it at something,
 * and chooses how it should look. The evaluator turns that into a small tagged
 * value the UI knows how to render, so adding a metric never means adding a
 * component and rearranging a dashboard never means a migration.
 */

export const CARD_METRICS = [
  "average",
  "averageTrend",
  "projection",
  "gradeCount",
  "lastGrade",
  "bestGrade",
  "worstGrade",
  "bestSubject",
  "worstSubject",
  "subjectRanking",
  "passRate",
  "median",
  "spread",
  "consistency",
  "improvement",
  "mostImproved",
  "steadiest",
  "passStreak",
  "activityStreak",
  "distribution",
  "goalProgress",
] as const;

export type CardMetric = (typeof CARD_METRICS)[number];

export type CardTargetKind = "general" | "subject" | "custom";

export interface CardTarget {
  kind: CardTargetKind;
  /** Subject id or custom-average id; `null` for the general average. */
  referenceId: string | null;
}

export type CardDisplay = "value" | "sparkline" | "chart" | "list" | "gauge";

export interface CardSpec {
  id: string;
  metric: CardMetric;
  target: CardTarget;
  display: CardDisplay;
  /** Column span in the dashboard grid. */
  span: 1 | 2 | 3 | 4;
  /** `null` falls back to the metric's own localised name. */
  title: string | null;
  /** Named accent from the theme, e.g. "chart-2". `null` uses the default. */
  accent: string | null;
  /** Goal to read, when `metric === "goalProgress"`. */
  goalId: string | null;
  sortOrder: number;
  hidden: boolean;
}

export interface CardContext {
  /** Graph restricted to the period the dashboard is showing. */
  graph: SubjectGraph;
  /** Same subjects, used for time series that walk back through the period. */
  subjects: readonly Subject[];
  scope: Scope | null;
  /** Window the dashboard covers, used for trends and sparklines. */
  from: Date;
  to: Date;
  passingRatio: number;
  goals: readonly Goal[];
  /** Expected remaining assessments per subject, for goal cards. */
  remaining?: (subjectId: string) => number;
  /** Resolves a custom average id to its own graph and scope. */
  resolveTarget: (target: CardTarget) => {
    graph: SubjectGraph;
    subjects: readonly Subject[];
    scope: Scope | null;
    subjectId: string | null;
  } | null;
}

export type CardResult =
  | { kind: "empty" }
  | {
      kind: "ratio";
      ratio: Ratio;
      delta: number | null;
      series: SeriesPoint[] | null;
    }
  | { kind: "count"; count: number; series: SeriesPoint[] | null }
  | { kind: "percent"; ratio: Ratio }
  | { kind: "scalar"; value: number | null; unit: "ratio" | "days" | "count" }
  | {
      kind: "subject";
      subjectId: string;
      name: string;
      ratio: Ratio;
      delta: number | null;
    }
  | {
      kind: "grade";
      gradeId: string;
      name: string;
      subjectId: string;
      subjectName: string;
      ratio: number;
      at: Date;
    }
  | {
      kind: "list";
      items: Array<{
        id: string;
        label: string;
        ratio: number | null;
        delta: number | null;
      }>;
    }
  | { kind: "distribution"; buckets: DistributionBucket[]; total: number }
  | { kind: "streak"; current: number; longest: number; alive: boolean }
  | { kind: "goal"; plan: GoalPlan };

const SERIES_POINTS = 24;

function seriesFor(
  context: CardContext,
  subjectId: string | null,
): SeriesPoint[] {
  const span = Math.max(
    1,
    Math.round(
      (context.to.getTime() - context.from.getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
  const step = Math.max(1, Math.ceil(span / SERIES_POINTS));
  return averageOverTime(
    context.subjects,
    dayRange(context.from, context.to, step),
    subjectId,
    context.scope,
  );
}

/**
 * Compute one card. Anything the metric cannot answer — no grades yet, a
 * deleted subject, a goal that vanished — comes back as `empty` rather than a
 * throw, because a dashboard is a collection of independent readings.
 */
export function evaluateCard(spec: CardSpec, context: CardContext): CardResult {
  const resolved = context.resolveTarget(spec.target);
  if (!resolved) return { kind: "empty" };

  const { graph, scope, subjectId } = resolved;
  const localContext: CardContext = {
    ...context,
    graph,
    subjects: resolved.subjects,
    scope,
  };

  switch (spec.metric) {
    case "average": {
      const ratio = graph.ratio(subjectId, scope);
      if (ratio === null) return { kind: "empty" };
      const series =
        spec.display === "value" ? null : seriesFor(localContext, subjectId);
      const first =
        series?.find((point) => point.ratio !== null)?.ratio ?? null;
      return {
        kind: "ratio",
        ratio,
        delta: first === null ? null : ratio - first,
        series,
      };
    }

    case "averageTrend": {
      const series = seriesFor(localContext, subjectId);
      const slope = trend(series);
      if (slope === null) return { kind: "empty" };
      return { kind: "scalar", value: slope, unit: "ratio" };
    }

    case "projection": {
      const series = seriesFor(localContext, subjectId);
      const projected = projectedRatio(series, Math.round(SERIES_POINTS / 3));
      if (projected === null) return { kind: "empty" };
      const current = graph.ratio(subjectId, scope);
      return {
        kind: "ratio",
        ratio: projected,
        delta: current === null ? null : projected - current,
        series,
      };
    }

    case "gradeCount": {
      const count = graph.allGrades(subjectId ?? undefined).length;
      if (count === 0) return { kind: "empty" };
      return { kind: "count", count, series: null };
    }

    case "lastGrade": {
      const grades = graph.allGrades(subjectId ?? undefined);
      const last = grades.at(-1);
      if (!last) return { kind: "empty" };
      const ratio = gradeRatio(last);
      if (ratio === null) return { kind: "empty" };
      const subject = graph.byId(last.subjectId);
      return {
        kind: "grade",
        gradeId: last.id,
        name: last.name,
        subjectId: last.subjectId,
        subjectName: subject?.name ?? "",
        ratio,
        at: last.passedAt,
      };
    }

    case "bestGrade":
    case "worstGrade": {
      const ranked = rankGrades(graph, subjectId ?? undefined);
      const entry = spec.metric === "bestGrade" ? ranked[0] : ranked.at(-1);
      if (!entry) return { kind: "empty" };
      return {
        kind: "grade",
        gradeId: entry.grade.id,
        name: entry.grade.name,
        subjectId: entry.subject.id,
        subjectName: entry.subject.name,
        ratio: entry.ratio,
        at: entry.grade.passedAt,
      };
    }

    case "bestSubject":
    case "worstSubject": {
      const ranked = rankSubjects(graph).filter(
        (entry) => entry.subject.id !== subjectId,
      );
      const entry = spec.metric === "bestSubject" ? ranked[0] : ranked.at(-1);
      if (!entry) return { kind: "empty" };
      const general = graph.ratio(subjectId, scope);
      return {
        kind: "subject",
        subjectId: entry.subject.id,
        name: entry.subject.name,
        ratio: entry.ratio,
        delta: general === null ? null : entry.ratio - general,
      };
    }

    case "subjectRanking": {
      const ranked = rankSubjects(graph);
      if (ranked.length === 0) return { kind: "empty" };
      const general = graph.ratio(null, scope);
      return {
        kind: "list",
        items: ranked.map((entry) => ({
          id: entry.subject.id,
          label: entry.subject.name,
          ratio: entry.ratio,
          delta: general === null ? null : entry.ratio - general,
        })),
      };
    }

    case "mostImproved":
    case "steadiest": {
      const ranked =
        spec.metric === "mostImproved"
          ? rankByImprovement(graph).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              ratio: null,
              delta: entry.delta,
            }))
          : rankByConsistency(graph).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              ratio: entry.consistency,
              delta: null,
            }));
      if (ranked.length === 0) return { kind: "empty" };
      return { kind: "list", items: ranked };
    }

    case "passRate": {
      const ratios = gradeRatios(graph, subjectId ?? undefined);
      const rate = passRate(ratios, context.passingRatio);
      if (rate === null) return { kind: "empty" };
      return { kind: "percent", ratio: rate };
    }

    case "median": {
      const value = median(gradeRatios(graph, subjectId ?? undefined));
      if (value === null) return { kind: "empty" };
      return { kind: "ratio", ratio: value, delta: null, series: null };
    }

    case "spread": {
      const value = standardDeviation(
        gradeRatios(graph, subjectId ?? undefined),
      );
      if (value === null) return { kind: "empty" };
      return { kind: "scalar", value, unit: "ratio" };
    }

    case "consistency": {
      const value = consistency(gradeRatios(graph, subjectId ?? undefined));
      if (value === null) return { kind: "empty" };
      return { kind: "percent", ratio: value };
    }

    case "improvement": {
      const value = improvement(gradeRatios(graph, subjectId ?? undefined));
      if (value === null) return { kind: "empty" };
      return { kind: "scalar", value, unit: "ratio" };
    }

    case "passStreak": {
      const streaks = passStreaks(
        graph.allGrades(subjectId ?? undefined),
        context.passingRatio,
      );
      if (streaks.longest.length === 0) return { kind: "empty" };
      return {
        kind: "streak",
        current: streaks.current.length,
        longest: streaks.longest.length,
        alive: streaks.current.length > 0,
      };
    }

    case "activityStreak": {
      const streaks = activityStreaks(graph.allGrades(subjectId ?? undefined));
      if (streaks.longest.length === 0) return { kind: "empty" };
      return {
        kind: "streak",
        current: streaks.current.length,
        longest: streaks.longest.length,
        alive: streaks.current.length > 0,
      };
    }

    case "distribution": {
      const ratios = gradeRatios(graph, subjectId ?? undefined);
      if (ratios.length === 0) return { kind: "empty" };
      return {
        kind: "distribution",
        buckets: distribution(ratios),
        total: ratios.length,
      };
    }

    case "goalProgress": {
      const goal = context.goals.find((item) => item.id === spec.goalId);
      if (!goal) return { kind: "empty" };
      const series = seriesFor(localContext, subjectId);
      const plan = planGoal(goal, graph, subjectId, scope, {
        projection: projectedRatio(series, Math.round(SERIES_POINTS / 3)),
        remaining: context.remaining,
      });
      return { kind: "goal", plan };
    }

    default:
      return { kind: "empty" };
  }
}

/** The dashboard a brand-new year starts with. Deliberately short. */
export function defaultCards(): CardSpec[] {
  const base = {
    target: { kind: "general", referenceId: null } as CardTarget,
    title: null,
    accent: null,
    goalId: null,
    hidden: false,
  };

  return [
    {
      ...base,
      id: "average",
      metric: "average",
      display: "sparkline",
      span: 2,
      sortOrder: 0,
    },
    {
      ...base,
      id: "best-subject",
      metric: "bestSubject",
      display: "value",
      span: 1,
      sortOrder: 1,
    },
    {
      ...base,
      id: "worst-subject",
      metric: "worstSubject",
      display: "value",
      span: 1,
      sortOrder: 2,
    },
    {
      ...base,
      id: "last-grade",
      metric: "lastGrade",
      display: "value",
      span: 1,
      sortOrder: 3,
    },
    {
      ...base,
      id: "pass-rate",
      metric: "passRate",
      display: "gauge",
      span: 1,
      sortOrder: 4,
    },
    {
      ...base,
      id: "ranking",
      metric: "subjectRanking",
      display: "list",
      span: 2,
      sortOrder: 5,
    },
  ];
}

/**
 * Laying a dashboard out.
 *
 * A card stores one width — `span`, in quarters of a row — and every surface
 * reads that same number. A phone has two columns rather than four, so the
 * stored width is rescaled rather than ignored: the quarter-row card a student
 * built on a laptop is the half-row card on their phone, and the order and the
 * relative emphasis they arranged survive the trip.
 *
 * Two things then stop the result from looking accidental. A display has a
 * width below which it stops being readable — a sparkline squeezed into half a
 * phone row is a smudge — so it is widened to that floor. And a row that does
 * not come out full is filled by growing its cards evenly, unless doing so
 * would more than double one of them, which is the case where the hole is the
 * lesser evil.
 */

/** The stored `span` is a count of these. */
const SPAN_UNITS = 4;

/** A card as some particular grid will draw it. */
export interface PlacedCard {
  spec: CardSpec;
  /** Columns it occupies in that grid. */
  columns: number;
}

/**
 * The narrowest this card stays legible, in columns of the given grid.
 *
 * Only drawings have a floor. A chart, a sparkline or a ranking needs width to
 * be a drawing at all, so it takes the whole of a two-column row and half of a
 * wider one. Everything else is left alone: a grid only gains a column once it
 * has the width to carry one, so a column is never a sliver, and a floor on
 * text cards would buy nothing but a duller dashboard on a large screen.
 *
 * `display` is the whole of the input, and `metric` used to be in the signature
 * without ever being read — which invited the worry that layout depends on a
 * *lossy* reading of a card. It does not, and the distinction it needs survives
 * that reading intact: `markToDisplay` is total over the marks and sends `value`
 * and `gauge` here and everything else to the floor, so a sparkline arriving as
 * `"chart"` gets exactly the floor a sparkline wants. A mark added later falls
 * through to `"chart"` too, which is the safe answer rather than the lucky one.
 */
function minColumns(spec: Pick<CardSpec, "display">, columns: number): number {
  if (columns <= 1) return 1;
  if (spec.display === "value" || spec.display === "gauge") return 1;
  return columns <= 2 ? columns : Math.min(2, columns);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The width a single card asks for on a grid this wide, before packing. */
export function cardColumns(
  spec: Pick<CardSpec, "span" | "display">,
  columns: number,
): number {
  const scaled = Math.round((spec.span * columns) / SPAN_UNITS);
  const floor = minColumns(spec, columns);
  return clamp(Math.max(scaled, floor), 1, columns);
}

/**
 * Hand the spare columns out one at a time, and keep whatever was handed out.
 *
 * The rule has always been that a card must not end up more than twice the width
 * it asked for — widen it further and it is no longer the card its owner
 * arranged. The old implementation enforced that by distributing *all* the spare
 * space and then cancelling the whole distribution if any single card had gone
 * too far, which is all-or-nothing where the rule is per-card. On four columns a
 * lone quarter-width card was pushed to four, found to be over its cap, and
 * reset to one — leaving three columns empty when two was allowed and better.
 *
 * Growing one column at a time, always to the card that has grown least
 * relative to what it asked for, and only while that card is still under its own
 * cap, is maximal under the same constraint: it stops only when the row is full
 * or when no card may legally grow.
 */
function fillRowBounded(row: PackedCard[], columns: number): void {
  let spare =
    columns - row.reduce((total, card) => total + card.renderedColumns, 0);

  while (spare > 0) {
    let target: PackedCard | null = null;
    for (const card of row) {
      // Never past twice the request, and never past the grid itself — a lone
      // card on a wide row is capped by the row, not by its own doubling.
      const cap = Math.min(columns, card.requestedColumns * 2);
      if (card.renderedColumns >= cap) continue;
      // Narrowest first, by absolute width, which is what evens a row out.
      // Growing whichever card is least over-grown *relative* to its request
      // would also be maximal, and gives `[3, 1]` where this gives `[2, 2]` —
      // proportionally fair, visually lopsided. A grid wants the even one.
      // Ties fall to the earlier card, so the answer belongs to the canonical
      // order rather than to iteration order.
      if (!target || card.renderedColumns < target.renderedColumns) {
        target = card;
      }
    }
    if (!target) break;
    target.renderedColumns += 1;
    spare -= 1;
  }

  for (const card of row) {
    card.grewToFill = card.renderedColumns > card.requestedColumns;
  }
}

export interface PackedCard {
  spec: CardSpec;
  /** Width before the row's spare columns were handed out. */
  requestedColumns: number;
  /** Width actually drawn. */
  renderedColumns: number;
  rowIndex: number;
  /** First column occupied, zero-based, counted over *drawn* widths. */
  columnStart: number;
  /** Whether packing widened this card to close a gap. */
  grewToFill: boolean;
}

export interface PackedRow {
  index: number;
  cards: PackedCard[];
  /** Columns the row's cards asked for, before filling. */
  requestedColumns: number;
  /** Columns the row draws. */
  renderedColumns: number;
  /**
   * Room a further card could still ask for. Measured against the *requested*
   * widths, not the drawn ones: a row whose hole was closed by widening a card
   * still had that hole, and a card that would have fitted it still fits.
   */
  remainingColumns: number;
}

export interface PackedCardGrid {
  columns: number;
  rows: PackedRow[];
  cards: PackedCard[];
  byId: Map<string, PackedCard>;
}

/**
 * The one place a row is opened or closed.
 *
 * There used to be two walks: `layoutCards` produced widths, and `layoutCardGrid`
 * walked the same cards again to rebuild the row boundaries the drag needed. They
 * agreed, and a comment said so — but agreement maintained by hand is a thing to
 * keep agreeing, and the day a closing rule or a minimum width moved, the
 * renderer and the reorder resolver would have been talking about different rows
 * with nothing failing to say so.
 *
 * Everything else here is derived from this: the widths, the rows, the cells.
 */
export function packCardGrid(
  specs: readonly CardSpec[],
  columns: number,
): PackedCardGrid {
  const width = Math.max(1, Math.floor(columns));
  const cards: PackedCard[] = specs.map((spec) => {
    const requested = cardColumns(spec, width);
    return {
      spec,
      requestedColumns: requested,
      renderedColumns: requested,
      rowIndex: 0,
      columnStart: 0,
      grewToFill: false,
    };
  });

  const rows: PackedRow[] = [];
  let current: PackedCard[] = [];
  let requestedUsed = 0;

  const closeRow = () => {
    if (current.length === 0) return;
    fillRowBounded(current, width);
    let columnStart = 0;
    for (const card of current) {
      card.columnStart = columnStart;
      columnStart += card.renderedColumns;
    }
    rows.push({
      index: rows.length,
      cards: current,
      requestedColumns: requestedUsed,
      renderedColumns: current.reduce(
        (total, card) => total + card.renderedColumns,
        0,
      ),
      remainingColumns: Math.max(0, width - requestedUsed),
    });
    current = [];
    requestedUsed = 0;
  };

  for (const card of cards) {
    if (requestedUsed > 0 && requestedUsed + card.requestedColumns > width) {
      closeRow();
    }
    card.rowIndex = rows.length;
    current.push(card);
    requestedUsed += card.requestedColumns;
    if (requestedUsed >= width) closeRow();
  }
  closeRow();

  return {
    columns: width,
    rows,
    cards,
    byId: new Map(cards.map((card) => [card.spec.id, card])),
  };
}

/**
 * Place cards on a grid `columns` wide, in their stored order.
 *
 * Pure and shared: the dashboard, the phone and the editor's preview all call
 * this, which is what makes the preview honest on whichever device is editing.
 * A view of `packCardGrid` for callers that only need the widths.
 */
export function layoutCards(
  specs: readonly CardSpec[],
  columns: number,
): PlacedCard[] {
  return packCardGrid(specs, columns).cards.map((card) => ({
    spec: card.spec,
    columns: card.renderedColumns,
  }));
}

/**
 * The widths a grid this wide can actually offer, as stored spans.
 *
 * The editor asks for these rather than hard-coding quarter/half/full, so a
 * phone offers the two widths a phone has and a laptop offers four.
 */
export function availableSpans(
  spec: Pick<CardSpec, "display" | "metric">,
  columns: number,
): Array<{ span: CardSpec["span"]; columns: number }> {
  const seen = new Map<number, CardSpec["span"]>();
  for (const span of [1, 2, 3, 4] as const) {
    const width = cardColumns({ ...spec, span }, columns);
    // The narrowest span that reaches a width is the one to store: it keeps
    // the card as small as it can be on the surfaces that have room for more.
    if (!seen.has(width)) seen.set(width, span);
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([width, span]) => ({ span, columns: width }));
}

/**
 * The span to store when someone picks a width on a grid this wide.
 *
 * Editing on a phone must not flatten the desktop layout, so a stored span
 * that already draws at the chosen width is kept untouched. Only a real change
 * of width rewrites it, and then to the nearest span that draws it.
 */
export function spanForColumns(
  current: CardSpec["span"],
  chosen: number,
  spec: Pick<CardSpec, "display" | "metric">,
  columns: number,
): CardSpec["span"] {
  if (cardColumns({ ...spec, span: current }, columns) === chosen)
    return current;

  const candidates = ([1, 2, 3, 4] as const).filter(
    (span) => cardColumns({ ...spec, span }, columns) === chosen,
  );
  if (candidates.length === 0) return current;

  return candidates.reduce((best, span) =>
    Math.abs(span - current) < Math.abs(best - current) ? span : best,
  );
}

/** Displays that make sense for a metric, so the editor never offers nonsense. */
export function allowedDisplays(metric: CardMetric): CardDisplay[] {
  switch (metric) {
    case "average":
    case "projection":
      return ["value", "sparkline", "chart"];
    case "median":
      return ["value"];
    case "passRate":
    case "consistency":
      return ["value", "gauge"];
    case "subjectRanking":
    case "mostImproved":
    case "steadiest":
      return ["list"];
    case "distribution":
      return ["chart"];
    case "goalProgress":
      return ["gauge", "chart"];
    case "gradeCount":
      return ["value", "sparkline"];
    default:
      return ["value"];
  }
}
