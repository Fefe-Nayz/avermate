import {
  activityStreaks,
  averageOverTime,
  consistency,
  dayRange,
  distribution,
  gradeImpact,
  gradeRatios,
  improvement,
  median,
  passRate,
  passStreaks,
  projectedRatio,
  rankByConsistency,
  rankByImprovement,
  rankGrades,
  dispersionOf,
  rankSubjects,
  standardDeviation,
  trend,
  type DistributionBucket,
  type SeriesPoint,
  type WidgetDispersion,
} from "./analytics";
import type { ContributionStep } from "./contributions";
import { projectionBand, type ProjectionBand } from "./projection";
import {
  coefficientWeight,
  gradeRatio,
  SubjectGraph,
  type Scope,
} from "./graph";
import {
  leverageOf,
  nextAssessmentLeverage,
  planGoal,
  REALISTIC_CEILING,
  type Goal,
  type GoalPlan,
  type GoalStatus,
} from "./goals";
import type { Ratio, Subject } from "./types";
import type { CohortStanding } from "./cohort";
import type { SubjectComparisonRow } from "./friend";
import { controlBand, type ControlBand } from "./control";
import { widgetRecipeLayout, type WidgetChartRecipe } from "./widget-recipes";
import type { WidgetEmptyReason } from "./widget-types";

/**
 * Earlier marks a subject needs before its level means anything.
 *
 * Five, and the number is a judgement rather than a theorem: with four, the spread is
 * estimated from three degrees of freedom and nearly every result is two deviations from
 * something. A card that cries wolf about a normal mark is worse than one that says
 * nothing.
 */
export const ANOMALY_MINIMUM_SAMPLE = 5;

/** How far from the level a mark must sit before it is worth remarking on. */
export const ANOMALY_THRESHOLD = 2;

/**
 * Marks considered when looking for the one that moves the average most.
 *
 * Two averages are computed per mark, so this bounds the work rather than the meaning. A
 * school year is a few hundred marks and stays well under it; a window that somehow held
 * more would be answered from its most recent, which is what a reader is asking about.
 */
export const MARK_IMPACT_LIMIT = 500;

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
  /**
   * How much of the general average each subject carries.
   *
   * The share a subject holds after every level of nesting — move it from zero to
   * full marks and the average moves by exactly this. Read as a percentage
   * because that is what it is: "Mathematics carries 18% of your average" is the
   * sentence, and it answers *where effort pays* without naming a goal.
   *
   * Computed by `leverageOf`, the same function the goal planner's levers use, so
   * a card and the goal screen cannot disagree about the same subject.
   *
   * Not to be confused with the leverage of the *next assessment*, which is this
   * share multiplied by that assessment's weight inside the subject. The two are
   * different questions and must not share a card.
   */
  "leverage",
  /**
   * The single mark that moves the average most, and by how much.
   *
   * The counterfactual the audit asks for, and it is arithmetic rather than prediction:
   * remove one result and recompute. `gradeImpact` has been able to answer it for one mark
   * since the grade pages were written — what was missing is the *selection*, which is the
   * whole reading: "one mark is costing you six tenths" is a sentence, and a list of marks
   * is homework.
   *
   * Said as a scenario in the card, never as advice: the mark happened, and nothing here
   * suggests it can be undone.
   */
  "markImpact",
  /**
   * Which subject to work on next, and what it is worth.
   *
   * The two halves the app could compute and never put together: how far the *next* mark
   * in a subject can move the average, and how much room that subject has left. Their
   * product is a real quantity — points of the general average — rather than a ranking
   * with no unit, so a reader can tell a worthwhile choice from a marginal one.
   *
   * Deliberately without a goal. `requiredResult` already answers "what do I need for this
   * target"; this answers "where does effort pay", which is the question when there is no
   * target or when the target is already out of reach.
   */
  "nextBestAction",
  /**
   * Where you stand in a class, and what that is allowed to say.
   *
   * The four readings a group makes possible, and the reason they arrived last: they are
   * the only ones in this list that are about *other people*. Each needs a group whose
   * owner opened it to cards, and each reads only the members who left their own sharing
   * switch on — so what a card shows is a comparison against those who agreed to be
   * compared, which is why `cohortStanding` never calls it the class average.
   */
  "cohortRank",
  "cohortAverage",
  "cohortGap",
  /** One named member's average — the "how is Amélie doing" card. */
  "memberAverage",
  /**
   * The three readings a friendship makes possible.
   *
   * A friend is not a cohort: nobody is ranked, nothing is aggregated, and the comparison
   * is between two people who each decided what to show the other. `friendAverage` is
   * their general average, `friendCurves` is the two averages drawn together over the
   * year, and `friendSubjects` is the two subject lists side by side.
   *
   * Each reads only what its owner opened, and the three locks are separate: a friend can
   * share their subjects and not their average, or their average and not its history. The
   * cards say which of those is missing rather than showing a blank.
   */
  "friendAverage",
  "friendCurves",
  "friendSubjects",
  /**
   * The whole run of marks, against the spread it has been running at.
   *
   * The control chart the audit asks for, and the companion to `anomaly` rather than a
   * second version of it: that one judges the latest mark and says whether it is strange,
   * this one draws every mark and says how strange the run is. Descriptive throughout —
   * the band is where results have *been*, and nothing here explains why one fell outside.
   */
  "controlBand",
  /**
   * The most recent mark that does not look like the rest.
   *
   * Not a diagnosis. It reports a distance — how far a subject's latest result sits from
   * that subject's own earlier level — and refuses to report one at all below a sample
   * where the level is not established. The audit is explicit that this must read as
   * description rather than as statistics, and the guard is what makes that true: with
   * four earlier marks, almost anything is two standard deviations from something.
   */
  "anomaly",
  /**
   * How few subjects the average rests on.
   *
   * The risk reading of the same weights the treemap draws: a year whose average is half
   * carried by two subjects is one bad term away from moving a long way, and nothing on
   * the dashboard said so. Derived from the effective weights — the whole path of
   * coefficients, not the local one — so it agrees with `weightBreakdown` by construction.
   */
  "concentration",
  /**
   * How far the *next* mark in each subject can move the average.
   *
   * The other half of the sentence `leverage` refuses to say. That one is a subject's
   * structural share, and it answers "where does my average come from". This one is that
   * share diluted by how much the subject has already been graded on, and it answers the
   * question a person actually asks before an assessment: *which of these is worth
   * preparing for*.
   *
   * A subject with one mark and a subject with twelve carry the same weight in the year
   * and are not the same opportunity. Computed by `nextAssessmentLeverage`, which plants a
   * hypothetical result rather than trusting a formula.
   */
  "nextLeverage",
  /**
   * The mark the next assessment has to be for a goal to still be met.
   *
   * The most actionable number this app can show, and it was already computed:
   * `planGoal` returns a required result per candidate subject with that
   * subject's coefficient, plus the same answer read at several horizons. Nothing
   * here derives anything — it selects, so the card and the goal screen say the
   * same number by construction.
   */
  "requiredResult",
  /**
   * Which subjects have been assessed, and which have not.
   *
   * The one metric that *completes* its domain instead of reporting what it
   * found. Every other subject-grouped reading lists the subjects that produced a
   * value, so a subject with no grades yet simply does not appear — and "no row"
   * is indistinguishable from "not in scope", which is exactly the gap a coverage
   * reading exists to close.
   *
   * The four states the audit asks to be told apart are all expressible in the
   * datum this produces, without a new field:
   *
   * - **absent from scope** — no row at all
   * - **present, never assessed** — a row with `value: null` and `count: 0`
   * - **assessed, no computable average** — `value: null` with `count > 0`
   * - **an average of zero** — `value: 0` with `count > 0`
   *
   * Completion is a property of this metric rather than of subject grouping in
   * general, deliberately: adding null rows to a *ranking* of averages would list
   * subjects that have no average among those that do, which is a different
   * reading and a worse one.
   */
  "coverage",
  /**
   * How much room a goal that is being met still has.
   *
   * The mirror of `requiredResult`, and the more useful reading once a goal is
   * held: not "what do I need" but "what would lose it". Both come out of the same
   * inversion `planGoal` already performs — the mark that lands the tracked average
   * exactly on the target — read from above instead of from below.
   *
   * Nothing is derived here either. The margin is `current - target`, and the mark
   * that would break it is the most demanding of the plan's own next results:
   * score under that and the average falls back through the target. When even a
   * zero everywhere keeps the goal, the plan says so — `alreadySecured` — and the
   * card says secured rather than inventing a threat.
   */
  "safetyMargin",
  /**
   * Where the general average actually comes from, as a tree.
   *
   * The same numbers as `leverage` — every subject's effective weight at the top,
   * after every level of nesting — arranged as the hierarchy they live in rather
   * than as a flat ranking. That is not a cosmetic difference: the flat reading
   * answers "which subject carries the most", and the tree answers "which *branch*
   * carries the most", which is the question a reader with categories has.
   *
   * Two invariants, both tested: the leaves sum to the whole, and a category is
   * exactly the sum of its children. A category is therefore never a contribution
   * of its own — counting a branch and its leaves in one total is the classic way
   * a weight chart adds up to two hundred per cent.
   */
  "weightBreakdown",
  /**
   * Why the general average moved between one window and the one before it.
   *
   * Computed in the evaluator rather than here, and that is not an oversight: this is
   * the one reading that needs *two* windows, and `evaluateCard` is handed one graph.
   * `contributionBreakdown` does the arithmetic — exactly, including the cases where
   * a subject arrived, left, or changed coefficient — and the evaluator is where both
   * windows exist.
   */
  "contributions",
  /**
   * Where the average could end up, as scenarios rather than as a forecast.
   *
   * Three paths replaying the reader's own quartiles over the assessments still to
   * come — see `projectionBand`, which is careful about what such a band may be
   * called. It is a scenario band: no distribution is assumed and no coverage is
   * claimed, and the words "confidence" and "prediction" are reserved for bands that
   * have earned them.
   */
  "projectionBand",
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
  /**
   * What the card *is*, for layout.
   *
   * `display` is a four-way projection of the mark and was the whole of the
   * layout's input, so a sparkline, a table, a radar and an eight-series chart
   * all asked for the same width. The recipe is derived from the definition — see
   * `widgetRecipeFor` — and carries a policy of its own.
   */
  recipe: WidgetChartRecipe;
  /** Column span in the dashboard grid. */
  span: 1 | 2 | 3 | 4;
  /** `null` falls back to the metric's own localised name. */
  title: string | null;
  /** Named accent from the theme, e.g. "chart-2". `null` uses the default. */
  accent: string | null;
  /** Goal to read, for the metrics that measure one. */
  goalId: string | null;
  /**
   * How to measure a spread, for the metrics that measure one — see
   * `WidgetDispersion`. Absent is the standard deviation.
   */
  dispersion?: WidgetDispersion;
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
  /**
   * Nothing to show — and, where the metric knows one, why.
   *
   * The reason travels with the result rather than being re-derived by whoever renders it:
   * only the metric knows the difference between "no marks yet" and "every recent mark
   * looks like the rest", and the second is a reading rather than a failure.
   */
  | { kind: "empty"; reason?: WidgetEmptyReason }
  | {
      kind: "ratio";
      ratio: Ratio;
      delta: number | null;
      series: SeriesPoint[] | null;
    }
  | { kind: "count"; count: number; series: SeriesPoint[] | null }
  | { kind: "percent"; ratio: Ratio }
  | {
      kind: "scalar";
      value: number | null;
      unit: "ratio" | "days" | "count";
      /**
       * How many observations the reading rests on, where that changes how much
       * of it to believe — a spread over three marks is a rumour. `sufficient`
       * is false when the estimator's own minimum was not met, which is the one
       * case where `value` is null and the card still has something to say.
       */
      sample?: { count: number; sufficient: boolean };
      /** Named on the reading, so two cards with different estimators are not
       * mistaken for the same measurement. */
      dispersion?: WidgetDispersion;
    }
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
  | { kind: "goal"; plan: GoalPlan }
  /**
   * What still has to happen for a goal to be met.
   *
   * A selection from a `GoalPlan` rather than a computation: `next` is the
   * cheapest assessment that still reaches the target, `horizon` the same answer
   * read as "N more results at X". `null` on either means the plan offers no such
   * route — which is a reading, not an error, and the status says which.
   */
  | {
      kind: "required";
      status: GoalStatus;
      goalName: string;
      target: number;
      current: Ratio;
      gap: number | null;
      next: {
        subjectId: string;
        subjectName: string;
        coefficient: number;
        requiredRatio: number;
        achievable: boolean;
        alreadySecured: boolean;
      } | null;
      horizon: { count: number; requiredRatio: number } | null;
    }
  /**
   * How much room a goal that is being met still has, and what would take it.
   *
   * `margin` is signed: positive is the distance above the target, negative means
   * the goal is not currently held and the card reads as a shortfall rather than a
   * cushion. `breaking` is the assessment that most easily loses it — the highest
   * mark still required among the plan's candidates — and is `null` when nothing
   * remaining can, which `secured` states outright.
   */
  | {
      kind: "margin";
      status: GoalStatus;
      goalName: string;
      target: number;
      current: Ratio;
      margin: number | null;
      breaking: {
        subjectId: string;
        subjectName: string;
        coefficient: number;
        ratio: number;
      } | null;
      secured: boolean;
    }
  /**
   * What one mark is costing, or worth.
   *
   * The average as it is, and as it would be without that single result. A fact rather
   * than a scenario — the arithmetic of removing a number — which is why it is worth
   * saying plainly: "one mark is costing you six tenths" is actionable in a way that a
   * list of marks is not.
   */
  | {
      kind: "impact";
      gradeId: string;
      gradeName: string;
      subjectId: string;
      subjectName: string;
      /** The mark itself. */
      ratio: number;
      /** The general average as it stands. */
      withMark: number;
      /** What it would be without that mark. */
      withoutMark: number;
      at: Date;
    }
  /**
   * Where the reader stands in a group.
   *
   * Its own kind because every part of it is load-bearing: a rank without the size of the
   * group is meaningless, a size without the number of members who share nothing is
   * misleading, and both without the group's name leave a reader wondering *which*
   * comparison this is.
   */
  | ({ kind: "standing" } & CohortStanding)
  /**
   * Two averages over the same year.
   *
   * The reader's own curve and a friend's, each with its own scale — because two people's
   * years need not be marked out of the same number, and drawing them on one axis without
   * saying so would be the chart lying about a comparison it cannot make.
   */
  | {
      kind: "curves";
      name: string;
      scale: number;
      /** Their scale, which the renderer normalises against before drawing. */
      theirScale: number;
      mine: Array<{ at: Date; ratio: number }>;
      theirs: Array<{ at: Date; ratio: number }>;
    }
  /**
   * Two subject lists, matched by name.
   *
   * Rows only one side has are kept: a subject a friend does not share is a fact about
   * the comparison, and dropping it would make the two lists look more alike than they
   * are.
   */
  | {
      kind: "subject-comparison";
      name: string;
      rows: SubjectComparisonRow[];
      /** Subjects the friend keeps private, counted rather than listed. */
      hidden: number;
    }
  /**
   * One named member's average.
   *
   * The name is the reading — "Amélie, 14.2" — so it travels with the number rather than
   * being looked up by a renderer that would have to be given the group as well.
   */
  | {
      kind: "member";
      /**
       * Where this person is being read from — a class, or their own year.
       *
       * Named for the question rather than for one of its answers: the same card shows a
       * classmate through a group and a friend through a friendship, and `groupName` was
       * only ever true of the first.
       */
      from: string;
      name: string;
      average: number;
    }
  /**
   * Where one more mark buys the most.
   *
   * A subject, and *how much* — in points of the general average — working there is worth
   * compared with carrying on as usual. Both halves matter: "Physics" alone is advice, and
   * a number alone is a statistic. The gain is a scenario and the card says so; it is not
   * a prediction and nothing here claims the mark will be got.
   */
  | {
      kind: "priority";
      subjectId: string;
      subjectName: string;
      /** The subject's own average today, `null` where it has none yet. */
      current: Ratio;
      /** The realistic level the gain is measured against. */
      reference: number;
      /** Points of the *general* average, as a ratio, the scenario is worth. */
      gain: number;
      /** The subject's share of the average, for the reader who asks why this one. */
      leverage: number;
    }
  /**
   * A recent mark that does not look like the rest.
   *
   * Descriptive and deliberately modest: it says how far the mark sits from that subject's
   * own earlier level, in standard deviations, and nothing about why. `sample` is how many
   * earlier marks that level was measured from, and it is carried because the reading is
   * worthless without it — two standard deviations from a level established by four marks
   * is a shrug.
   */
  | {
      kind: "anomaly";
      subjectId: string;
      subjectName: string;
      gradeId: string;
      gradeName: string;
      ratio: number;
      /** Signed: negative is below the subject's level. */
      deviations: number;
      /** Earlier marks the level was measured from. */
      sample: number;
      at: Date;
    }
  /**
   * How few subjects your average rests on.
   *
   * A share and the subjects that hold it: "half of your average rests on two subjects",
   * with those two named. The count is *derived*, not chosen — the smallest set of
   * subjects whose effective weights reach a half — because any fixed "top three" is an
   * arbitrary number that reads as a fact, and a year of four subjects and a year of
   * fourteen are not concentrated in the same way.
   *
   * `share` is what that set actually holds, so it is at least the half that defined it
   * and usually more. `total` is how many subjects carry any weight at all, which is what
   * makes the count mean something: two out of three is a normal year, two out of twelve
   * is a risk.
   */
  | {
      kind: "concentration";
      /** Share of the average the listed subjects carry together, 0 … 1. */
      share: number;
      /** How many subjects that is. */
      count: number;
      /** How many carry any weight at all. */
      total: number;
      subjects: Array<{ id: string; label: string; weight: number }>;
    }
  /**
   * A tree with a value on every node.
   *
   * Flat rows with a `parentId`, not nested objects: it is what every renderer of a
   * hierarchy actually wants, it serialises without recursion, and the depth is
   * carried so a reader of the list never has to walk it to know where a node sits.
   */
  | ({ kind: "waterfall" } & WaterfallResult)
  | ({ kind: "band" } & ProjectionBand)
  /**
   * The marks in order, the level they sit around, and where ordinary variation falls.
   *
   * Its own kind rather than a `band`: a projection band carries the quantiles it replays
   * and a control band carries the deviations it is drawn at, and one shape holding both
   * would have half its fields empty on every card that used it.
   */
  | ({ kind: "control" } & ControlBand)
  | {
      kind: "hierarchy";
      nodes: HierarchyNode[];
      /** Sum of the leaves, so a share can be read without re-summing the tree. */
      total: number;
    };

/**
 * A change, decomposed into the steps that made it.
 *
 * The steps sum to `endValue - startValue` — see `contributionBreakdown`, where that
 * is an algebraic identity rather than a hope. A remainder, if one ever appears, is a
 * step of its own rather than an adjustment spread over the others.
 */
export interface WaterfallResult {
  startValue: number;
  endValue: number;
  steps: ContributionStep[];
}

export interface HierarchyNode {
  id: string;
  parentId: string | null;
  label: string;
  /** For a leaf, its own share; for a branch, the sum of its children's. */
  value: number;
  /** 0 at the root, so a list can be indented without walking the tree. */
  depth: number;
  /** True when nothing hangs below it: only leaves may be summed. */
  leaf: boolean;
  /**
   * What the node is. `own-marks` is a subject's own results shown beside its
   * sub-subjects, because a subject that carries both splits its weight between
   * them — and without that node the leaves would not sum to the whole.
   */
  kind: "subject" | "category" | "own-marks";
}

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
    context.graph.options,
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
      const ratios = gradeRatios(graph, subjectId ?? undefined);
      const dispersion = spec.dispersion ?? "standard-deviation";
      const value = dispersionOf(ratios, dispersion);
      // No marks at all is nothing to say; too few marks for *this* estimator is
      // something to say, and the card says it — a spread that silently becomes
      // a blank card looks like a bug and hides that the answer is "not yet".
      if (ratios.length === 0) return { kind: "empty" };
      return {
        kind: "scalar",
        value,
        unit: "ratio",
        sample: { count: ratios.length, sufficient: value !== null },
        dispersion,
      };
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

    case "requiredResult": {
      const goal = context.goals.find((item) => item.id === spec.goalId);
      if (!goal) return { kind: "empty" };
      const series = seriesFor(localContext, subjectId);
      const plan = planGoal(goal, graph, subjectId, scope, {
        projection: projectedRatio(series, Math.round(SERIES_POINTS / 3)),
        remaining: context.remaining,
      });
      // The cheapest route that still gets there, because that is the one a
      // reader can act on. Ties fall to the heavier assessment: the same mark is
      // worth more where the coefficient is.
      const reachable = plan.nextResults
        .filter((entry) => entry.achievable)
        .sort(
          (left, right) =>
            left.requiredRatio - right.requiredRatio ||
            right.coefficient - left.coefficient,
        );
      const next = reachable[0] ?? plan.nextResults[0] ?? null;
      const horizon = plan.horizons.find((entry) => entry.achievable) ?? null;
      return {
        kind: "required",
        status: plan.status,
        goalName: goal.name,
        target: plan.target,
        current: plan.current,
        gap: plan.gap,
        next: next
          ? {
              subjectId: next.subject.id,
              subjectName: next.subject.name,
              coefficient: next.coefficient,
              requiredRatio: next.requiredRatio,
              achievable: next.achievable,
              alreadySecured: next.alreadySecured,
            }
          : null,
        horizon: horizon
          ? { count: horizon.count, requiredRatio: horizon.requiredRatio }
          : null,
      };
    }

    case "safetyMargin": {
      const goal = context.goals.find((item) => item.id === spec.goalId);
      if (!goal) return { kind: "empty" };
      const series = seriesFor(localContext, subjectId);
      const plan = planGoal(goal, graph, subjectId, scope, {
        projection: projectedRatio(series, Math.round(SERIES_POINTS / 3)),
        remaining: context.remaining,
      });
      // Every candidate whose required mark can still be missed. `alreadySecured`
      // means a zero there keeps the goal, so it is not a threat and must not be
      // reported as one.
      const threats = plan.nextResults.filter(
        (entry) =>
          !entry.alreadySecured && Number.isFinite(entry.requiredRatio),
      );
      // The highest bar is the one you fall under first: it is the mark this goal
      // is most easily lost on, and ties fall to the heavier assessment.
      const breaking = [...threats].sort(
        (left, right) =>
          right.requiredRatio - left.requiredRatio ||
          right.coefficient - left.coefficient,
      )[0];
      return {
        kind: "margin",
        status: plan.status,
        goalName: goal.name,
        target: plan.target,
        current: plan.current,
        margin: plan.current === null ? null : plan.current - plan.target,
        breaking: breaking
          ? {
              subjectId: breaking.subject.id,
              subjectName: breaking.subject.name,
              coefficient: breaking.coefficient,
              ratio: breaking.requiredRatio,
            }
          : null,
        secured: threats.length === 0 && plan.nextResults.length > 0,
      };
    }

    case "projectionBand": {
      // The planner's own estimate of what is left to sit, supplied by whoever built
      // the context — the evaluator derives it once per evaluation.
      if (!context.remaining) return { kind: "empty" };
      const band = projectionBand(graph, context.remaining, scope);
      return band === null ? { kind: "empty" } : { kind: "band", ...band };
    }

    case "controlBand": {
      const band = controlBand(gradeRatios(graph, subjectId ?? undefined));
      return band === null ? { kind: "empty" } : { kind: "control", ...band };
    }

    case "markImpact": {
      /**
       * Every mark, removed in turn.
       *
       * There is no formula: the weighting is hierarchical, so a mark's "contribution" is
       * not a term you can read off the average — `gradeImpact` says as much where it
       * lives. Two averages per mark, and a year's worth of marks is a few hundred, which
       * is cheap enough to do honestly.
       *
       * Bounded anyway. The cap is a bound on *work*, not a reading: past it the answer
       * comes from the most recent marks, which are the ones a reader is asking about.
       */
      const grades = graph.allGrades(subjectId ?? undefined);
      const considered = grades.slice(-MARK_IMPACT_LIMIT);
      const scored = considered.flatMap((grade) => {
        const ratio = gradeRatio(grade);
        if (ratio === null) return [];
        const impact = gradeImpact(graph, grade.id, subjectId, scope);
        if (impact.withValue === null || impact.withoutValue === null)
          return [];
        return [{ grade, ratio, impact }];
      });
      const heaviest = scored.sort(
        (left, right) =>
          Math.abs(right.impact.withValue! - right.impact.withoutValue!) -
          Math.abs(left.impact.withValue! - left.impact.withoutValue!),
      )[0];
      if (!heaviest) return { kind: "empty" };
      return {
        kind: "impact",
        gradeId: heaviest.grade.id,
        gradeName: heaviest.grade.name,
        subjectId: heaviest.grade.subjectId,
        subjectName: graph.byId(heaviest.grade.subjectId)?.name ?? "",
        ratio: heaviest.ratio,
        withMark: heaviest.impact.withValue as number,
        withoutMark: heaviest.impact.withoutValue as number,
        at: heaviest.grade.passedAt,
      };
    }

    case "nextBestAction": {
      /**
       * Leverage times headroom, which is a number of points.
       *
       * `nextAssessmentLeverage` says how far one further mark can move the average, and
       * the headroom says how much better that mark could realistically be than the
       * subject's usual. Multiply, and the answer is what the general average gains if the
       * next mark here is a good one instead of a typical one.
       *
       * The ceiling is the goal planner's own `REALISTIC_CEILING`, so the two features
       * mean the same thing by "realistically": a scenario about full marks in everything
       * would rank subjects by how badly they are going, which is not the same question
       * and is much less useful.
       */
      const candidates = graph
        .flatten()
        .filter((subject) => subject.kind !== "category")
        .flatMap((subject) => {
          const leverage = nextAssessmentLeverage(
            graph,
            null,
            subject.id,
            1,
            scope,
          );
          if (leverage <= 0) return [];
          const current = graph.ratio(subject.id, scope);
          // A subject with no marks yet has no usual to improve on, and its whole weight
          // is already reported by `nextLeverage`. Ranking it here would put "the subject
          // you have never been graded in" at the top of every dashboard.
          if (current === null) return [];
          const reference = Math.max(current, REALISTIC_CEILING);
          const gain = leverage * (reference - current);
          return [{ subject, current, reference, gain, leverage }];
        });

      const best = candidates.sort((left, right) => right.gain - left.gain)[0];
      // Everything already at or above the realistic level: a real answer, and not one to
      // dress up as a recommendation.
      if (!best || best.gain <= 0) {
        return candidates.length > 0
          ? { kind: "empty", reason: { kind: "nothing-unusual" } }
          : { kind: "empty" };
      }
      return {
        kind: "priority",
        subjectId: best.subject.id,
        subjectName: best.subject.name,
        current: best.current,
        reference: best.reference,
        gain: best.gain,
        leverage: best.leverage,
      };
    }

    case "anomaly": {
      /**
       * Each subject's latest mark, against the marks before it.
       *
       * Against its *own* subject and not the year: a mark of eleven is unremarkable in a
       * subject that runs at eleven and startling in one that runs at seventeen, and it is
       * the second that a reader wants told.
       *
       * The level excludes the mark being judged. Including it drags the mean towards the
       * outlier and inflates the spread, so an unusual result partly hides itself — the
       * more unusual it is, the more it moves the thing it is measured against.
       */
      const candidates = graph
        .flatten()
        .filter((subject) => subject.kind !== "category")
        .flatMap((subject) => {
          const grades = graph.allGrades(subject.id);
          const last = grades.at(-1);
          if (!last) return [];
          const ratio = gradeRatio(last);
          if (ratio === null) return [];
          const earlier = grades
            .slice(0, -1)
            .map((item) => gradeRatio(item))
            .filter((value): value is number => value !== null);
          if (earlier.length < ANOMALY_MINIMUM_SAMPLE) return [];
          const mean =
            earlier.reduce((sum, value) => sum + value, 0) / earlier.length;
          const variance =
            earlier.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            earlier.length;
          const deviation = Math.sqrt(variance);
          // A subject whose earlier marks are all identical has no spread to measure
          // against, and dividing by it would report an infinity as a discovery.
          if (deviation < 1e-9) return [];
          return [
            {
              subject,
              grade: last,
              ratio,
              deviations: (ratio - mean) / deviation,
              sample: earlier.length,
            },
          ];
        });

      // The most striking one, in either direction — a result far above the usual level is
      // as worth saying as one far below.
      const striking = candidates.sort(
        (left, right) => Math.abs(right.deviations) - Math.abs(left.deviations),
      )[0];
      if (!striking || Math.abs(striking.deviations) < ANOMALY_THRESHOLD) {
        // Nothing stood out — which is worth saying, and is not the same as having
        // nothing to look at. A subject with too few marks never became a candidate, so
        // "nothing unusual" is only claimed where something was actually measured.
        return candidates.length > 0
          ? { kind: "empty", reason: { kind: "nothing-unusual" } }
          : { kind: "empty" };
      }
      return {
        kind: "anomaly",
        subjectId: striking.subject.id,
        subjectName: striking.subject.name,
        gradeId: striking.grade.id,
        gradeName: striking.grade.name,
        ratio: striking.ratio,
        deviations: striking.deviations,
        sample: striking.sample,
        at: striking.grade.passedAt,
      };
    }

    case "concentration": {
      /**
       * The smallest set of subjects that carries half the average.
       *
       * Leaves only — a branch is the sum of its children, and counting both would report
       * a category and its subjects as separate risks. Sorted heaviest first, then taken
       * until the running share reaches a half: the count falls out of the year's own
       * shape instead of being a "top three" somebody picked.
       */
      const leaves = weightHierarchy(graph, scope)
        .filter((node) => node.leaf && node.value > 0)
        .sort((left, right) => right.value - left.value);
      if (leaves.length === 0) return { kind: "empty" };

      const total = leaves.reduce((sum, node) => sum + node.value, 0);
      if (total <= 0) return { kind: "empty" };

      const half = total / 2;
      const taken: HierarchyNode[] = [];
      let running = 0;
      for (const node of leaves) {
        taken.push(node);
        running += node.value;
        if (running >= half) break;
      }
      return {
        kind: "concentration",
        // Normalised against the weights that exist, so the share is a share of the
        // average rather than of whatever the tree happened to sum to.
        share: running / total,
        count: taken.length,
        total: leaves.length,
        subjects: taken.map((node) => ({
          id: node.id,
          label: node.label,
          weight: node.value / total,
        })),
      };
    }

    case "weightBreakdown": {
      const nodes = weightHierarchy(graph, scope);
      if (nodes.length === 0) return { kind: "empty" };
      return {
        kind: "hierarchy",
        nodes,
        // The leaves, and only the leaves: a branch is their sum, so adding both
        // would double every nested subject.
        total: nodes
          .filter((node) => node.leaf)
          .reduce((sum, node) => sum + node.value, 0),
      };
    }

    default:
      return { kind: "empty" };
  }
}

/**
 * Every subject's effective weight, as the tree it lives in.
 *
 * The audit asks for "the product of the weightings along the path", and that is the
 * wrong formula *for this app* — measured, and worth writing down. A category here
 * **dissolves**: `collectContributors` walks through it and its children compete at
 * the level above, so a category's coefficient never multiplies anything. A subject
 * of coefficient 1 inside a category of coefficient 4 carries one fifth of a
 * five-coefficient year, not four fifths of it. Reading the coefficients as a
 * product would have reported the reverse.
 *
 * So the weight of a node is its coefficient share among the contributors it
 * actually competes with, times its container's share:
 *
 *     w(node) = w(container) × coefficient(node) / Σ coefficients(container)
 *
 * where the sum runs over the container's contributors *and* its own marks. A
 * subject that carries marks of its own as well as sub-subjects splits its weight
 * between them, and the marks appear as a node of their own — without it the leaves
 * would not sum to the whole, and a treemap whose areas do not sum to the whole is
 * drawing shares that are not shares.
 *
 * Structural, not realised: a subject with no marks yet still carries its weight,
 * and adding a mark does not move anybody's share. That is the difference from
 * `leverage`, which is the sensitivity of *today's* average and correctly reports a
 * subject the average currently excludes as worth more than this does. The two
 * measure different things and the tests say so.
 */
export function weightHierarchy(
  graph: SubjectGraph,
  scope: Scope | null,
): HierarchyNode[] {
  const weights = new Map<string, number>();
  /** Weight of a container's own marks, keyed by the container's id. */
  const ownWeights = new Map<string, number>();

  const assign = (containerId: string | null, share: number): void => {
    const contributors = graph.contributorsOf(containerId);
    const container = containerId === null ? null : graph.byId(containerId);
    const ownCoefficient = (container?.grades ?? []).reduce(
      (sum, grade) => sum + coefficientWeight(grade.coefficient),
      0,
    );
    const total = contributors.reduce(
      (sum, subject) => sum + graph.coefficientOf(subject, scope),
      ownCoefficient,
    );
    if (total === 0) return;
    if (containerId !== null && ownCoefficient > 0) {
      ownWeights.set(containerId, (share * ownCoefficient) / total);
    }
    for (const subject of contributors) {
      const coefficient = graph.coefficientOf(subject, scope);
      if (coefficient === 0) continue;
      const own = (share * coefficient) / total;
      weights.set(subject.id, own);
      assign(subject.id, own);
    }
  };
  assign(null, 1);

  const nodes: HierarchyNode[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const subject of graph.childrenOf(parentId)) {
      const children = graph.childrenOf(subject.id);
      // A node's own marks are only drawn *beside* something: a subject with no
      // sub-subjects is its marks, and giving it a child of itself would make every
      // ordinary subject a branch of one.
      const own = children.length > 0 ? ownWeights.get(subject.id) : undefined;
      const index = nodes.length;
      const drawnChildren = children.length + (own === undefined ? 0 : 1);
      nodes.push({
        id: subject.id,
        parentId,
        label: subject.name,
        kind: subject.kind === "category" ? "category" : "subject",
        value: drawnChildren === 0 ? (weights.get(subject.id) ?? 0) : 0,
        depth,
        leaf: drawnChildren === 0,
      });
      if (own !== undefined) {
        nodes.push({
          id: `${subject.id}:own`,
          parentId: subject.id,
          label: subject.name,
          // Named by the renderer, which has the words: this is "its own marks",
          // and core does not speak the reader's language.
          kind: "own-marks",
          value: own,
          depth: depth + 1,
          leaf: true,
        });
      }
      walk(subject.id, depth + 1);
      if (drawnChildren > 0) {
        const branch = nodes[index] as HierarchyNode;
        nodes[index] = {
          ...branch,
          value: nodes
            .filter((node) => node.parentId === subject.id)
            .reduce((sum, node) => sum + node.value, 0),
        };
      }
    }
  };
  walk(null, 0);
  return nodes;
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
      recipe: "sparkline",
      display: "sparkline",
      span: 2,
      sortOrder: 0,
    },
    {
      ...base,
      id: "best-subject",
      metric: "bestSubject",
      recipe: "value",
      display: "value",
      span: 1,
      sortOrder: 1,
    },
    {
      ...base,
      id: "worst-subject",
      metric: "worstSubject",
      recipe: "value",
      display: "value",
      span: 1,
      sortOrder: 2,
    },
    {
      ...base,
      id: "last-grade",
      metric: "lastGrade",
      recipe: "value",
      display: "value",
      span: 1,
      sortOrder: 3,
    },
    {
      ...base,
      id: "pass-rate",
      metric: "passRate",
      recipe: "gauge",
      display: "gauge",
      span: 1,
      sortOrder: 4,
    },
    {
      ...base,
      id: "ranking",
      metric: "subjectRanking",
      recipe: "ranking",
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
 * The floor itself now comes from the card's recipe rather than from `display`,
 * which was a four-way projection of the mark: `value | gauge | chart | list`
 * sent a sparkline, a table, a radar, a treemap and an eight-series study to the
 * same answer. `widget-recipes` holds one policy per recipe, keyed by the grid's
 * own width, and it is pure in the definition — never in the current result — so
 * a new grade can never repack the grid under a drag.
 */
function minColumns(spec: Pick<CardSpec, "recipe">, columns: number): number {
  if (columns <= 1) return 1;
  const grid = clamp(Math.round(columns), 1, 4) as 1 | 2 | 3 | 4;
  const floor = widgetRecipeLayout(spec.recipe).minColumns[grid];
  // A floor of "half" on a two-column grid is the whole row, which is what the
  // table says; clamping to the real column count keeps a wider floor honest on
  // a narrower grid than the policy was written for.
  return Math.min(floor, columns);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The width a single card asks for on a grid this wide, before packing. */
export function cardColumns(
  spec: Pick<CardSpec, "span" | "recipe">,
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
  spec: Pick<CardSpec, "recipe">,
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
  spec: Pick<CardSpec, "recipe">,
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
