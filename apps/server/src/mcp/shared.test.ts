import { describe, expect, test } from "bun:test";
import { goalPatch, periodPatch, subjectPatch, yearPatch } from "./shared";

describe("MCP academic patch schemas", () => {
  test("never materialize create defaults in a partial update", () => {
    expect(yearPatch.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(periodPatch.parse({ name: "Renamed" })).toEqual({
      name: "Renamed",
    });
    expect(subjectPatch.parse({ name: "Renamed" })).toEqual({
      name: "Renamed",
    });
    expect(goalPatch.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});
