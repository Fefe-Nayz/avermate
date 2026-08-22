export interface LearningPlanPolicyInput {
  estimate: number | null;
  low: number | null;
  high: number | null;
  freshnessDays: number | null;
  dueAt: Date | null;
  prerequisiteEstimates: Array<{ id: string; estimate: number | null }>;
  dependentEstimates: Array<{ id: string; estimate: number | null }>;
  availableMinutes: number;
  now: Date;
}

/** Versioned deterministic ranking policy; every score component is exported. */
export function learningPlanPolicy(input: LearningPlanPolicyInput) {
  const estimate = input.estimate ?? 0.5;
  const uncertainty =
    input.low === null || input.high === null ? 1 : input.high - input.low;
  const stale =
    input.freshnessDays === null
      ? 1
      : Math.min(1, Math.max(0, input.freshnessDays) / 90);
  const daysUntilDue = input.dueAt
    ? (input.dueAt.getTime() - input.now.getTime()) / 86_400_000
    : null;
  const dueUrgency =
    daysUntilDue === null
      ? 0
      : daysUntilDue <= 0
        ? 1
        : Math.max(0, 1 - daysUntilDue / 14);
  const unmetPrerequisiteIds = input.prerequisiteEstimates
    .filter((item) => (item.estimate ?? 0.5) < 0.65)
    .map((item) => item.id);
  const neededByWeakObjectiveIds = input.dependentEstimates
    .filter((item) => (item.estimate ?? 0.5) < 0.65)
    .map((item) => item.id);
  const score =
    (1 - estimate) * 0.45 +
    uncertainty * 0.2 +
    stale * 0.1 +
    dueUrgency * 0.25 +
    Math.min(0.2, neededByWeakObjectiveIds.length * 0.08) -
    Math.min(0.3, unmetPrerequisiteIds.length * 0.12);
  return {
    version: 2 as const,
    score,
    estimate: input.estimate,
    interval:
      input.low === null || input.high === null
        ? null
        : ([input.low, input.high] as [number, number]),
    freshnessDays: input.freshnessDays,
    dueAt: input.dueAt?.toISOString() ?? null,
    dueUrgency,
    unmetPrerequisiteIds,
    neededByWeakObjectiveIds,
    availableMinutes: input.availableMinutes,
    estimatedMinutes: Math.max(
      5,
      Math.min(
        input.availableMinutes,
        input.estimate !== null && estimate < 0.4 ? 30 : 20,
      ),
    ),
  };
}
