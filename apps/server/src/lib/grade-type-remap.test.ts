import { describe, expect, test } from "bun:test";
import { uniqueGradeTypeIdsByName } from "./grade-type-remap";

describe("grade type remapping", () => {
  test("keeps unique names and rejects ambiguous normalized names", () => {
    const byName = uniqueGradeTypeIdsByName([
      { id: "ambiguous-a", name: "Shared name" },
      { id: "unique", name: "Unique name" },
      { id: "ambiguous-b", name: "  SHARED NAME  " },
    ]);

    expect(byName.get("unique name")).toBe("unique");
    expect(byName.get("shared name")).toBeNull();
  });
});
