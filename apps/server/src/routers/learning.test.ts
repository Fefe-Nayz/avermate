import { describe, expect, test } from "bun:test";
import { objectiveDagHasCycle } from "./learning";

describe("learning objective integrity", () => {
  test("rejects direct and transitive cycles", () => {
    expect(objectiveDagHasCycle([["a", "a"]])).toBe(true);
    expect(
      objectiveDagHasCycle([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]),
    ).toBe(true);
    expect(
      objectiveDagHasCycle([
        ["a", "b"],
        ["b", "c"],
      ]),
    ).toBe(false);
  });
});
