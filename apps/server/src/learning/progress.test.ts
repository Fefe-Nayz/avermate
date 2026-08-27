import { describe, expect, test } from "bun:test";
import {
  buildLearningProgress,
  isMeasuredProjection,
  type LearningProgressObjectiveInput,
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
) {
  return {
    id,
    generation,
    estimate,
    low: Math.max(0, estimate - 0.1),
    high: Math.min(1, estimate + 0.1),
    evidenceCount,
    freshnessDays: evidenceCount > 0 ? 4 : null,
    asOf: new Date(
      `2026-08-${String(10 + generation).padStart(2, "0")}T00:00:00.000Z`,
    ),
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
      confidenceScore: null,
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
          current: projection("current-a", 0.8, 4, 2),
          previous: projection("previous-a", 0.6, 2, 1),
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
      previousEstimate: 0.6,
      trend: "improving",
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
