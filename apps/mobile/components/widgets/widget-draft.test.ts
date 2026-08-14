import { describe, expect, test } from "bun:test";
import {
  removeWidgetDraftValue,
  setWidgetDraftValue,
  widgetDraftValue,
  type WidgetDraftValue,
} from "./widget-draft";

describe("widget draft paths", () => {
  test("reads and immutably writes nested descriptor paths", () => {
    const original: WidgetDraftValue = {
      query: { scope: { kind: "general" }, filters: [] },
    };
    const next = setWidgetDraftValue(original, "query.scope.kind", "subjects");

    expect(widgetDraftValue(next, "query.scope.kind")).toBe("subjects");
    expect(widgetDraftValue(original, "query.scope.kind")).toBe("general");
  });

  test("supports collection indices", () => {
    const original: WidgetDraftValue = { query: { filters: [] } };
    const next = setWidgetDraftValue(
      original,
      "query.filters.0.kind",
      "passed",
    );

    expect(widgetDraftValue(next, "query.filters.0.kind")).toBe("passed");
  });

  test("removes values and prunes empty parents", () => {
    const original: WidgetDraftValue = {
      visualization: { thresholds: [{ value: 0.5 }] },
    };
    const next = removeWidgetDraftValue(original, "visualization.thresholds.0");

    expect(widgetDraftValue(next, "visualization.thresholds")).toBeUndefined();
  });
});
