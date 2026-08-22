import { describe, expect, test } from "bun:test";
import { projectObjectiveMastery } from "./mastery";

const asOf = new Date("2026-08-22T12:00:00.000Z");
const evidence = {
  id: "evidence-1",
  observedOutcome: 16,
  denominator: 20,
  reliability: 0.9,
  difficulty: null,
  occurredAt: new Date("2026-08-20T12:00:00.000Z"),
  included: true,
};

describe("learning mastery projection", () => {
  test("replays byte-for-byte for the same cursor and revision", () => {
    const first = projectObjectiveMastery({ evidence: [evidence], asOf });
    const second = projectObjectiveMastery({ evidence: [evidence], asOf });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.digest).toBe(second.digest);
    expect(first.explanation.contributions[0]?.difficulty).toBeNull();
  });

  test("retains excluded and rubric-less evidence without scoring it", () => {
    const result = projectObjectiveMastery({
      asOf,
      evidence: [
        { ...evidence, included: false, exclusionReason: "wrong objective" },
        {
          ...evidence,
          id: "evidence-2",
          observedOutcome: null,
          denominator: null,
        },
      ],
    });
    expect(result.evidenceCount).toBe(0);
    expect(result.estimate).toBe(0.5);
    expect(result.explanation.contributions).toEqual([
      expect.objectContaining({
        included: false,
        exclusionReason: "wrong objective",
      }),
      expect.objectContaining({
        included: false,
        exclusionReason: "no defined numeric rubric",
      }),
    ]);
  });

  test("strong later evidence moves the estimate while preserving uncertainty", () => {
    const initial = projectObjectiveMastery({
      asOf,
      evidence: [{ ...evidence, observedOutcome: 4 }],
    });
    const later = projectObjectiveMastery({
      asOf,
      evidence: [
        { ...evidence, observedOutcome: 4 },
        {
          ...evidence,
          id: "evidence-2",
          observedOutcome: 19,
          occurredAt: new Date("2026-08-22T10:00:00.000Z"),
        },
      ],
    });
    expect(later.estimate).toBeGreaterThan(initial.estimate);
    expect(later.low).toBeLessThanOrEqual(later.estimate);
    expect(later.high).toBeGreaterThanOrEqual(later.estimate);
  });
});
