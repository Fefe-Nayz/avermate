import { describe, expect, test } from "bun:test";
import {
  buildLearningProgress,
  isMeasuredProjection,
  type LearningProgressObjectiveInput,
  type LearningProgressProjectionInput,
} from "./progress";

const baseObjective: Omit<LearningProgressObjectiveInput, "id" | "current"> = {
  statement: "Résoudre une équation",
  expectedLevel: 3,
  yearId: "year-1",
  subjectId: "maths",
  subjectName: "Mathématiques",
  conceptId: "algebra",
  conceptLabel: "Algèbre",
  previous: null,
};

function projection(
  id: string,
  estimate: number,
  evidenceCount: number,
  generation = 1,
  overrides: Partial<LearningProgressProjectionInput> = {},
): LearningProgressProjectionInput {
  return {
    id,
    generation,
    algorithmRevision: "test-v1",
    evidenceCursor: `cursor-${id}`,
    estimate,
    low: Math.max(0, estimate - 0.1),
    high: Math.min(1, estimate + 0.1),
    evidenceCount,
    includedEvidenceIds: Array.from(
      { length: evidenceCount },
      (_, index) => `evidence-${index + 1}`,
    ),
    freshnessDays: evidenceCount > 0 ? 4 : null,
    asOf: new Date(
      `2026-08-${String(10 + generation).padStart(2, "0")}T00:00:00.000Z`,
    ),
    ...overrides,
  };
}

describe("learning progress read model", () => {
  test("keeps a neutral persisted prior explicitly unmeasured", () => {
    expect(isMeasuredProjection(projection("prior", 0.5, 0))).toBe(false);
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "objective-prior",
          current: projection("prior", 0.5, 0),
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.summary).toMatchObject({
      objectiveCount: 1,
      measuredObjectiveCount: 0,
      unmeasuredObjectiveCount: 1,
      coverage: 0,
      estimate: null,
      interval: null,
      precision: { score: null, averageIntervalWidth: null },
      trend: "insufficient-data",
    });
    expect(result.objectives[0]).toMatchObject({
      measurementState: "unmeasured",
      measurement: null,
      delta: null,
    });
  });

  test("computes coverage only from objectives backed by numeric evidence", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "measured",
          current: projection("measured-current", 0.72, 3),
        },
        {
          ...baseObjective,
          id: "neutral-prior",
          current: projection("neutral", 0.5, 0),
        },
        {
          ...baseObjective,
          id: "never-projected",
          current: null,
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.summary).toMatchObject({
      objectiveCount: 3,
      measuredObjectiveCount: 1,
      unmeasuredObjectiveCount: 2,
      coverage: 0.333333,
      estimate: 0.72,
    });
    expect(result.subjects[0]).toMatchObject({
      measuredObjectiveCount: 1,
      coverage: 0.333333,
    });
  });

  test("exposes objective and subject deltas only across two measured generations", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "improving",
          current: projection("current-a", 0.8, 4, 2, {
            low: 0.76,
            high: 0.9,
          }),
          previous: projection("previous-a", 0.6, 2, 1, {
            low: 0.5,
            high: 0.7,
          }),
        },
        {
          ...baseObjective,
          id: "first-measurement",
          current: projection("current-b", 0.7, 1, 2),
          previous: projection("previous-b", 0.5, 0, 1),
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.objectives[0]?.delta).toMatchObject({
      estimate: 0.2,
    });
    expect(result.objectives[0]?.trend).toBe("improving");
    expect(result.objectives[0]?.comparison).toMatchObject({
      previousEstimate: 0.6,
      precision: { intervalsOverlap: false, sufficient: true },
      evidence: { currentCount: 4, previousCount: 2, sufficient: true },
    });
    expect(result.objectives[1]?.delta).toBeNull();
    expect(result.summary).toMatchObject({
      comparableObjectiveCount: 1,
      delta: 0.2,
      trend: "improving",
    });
    expect(result.subjects[0]).toMatchObject({
      comparableObjectiveCount: 1,
      delta: 0.2,
      trend: "improving",
    });
  });

  test("does not publish a pedagogical delta across algorithm revisions", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "method-change",
          current: projection("current", 0.84, 5, 2, {
            algorithmRevision: "test-v2",
            low: 0.78,
            high: 0.9,
          }),
          previous: projection("previous", 0.55, 5, 1, {
            algorithmRevision: "test-v1",
            low: 0.48,
            high: 0.62,
          }),
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.objectives[0]).toMatchObject({
      trend: "method-changed",
      delta: null,
      comparison: {
        trend: "method-changed",
        variation: null,
        method: {
          changed: true,
          currentRevision: "test-v2",
          previousRevision: "test-v1",
        },
      },
    });
    expect(result.summary).toMatchObject({
      delta: null,
      trend: "method-changed",
      comparableObjectiveCount: 0,
      methodChangedObjectiveCount: 1,
    });
  });

  test("marks overlapping intervals uncertain even when estimates move", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "overlap",
          current: projection("current", 0.75, 6, 2, {
            low: 0.58,
            high: 0.88,
          }),
          previous: projection("previous", 0.5, 6, 1, {
            low: 0.35,
            high: 0.62,
          }),
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.objectives[0]).toMatchObject({
      trend: "uncertain",
      delta: { estimate: 0.25 },
      comparison: {
        precision: { intervalsOverlap: true, sufficient: true },
      },
    });
    expect(result.summary.trend).toBe("uncertain");
  });

  test("keeps a small, sufficiently precise change stable", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "stable",
          current: projection("current", 0.61, 4, 2, {
            low: 0.52,
            high: 0.7,
          }),
          previous: projection("previous", 0.6, 4, 1, {
            low: 0.5,
            high: 0.69,
          }),
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.objectives[0]).toMatchObject({
      trend: "stable",
      delta: { estimate: 0.01 },
      comparison: { precision: { intervalsOverlap: true, sufficient: true } },
    });
  });

  test("marks a strong variation uncertain when either snapshot has little evidence", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "weak-evidence",
          current: projection("current", 0.9, 1, 2, {
            low: 0.82,
            high: 0.96,
          }),
          previous: projection("previous", 0.35, 1, 1, {
            low: 0.25,
            high: 0.45,
          }),
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.objectives[0]).toMatchObject({
      trend: "uncertain",
      delta: { estimate: 0.55 },
      comparison: { evidence: { sufficient: false } },
    });
  });

  test("exposes included-evidence changes such as an exclusion", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "excluded-evidence",
          current: projection("current", 0.4, 2, 2, {
            evidenceCursor: "after-exclusion",
            includedEvidenceIds: ["evidence-1", "evidence-3"],
            low: 0.35,
            high: 0.45,
          }),
          previous: projection("previous", 0.8, 3, 1, {
            evidenceCursor: "before-exclusion",
            includedEvidenceIds: ["evidence-1", "evidence-2", "evidence-3"],
            low: 0.75,
            high: 0.85,
          }),
        },
      ],
      difficulties: [],
      plan: [],
    });

    expect(result.objectives[0]?.comparison?.evidence).toEqual({
      currentCount: 2,
      previousCount: 3,
      countDelta: -1,
      changed: true,
      addedCount: 0,
      removedCount: 1,
      sufficient: true,
    });
    expect(result.objectives[0]?.trend).toBe("uncertain");
  });

  test("aggregates recurring confirmed difficulties and chooses the actionable plan", () => {
    const result = buildLearningProgress({
      objectives: [
        {
          ...baseObjective,
          id: "objective",
          current: projection("current", 0.4, 2),
        },
      ],
      difficulties: [
        {
          id: "error-1",
          objectiveId: "objective",
          subjectId: "maths",
          taxonomy: "calculation",
          severity: 0.7,
          confidence: 0.9,
          occurredAt: new Date("2026-08-20T00:00:00.000Z"),
        },
        {
          id: "error-2",
          objectiveId: "objective",
          subjectId: "maths",
          taxonomy: "calculation",
          severity: 0.5,
          confidence: 0.8,
          occurredAt: new Date("2026-08-22T00:00:00.000Z"),
        },
      ],
      plan: [
        {
          id: "proposed",
          objectiveId: "objective",
          subjectId: "maths",
          status: "proposed",
          activityKind: "course-review",
          estimatedMinutes: 20,
          title: "Relire le cours",
          planningTaskId: null,
          scheduledAt: null,
          dueAt: null,
          createdAt: new Date("2026-08-21T00:00:00.000Z"),
        },
        {
          id: "active",
          objectiveId: "objective",
          subjectId: "maths",
          status: "in-progress",
          activityKind: "exercise",
          estimatedMinutes: 15,
          title: "Refaire deux exercices",
          planningTaskId: "task-1",
          scheduledAt: new Date("2026-08-23T10:00:00.000Z"),
          dueAt: null,
          createdAt: new Date("2026-08-22T00:00:00.000Z"),
        },
      ],
    });

    expect(result.recurringDifficulties).toEqual([
      expect.objectContaining({
        taxonomy: "calculation",
        observationCount: 2,
        recurring: true,
        averageSeverity: 0.6,
      }),
    ]);
    expect(result.summary.nextAction).toMatchObject({
      id: "active",
      status: "in-progress",
    });
  });
});
