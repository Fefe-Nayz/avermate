import { describe, expect, test } from "bun:test";
import { learningPlanPolicy } from "./planning-policy";

const now = new Date("2026-08-22T12:00:00.000Z");

describe("learning plan policy", () => {
  test("prioritizes an imminent deadline and exposes every component", () => {
    const base = learningPlanPolicy({
      estimate: 0.4,
      low: 0.2,
      high: 0.6,
      freshnessDays: 10,
      dueAt: null,
      prerequisiteEstimates: [],
      dependentEstimates: [],
      availableMinutes: 25,
      now,
    });
    const urgent = learningPlanPolicy({
      estimate: 0.4,
      low: 0.2,
      high: 0.6,
      freshnessDays: 10,
      dueAt: new Date("2026-08-23T12:00:00.000Z"),
      prerequisiteEstimates: [],
      dependentEstimates: [],
      availableMinutes: 25,
      now,
    });
    expect(urgent.score).toBeGreaterThan(base.score);
    expect(urgent.dueUrgency).toBeCloseTo(13 / 14);
    expect(urgent.estimatedMinutes).toBe(20);
  });

  test("raises prerequisites and delays objectives with unmet prerequisites", () => {
    const prerequisite = learningPlanPolicy({
      estimate: 0.5,
      low: 0.3,
      high: 0.7,
      freshnessDays: null,
      dueAt: null,
      prerequisiteEstimates: [],
      dependentEstimates: [{ id: "dependent", estimate: 0.3 }],
      availableMinutes: 10,
      now,
    });
    const blocked = learningPlanPolicy({
      estimate: 0.5,
      low: 0.3,
      high: 0.7,
      freshnessDays: null,
      dueAt: null,
      prerequisiteEstimates: [{ id: "prerequisite", estimate: 0.3 }],
      dependentEstimates: [],
      availableMinutes: 10,
      now,
    });
    expect(prerequisite.score).toBeGreaterThan(blocked.score);
    expect(prerequisite.neededByWeakObjectiveIds).toEqual(["dependent"]);
    expect(blocked.unmetPrerequisiteIds).toEqual(["prerequisite"]);
    expect(blocked.estimatedMinutes).toBe(10);
  });
});
