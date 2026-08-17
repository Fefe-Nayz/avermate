import { describe, expect, test } from "bun:test";
import {
  compileWidgetDefinition,
  createWidgetDefinition,
} from "@avermate/core";
import { resolveWidgetRow, type StoredWidgetRow } from "./widget-row";

const row: StoredWidgetRow = {
  id: "card-1",
  surface: "overview",
  span: 1,
  title: null,
  accent: null,
  sortOrder: 0,
  hidden: false,
  definitionVersion: null,
  definitionJson: null,
};

describe("resolveWidgetRow", () => {
  test("uses the stored definition", () => {
    const definition = createWidgetDefinition("overview");
    const resolved = resolveWidgetRow(
      { ...row, definitionVersion: 1, definitionJson: definition },
      "overview",
    );
    const compiled = compileWidgetDefinition(definition, {
      surface: "overview",
    });

    expect(compiled.valid).toBe(true);
    expect(resolved.definition).toEqual(compiled.plan!.definition);
    expect(resolved.issues).toEqual([]);
  });

  test("reports a row it cannot read rather than becoming another card", () => {
    // The old fallback read the `metric` / `display` columns and handed them to a
    // *different renderer*, so an unreadable row silently became a working card
    // that looked nothing like the one the editor showed for it.
    const resolved = resolveWidgetRow(
      { ...row, definitionVersion: 1, definitionJson: { apiVersion: 999 } },
      "overview",
    );

    expect(resolved.definition).toBeNull();
    expect(resolved.issues.length).toBeGreaterThan(0);
  });

  test("has no second representation to fall back to", () => {
    expect(resolveWidgetRow(row, "overview").definition).toBeNull();
  });

  test("refuses a definition version this build does not know", () => {
    const resolved = resolveWidgetRow(
      {
        ...row,
        definitionVersion: 2,
        definitionJson: createWidgetDefinition("overview"),
      },
      "overview",
    );

    expect(resolved.definition).toBeNull();
  });
});
