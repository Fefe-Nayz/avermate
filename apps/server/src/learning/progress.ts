import type { LearningActivityKind, LearningErrorTaxonomy } from "../db/schema";

const DAY_MS = 86_400_000;

export type LearningProgressTrend =
  "improving" | "stable" | "declining" | "insufficient-data";

export type LearningProgressProjectionInput = {
  id: string;
  generation: number;
  estimate: number;
  low: number;
  high: number;
  evidenceCount: number;
  freshnessDays: number | null;
  asOf: Date;
};

export type LearningProgressObjectiveInput = {
  id: string;
  statement: string;
  expectedLevel: number;
  yearId: string;
  subjectId: string | null;
  subjectName: string | null;
  conceptId: string;
  conceptLabel: string;
  current: LearningProgressProjectionInput | null;
  previous: LearningProgressProjectionInput | null;
};

export type LearningProgressDifficultyInput = {
  id: string;
  objectiveId: string;
  subjectId: string | null;
  taxonomy: LearningErrorTaxonomy;
  severity: number;
  confidence: number;
  occurredAt: Date;
};

export type LearningProgressPlanInput = {
  id: string;
  objectiveId: string;
  subjectId: string | null;
  status: "proposed" | "accepted" | "in-progress";
  activityKind: LearningActivityKind;
  estimatedMinutes: number;
  title: string;
  planningTaskId: string | null;
  scheduledAt: Date | null;
  dueAt: Date | null;
  createdAt: Date;
};

export function isMeasuredProjection(
  projection: { evidenceCount: number } | null | undefined,
): boolean {
  return Boolean(projection && projection.evidenceCount > 0);
}

function bounded(value: number, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

function rounded(value: number) {
  return Number(value.toFixed(6));
}

function mean(values: readonly number[]): number | null {
  return values.length
    ? rounded(values.reduce((total, value) => total + value, 0) / values.length)
    : null;
}

function intervalPair(low: number, high: number): [number, number] {
  return [low, high];
}

function trend(delta: number | null): LearningProgressTrend {
  if (delta === null) return "insufficient-data";
  if (delta >= 0.02) return "improving";
  if (delta <= -0.02) return "declining";
  return "stable";
}

function measurement(projection: LearningProgressProjectionInput | null) {
  if (!isMeasuredProjection(projection)) return null;
  const measured = projection!;
  const intervalWidth = bounded(measured.high - measured.low);
  return {
    projectionId: measured.id,
    generation: measured.generation,
    estimate: measured.estimate,
    interval: intervalPair(measured.low, measured.high),
    intervalWidth: rounded(intervalWidth),
    confidence: {
      // This is an UI-oriented precision indicator, not a new statistical
      // probability: the persisted interval remains the source of truth.
      score: rounded(1 - intervalWidth),
      level:
        intervalWidth <= 0.25
          ? ("high" as const)
          : intervalWidth <= 0.5
            ? ("medium" as const)
            : ("low" as const),
    },
    evidenceCount: measured.evidenceCount,
    freshnessDays: measured.freshnessDays,
    freshness:
      measured.freshnessDays === null
        ? ("unknown" as const)
        : measured.freshnessDays <= 30
          ? ("fresh" as const)
          : measured.freshnessDays <= 90
            ? ("aging" as const)
            : ("stale" as const),
    asOf: measured.asOf,
  };
}

function projectionDelta(
  current: LearningProgressProjectionInput | null,
  previous: LearningProgressProjectionInput | null,
) {
  if (!isMeasuredProjection(current) || !isMeasuredProjection(previous))
    return null;
  const estimate = rounded(current!.estimate - previous!.estimate);
  return {
    estimate,
    intervalLow: rounded(current!.low - previous!.low),
    intervalHigh: rounded(current!.high - previous!.high),
    previousEstimate: previous!.estimate,
    previousAsOf: previous!.asOf,
    elapsedDays: rounded(
      Math.max(0, current!.asOf.getTime() - previous!.asOf.getTime()) / DAY_MS,
    ),
    trend: trend(estimate),
  };
}

function aggregateDifficulties(
  rows: readonly LearningProgressDifficultyInput[],
) {
  const byTaxonomy = new Map<
    LearningErrorTaxonomy,
    LearningProgressDifficultyInput[]
  >();
  for (const row of rows) {
    const values = byTaxonomy.get(row.taxonomy) ?? [];
    values.push(row);
    byTaxonomy.set(row.taxonomy, values);
  }
  return [...byTaxonomy.entries()]
    .map(([taxonomy, observations]) => ({
      taxonomy,
      observationCount: observations.length,
      objectiveCount: new Set(observations.map((row) => row.objectiveId)).size,
      averageSeverity: mean(observations.map((row) => row.severity))!,
      averageConfidence: mean(observations.map((row) => row.confidence))!,
      lastObservedAt: new Date(
        Math.max(...observations.map((row) => row.occurredAt.getTime())),
      ),
      recurring:
        observations.length >= 2 ||
        new Set(observations.map((row) => row.objectiveId)).size >= 2,
    }))
    .sort(
      (left, right) =>
        Number(right.recurring) - Number(left.recurring) ||
        right.observationCount - left.observationCount ||
        right.averageSeverity - left.averageSeverity ||
        left.taxonomy.localeCompare(right.taxonomy),
    );
}

function chooseNextAction(rows: readonly LearningProgressPlanInput[]) {
  const statusPriority = {
    "in-progress": 0,
    accepted: 1,
    proposed: 2,
  } as const;
  return (
    [...rows].sort((left, right) => {
      const byStatus =
        statusPriority[left.status] - statusPriority[right.status];
      if (byStatus) return byStatus;
      const leftAt =
        left.scheduledAt?.getTime() ??
        left.dueAt?.getTime() ??
        Number.POSITIVE_INFINITY;
      const rightAt =
        right.scheduledAt?.getTime() ??
        right.dueAt?.getTime() ??
        Number.POSITIVE_INFINITY;
      return (
        leftAt - rightAt ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id)
      );
    })[0] ?? null
  );
}

/**
 * Builds the honest learning read model used by the UI.
 *
 * A neutral Beta prior may still be persisted for deterministic planning and
 * recomputation, but it never becomes a measured objective until at least one
 * numeric, included evidence item contributed to the projection.
 */
export function buildLearningProgress(input: {
  objectives: readonly LearningProgressObjectiveInput[];
  difficulties: readonly LearningProgressDifficultyInput[];
  plan: readonly LearningProgressPlanInput[];
}) {
  const objectives = input.objectives.map((row) => {
    const currentMeasurement = measurement(row.current);
    const delta = projectionDelta(row.current, row.previous);
    const difficulties = aggregateDifficulties(
      input.difficulties.filter((item) => item.objectiveId === row.id),
    );
    return {
      id: row.id,
      statement: row.statement,
      expectedLevel: row.expectedLevel,
      yearId: row.yearId,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      conceptId: row.conceptId,
      conceptLabel: row.conceptLabel,
      measurementState: currentMeasurement
        ? ("measured" as const)
        : ("unmeasured" as const),
      measurement: currentMeasurement,
      delta,
      trend: delta?.trend ?? ("insufficient-data" as const),
      difficulties,
      recurringDifficulties: difficulties.filter((item) => item.recurring),
      nextAction: chooseNextAction(
        input.plan.filter((item) => item.objectiveId === row.id),
      ),
    };
  });

  const subjectKeys = new Map<
    string,
    { subjectId: string | null; subjectName: string | null }
  >();
  for (const row of input.objectives) {
    const key = row.subjectId ?? "__unassigned__";
    subjectKeys.set(key, {
      subjectId: row.subjectId,
      subjectName: row.subjectName,
    });
  }
  const subjects = [...subjectKeys.entries()]
    .map(([key, subject]) => {
      const rows = objectives.filter(
        (row) => (row.subjectId ?? "__unassigned__") === key,
      );
      const measured = rows.filter((row) => row.measurement !== null);
      const comparable = rows.filter((row) => row.delta !== null);
      const estimate = mean(measured.map((row) => row.measurement!.estimate));
      const delta = mean(comparable.map((row) => row.delta!.estimate));
      const difficulties = aggregateDifficulties(
        input.difficulties.filter(
          (row) => (row.subjectId ?? "__unassigned__") === key,
        ),
      );
      return {
        ...subject,
        objectiveCount: rows.length,
        measuredObjectiveCount: measured.length,
        unmeasuredObjectiveCount: rows.length - measured.length,
        coverage: rows.length ? rounded(measured.length / rows.length) : 0,
        estimate,
        interval:
          measured.length > 0
            ? intervalPair(
                mean(measured.map((row) => row.measurement!.interval[0]))!,
                mean(measured.map((row) => row.measurement!.interval[1]))!,
              )
            : null,
        confidenceScore: mean(
          measured.map((row) => row.measurement!.confidence.score),
        ),
        averageFreshnessDays: mean(
          measured.flatMap((row) =>
            row.measurement!.freshnessDays === null
              ? []
              : [row.measurement!.freshnessDays],
          ),
        ),
        comparableObjectiveCount: comparable.length,
        delta,
        trend: trend(delta),
        difficulties,
        recurringDifficulties: difficulties.filter((item) => item.recurring),
        nextAction: chooseNextAction(
          input.plan.filter(
            (row) => (row.subjectId ?? "__unassigned__") === key,
          ),
        ),
      };
    })
    .sort((left, right) =>
      (left.subjectName ?? "").localeCompare(right.subjectName ?? ""),
    );

  const measured = objectives.filter((row) => row.measurement !== null);
  const comparable = objectives.filter((row) => row.delta !== null);
  const delta = mean(comparable.map((row) => row.delta!.estimate));
  const difficulties = aggregateDifficulties(input.difficulties);
  return {
    methodology: {
      version: 1,
      measuredDefinition: "positive-numeric-evidence-count",
      confidenceDefinition: "one-minus-persisted-interval-width",
      deltaDefinition: "current-minus-previous-measured-generation",
      trendThreshold: 0.02,
      recurringDifficultyMinimumObservations: 2,
    },
    summary: {
      objectiveCount: objectives.length,
      measuredObjectiveCount: measured.length,
      unmeasuredObjectiveCount: objectives.length - measured.length,
      coverage: objectives.length
        ? rounded(measured.length / objectives.length)
        : 0,
      estimate: mean(measured.map((row) => row.measurement!.estimate)),
      interval:
        measured.length > 0
          ? intervalPair(
              mean(measured.map((row) => row.measurement!.interval[0]))!,
              mean(measured.map((row) => row.measurement!.interval[1]))!,
            )
          : null,
      confidenceScore: mean(
        measured.map((row) => row.measurement!.confidence.score),
      ),
      comparableObjectiveCount: comparable.length,
      delta,
      trend: trend(delta),
      freshness: {
        fresh: measured.filter((row) => row.measurement!.freshness === "fresh")
          .length,
        aging: measured.filter((row) => row.measurement!.freshness === "aging")
          .length,
        stale: measured.filter((row) => row.measurement!.freshness === "stale")
          .length,
        unknown: measured.filter(
          (row) => row.measurement!.freshness === "unknown",
        ).length,
        averageDays: mean(
          measured.flatMap((row) =>
            row.measurement!.freshnessDays === null
              ? []
              : [row.measurement!.freshnessDays],
          ),
        ),
      },
      nextAction: chooseNextAction(input.plan),
    },
    objectives,
    subjects,
    difficulties,
    recurringDifficulties: difficulties.filter((item) => item.recurring),
  };
}
