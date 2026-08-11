import { describe, expect, test } from "bun:test";
import { CARD_METRICS } from "@avermate/core";
import {
  WIDGET_CATALOG,
  isRecommendedDisplayValid,
} from "./widget-catalog";

describe("mobile widget catalog", () => {
  test("covers every core metric exactly once", () => {
    expect(WIDGET_CATALOG.map((entry) => entry.metric).sort()).toEqual(
      [...CARD_METRICS].sort(),
    );
    expect(new Set(WIDGET_CATALOG.map((entry) => entry.metric)).size).toBe(
      CARD_METRICS.length,
    );
  });

  test("only recommends displays accepted by the evaluator grammar", () => {
    expect(WIDGET_CATALOG.every(isRecommendedDisplayValid)).toBe(true);
  });

  test("keeps list and chart widgets out of quarter-width cards", () => {
    for (const entry of WIDGET_CATALOG) {
      if (entry.recommendedDisplay === "list" || entry.recommendedDisplay === "chart") {
        expect(entry.recommendedSpan).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
