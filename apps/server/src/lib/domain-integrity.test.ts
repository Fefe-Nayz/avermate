import { describe, expect, test } from "bun:test";
import {
  assertSameYear,
  collectDescendantIds,
  normalizeTargetReference,
} from "./domain-integrity";

describe("domain integrity", () => {
  test("accepts references in the same year and rejects cross-year ones", () => {
    expect(() => assertSameYear("Period", "year-a", "year-a")).not.toThrow();
    expect(() => assertSameYear("Period", "year-a", "year-b")).toThrow(
      "Period must belong to the same year",
    );
  });

  test("normalizes general targets and requires scoped references", () => {
    expect(normalizeTargetReference("general", "stale-id")).toBeNull();
    expect(normalizeTargetReference("subject", "subject-a")).toBe("subject-a");
    expect(() => normalizeTargetReference("custom", null, "Goal")).toThrow(
      "Goal requires a custom reference",
    );
  });

  test("collects an entire subtree without following unrelated roots or cycles", () => {
    const rows = [
      { id: "root", parentId: null },
      { id: "child-a", parentId: "root" },
      { id: "grandchild", parentId: "child-a" },
      { id: "child-b", parentId: "root" },
      { id: "other", parentId: null },
      // Corrupt legacy data cannot make a destructive traversal loop forever.
      { id: "root", parentId: "grandchild" },
    ];

    expect(new Set(collectDescendantIds(rows, "root"))).toEqual(
      new Set(["child-a", "child-b", "grandchild"]),
    );
  });
});
