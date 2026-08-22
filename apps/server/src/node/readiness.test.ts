import { describe, expect, test } from "bun:test";
import { nodePlacementMigrationReady } from "./readiness";

describe("Node placement readiness", () => {
  test("requires verified migration for durable ownership", () => {
    for (const capability of [
      "storage",
      "conversations",
      "retrieval",
    ] as const) {
      expect(nodePlacementMigrationReady(capability, "verified")).toBe(true);
      expect(nodePlacementMigrationReady(capability, "not-required")).toBe(
        false,
      );
      expect(nodePlacementMigrationReady(capability, "copying")).toBe(false);
    }
  });

  test("accepts explicit not-required for execution-only capabilities", () => {
    for (const capability of ["models", "sandbox", "jobs"] as const) {
      expect(nodePlacementMigrationReady(capability, "not-required")).toBe(
        true,
      );
      expect(nodePlacementMigrationReady(capability, "verified")).toBe(true);
      expect(nodePlacementMigrationReady(capability, "planned")).toBe(false);
    }
  });
});
