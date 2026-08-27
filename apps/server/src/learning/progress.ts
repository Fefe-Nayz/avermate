import type { LearningActivityKind, LearningErrorTaxonomy } from "../db/schema";

const DAY_MS = 86_400_000;

export type LearningProgressTrend =
  | "improving"
  | "stable"
  | "declining"
  | "uncertain"
  | "method-changed"
  | "insufficient-data";

export type LearningProgressProjectionInput = {
  id: string;
  generation: number;
  algorithmRevision: string;
  evidenceCursor: string;
  estimate: number;
  low: number;
  high: number;
  evidenceCount: number;
  includedEvidenceIds?: readonly string[];
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

const TREND_THRESHOLD = 0.02;
const MIN_EVIDENCE_PER_SNAPSHOT = 2;
const MAX_COMPARABLE_INTERVAL_WIDTH = 0.5;

function directionalTrend(delta: number | null): LearningProgressTrend {
  if (delta === null) return "insufficient-data";
  if (delta >= TREND_THRESHOLD) return "improving";
  if (delta <= -TREND_THRESHOLD) return "declining";
  return "stable";
}

function measurement(projection: LearningProgressProjectionInput | null) {
  if (!isMeasuredProjection(projection)) return null;
  const measured = projection!;
  const intervalWidth = bounded(measured.high - measured.low);
  const precision = {
    // This is a UI-oriented precision indicator, not a new statistical
    // probability: the persisted interval remains the source of truth.
    score: rounded(1 - intervalWidth),
    level:
      intervalWidth <= 0.25
        ? ("high" as const)
        : intervalWidth <= 0.5
          ? ("medium" as const)
          : ("low" as const),
    intervalWidth: rounded(intervalWidth),
  };
  const freshnessStatus =
    measured.freshnessDays === null
      ? ("unknown" as const)
      : measured.freshnessDays <= 30
        ? ("fresh" as const)
        : measured.freshnessDays <= 90
          ? ("aging" as const)
          : ("stale" as const);
  return {
    projectionId: measured.id,
    generation: measured.generation,
    algorithmRevision: measured.algorithmRevision,
    estimate: measured.estimate,
    interval: intervalPair(measured.low, measured.high),
    precision,
    evidence: {
      count: measured.evidenceCount,
    },
    freshness: {
      days: measured.freshnessDays,
      status: freshnessStatus,
    },
    asOf: measured.asOf,
  };
}

function evidenceIdDifference(
  current: readonly string[] | undefined,
  previous: readonly string[] | undefined,
) {
  if (!current || !previous) return { addedCount: null, removedCount: null };
  const currentIds = new Set(current);
  const previousIds = new Set(previous);
  return {
    addedCount: current.filter((id) => !previousIds.has(id)).length,
    removedCount: previous.filter((id) => !currentIds.has(id)).length,
  };
}

function projectionComparison(
  current: LearningProgressProjectionInput | null,
  previous: LearningProgressProjectionInput | null,
) {
  if (!isMeasuredProjection(current) || !isMeasuredProjection(previous))
    return null;

  const measuredCurrent = current!;
  const measuredPrevious = previous!;
  const currentIntervalWidth = rounded(
    bounded(measuredCurrent.high - measuredCurrent.low),
  );
  const previousIntervalWidth = rounded(
    bounded(measuredPrevious.high - measuredPrevious.low),
  );
  const intervalsOverlap =
    Math.max(measuredCurrent.low, measuredPrevious.low) <=
    Math.min(measuredCurrent.high, measuredPrevious.high);
  const evidenceDifference = evidenceIdDifference(
    measuredCurrent.includedEvidenceIds,
    measuredPrevious.includedEvidenceIds,
  );
  const evidence = {
    currentCount: measuredCurrent.evidenceCount,
    previousCount: measuredPrevious.evidenceCount,
    countDelta: measuredCurrent.evidenceCount - measuredPrevious.evidenceCount,
    changed: measuredCurrent.evidenceCursor !== measuredPrevious.evidenceCursor,
    ...evidenceDifference,
    sufficient:
      measuredCurrent.evidenceCount >= MIN_EVIDENCE_PER_SNAPSHOT &&
      measuredPrevious.evidenceCount >= MIN_EVIDENCE_PER_SNAPSHOT,
  };
  const precision = {
    currentIntervalWidth,
    previousIntervalWidth,
    intervalsOverlap,
    sufficient:
      currentIntervalWidth <= MAX_COMPARABLE_INTERVAL_WIDTH &&
      previousIntervalWidth <= MAX_COMPARABLE_INTERVAL_WIDTH,
  };
  const method = {
    currentRevision: measuredCurrent.algorithmRevision,
    previousRevision: measuredPrevious.algorithmRevision,
    changed:
      measuredCurrent.algorithmRevision !== measuredPrevious.algorithmRevision,
  };
  const common = {
    previousEstimate: measuredPrevious.estimate,
    previousAsOf: measuredPrevious.asOf,
    elapsedDays: rounded(
      Math.max(
        0,
        measuredCurrent.asOf.getTime() - measuredPrevious.asOf.getTime(),
      ) / DAY_MS,
    ),
    precision,
    evidence,
    method,
  };
  if (method.changed) {
    return {
      ...common,
      variation: null,
      trend: "method-changed" as const,
    };
  }

  const estimate = rounded(
    measuredCurrent.estimate - measuredPrevious.estimate,
  );
  const candidateTrend = directionalTrend(estimate);
  const trend =
    !evidence.sufficient ||
    !precision.sufficient ||
    (evidence.removedCount !== null && evidence.removedCount > 0) ||
    (candidateTrend !== "stable" && intervalsOverlap)
      ? ("uncertain" as const)
      : candidateTrend;
  return {
    ...common,
    variation: {
      estimate,
      intervalLow: rounded(measuredCurrent.low - measuredPrevious.low),
      intervalHigh: rounded(measuredCurrent.high - measuredPrevious.high),
    },
    trend,
  };
}

function aggregateVariation<
  T extends {
    trend: LearningProgressTrend;
    delta: { estimate: number } | null;
  },
>(rows: readonly T[]) {
  const comparable = rows.filter(
    (row): row is T & { delta: { estimate: number } } => row.delta !== null,
  );
  const delta = mean(comparable.map((row) => row.delta.estimate));
  const methodChangedObjectiveCount = rows.filter(
    (row) => row.trend === "method-changed",
  ).length;
  const uncertainObjectiveCount = rows.filter(
    (row) => row.trend === "uncertain",
  ).length;
  const directional = new Set(
    comparable
      .map((row) => row.trend)
      .filter((value) => value === "improving" || value === "declining"),
  );
  let trend: LearningProgressTrend;
  if (comparable.length === 0) {
    trend = methodChangedObjectiveCount
      ? "method-changed"
      : "insufficient-data";
  } else if (
    methodChangedObjectiveCount > 0 ||
    uncertainObjectiveCount > 0 ||
    directional.size > 1
  ) {
    trend = "uncertain";
  } else {
    trend = directionalTrend(delta);
  }
  return {
    delta,
    trend,
    comparableObjectiveCount: comparable.length,
    uncertainObjectiveCount,
    methodChangedObjectiveCount,
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
    const comparison = projectionComparison(row.current, row.previous);
    const delta = comparison?.variation ?? null;
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
      comparison,
      delta,
      trend: comparison?.trend ?? ("insufficient-data" as const),
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
      const estimate = mean(measured.map((row) => row.measurement!.estimate));
      const variation = aggregateVariation(rows);
      const evidence = {
        objectiveCount: rows.length,
        measuredObjectiveCount: measured.length,
        unmeasuredObjectiveCount: rows.length - measured.length,
        coverage: rows.length ? rounded(measured.length / rows.length) : 0,
        itemCount: measured.reduce(
          (total, row) => total + row.measurement!.evidence.count,
          0,
        ),
      };
      const precision = {
        score: mean(measured.map((row) => row.measurement!.precision.score)),
        averageIntervalWidth: mean(
          measured.map((row) => row.measurement!.precision.intervalWidth),
        ),
      };
      const freshness = {
        fresh: measured.filter(
          (row) => row.measurement!.freshness.status === "fresh",
        ).length,
        aging: measured.filter(
          (row) => row.measurement!.freshness.status === "aging",
        ).length,
        stale: measured.filter(
          (row) => row.measurement!.freshness.status === "stale",
        ).length,
        unknown: measured.filter(
          (row) => row.measurement!.freshness.status === "unknown",
        ).length,
        averageDays: mean(
          measured.flatMap((row) =>
            row.measurement!.freshness.days === null
              ? []
              : [row.measurement!.freshness.days],
          ),
        ),
      };
      const difficulties = aggregateDifficulties(
        input.difficulties.filter(
          (row) => (row.subjectId ?? "__unassigned__") === key,
        ),
      );
      return {
        ...subject,
        ...evidence,
        evidence,
        estimate,
        interval:
          measured.length > 0
            ? intervalPair(
                mean(measured.map((row) => row.measurement!.interval[0]))!,
                mean(measured.map((row) => row.measurement!.interval[1]))!,
              )
            : null,
        precision,
        freshness,
        ...variation,
        variation,
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
  const variation = aggregateVariation(objectives);
  const evidence = {
    objectiveCount: objectives.length,
    measuredObjectiveCount: measured.length,
    unmeasuredObjectiveCount: objectives.length - measured.length,
    coverage: objectives.length
      ? rounded(measured.length / objectives.length)
      : 0,
    itemCount: measured.reduce(
      (total, row) => total + row.measurement!.evidence.count,
      0,
    ),
  };
  const precision = {
    score: mean(measured.map((row) => row.measurement!.precision.score)),
    averageIntervalWidth: mean(
      measured.map((row) => row.measurement!.precision.intervalWidth),
    ),
  };
  const freshness = {
    fresh: measured.filter(
      (row) => row.measurement!.freshness.status === "fresh",
    ).length,
    aging: measured.filter(
      (row) => row.measurement!.freshness.status === "aging",
    ).length,
    stale: measured.filter(
      (row) => row.measurement!.freshness.status === "stale",
    ).length,
    unknown: measured.filter(
      (row) => row.measurement!.freshness.status === "unknown",
    ).length,
    averageDays: mean(
      measured.flatMap((row) =>
        row.measurement!.freshness.days === null
          ? []
          : [row.measurement!.freshness.days],
      ),
    ),
  };
  const difficulties = aggregateDifficulties(input.difficulties);
  return {
    methodology: {
      version: 2,
      measuredDefinition: "positive-numeric-evidence-count",
      precisionDefinition: "one-minus-persisted-interval-width",
      variationDefinition:
        "current-minus-previous-measured-generation-with-same-algorithm-revision",
      trendThreshold: TREND_THRESHOLD,
      minimumEvidencePerSnapshot: MIN_EVIDENCE_PER_SNAPSHOT,
      maximumComparableIntervalWidth: MAX_COMPARABLE_INTERVAL_WIDTH,
      overlappingIntervalsAreUncertain: true,
      recurringDifficultyMinimumObservations: 2,
    },
    summary: {
      ...evidence,
      evidence,
      estimate: mean(measured.map((row) => row.measurement!.estimate)),
      interval:
        measured.length > 0
          ? intervalPair(
              mean(measured.map((row) => row.measurement!.interval[0]))!,
              mean(measured.map((row) => row.measurement!.interval[1]))!,
            )
          : null,
      precision,
      ...variation,
      variation,
      freshness,
      nextAction: chooseNextAction(input.plan),
    },
    objectives,
    subjects,
    difficulties,
    recurringDifficulties: difficulties.filter((item) => item.recurring),
  };
}
