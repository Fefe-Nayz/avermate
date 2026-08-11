import { describe, expect, test } from "bun:test";
import { chartChildren } from "./chart-settings";

describe("chartChildren", () => {
  test("preserves child series only when the preference is enabled", () => {
    const children = [{ id: "maths" }, { id: "physics" }];

    expect(chartChildren(children, true)).toEqual(children);
    expect(chartChildren(children, false)).toEqual([]);
  });
});
