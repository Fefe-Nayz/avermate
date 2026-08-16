import { describe, expect, test } from "bun:test";
import {
  resolveScrubberTickStep,
  resolveVisibleScrubberDays,
} from "./day-scrubber-model";

describe("scrubber tick virtualization (web parity)", () => {
  test("keeps at least a 4px gap between mounted ticks", () => {
    const step = resolveScrubberTickStep(300, 320);
    expect(step).toBeGreaterThanOrEqual(4);
    // A wide strip fits every day of a short range.
    expect(resolveScrubberTickStep(60, 320)).toBe(1);
    // Unmeasured strips fall back to a legible target count.
    expect(resolveScrubberTickStep(300, 0)).toBe(Math.ceil(301 / 96));
  });

  test("month anchors and both ends always survive the thinning", () => {
    const days = resolveVisibleScrubberDays(300, 8, [17, 47, 200]);
    expect(days[0]).toBe(0);
    expect(days.at(-1)).toBe(300);
    for (const anchor of [17, 47, 200]) expect(days).toContain(anchor);
    // Sorted, deduplicated.
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });
});
