import { describe, expect, test } from "bun:test";
import {
  compileWidgetDefinition,
  createWidgetDefinition,
} from "@avermate/core";
import { resolveWidgetRow, type StoredWidgetRow } from "./widget-row";

const row: StoredWidgetRow = {
  id: "card-1",
  surface: "overview",
  metric: "passRate",
  targetKind: "general",
  targetId: null,
  goalId: null,
  display: "gauge",
  span: 1,
  title: null,
  accent: null,
  sortOrder: 0,
  hidden: false,
  definitionVersion: null,
  definitionJson: null,
};

describe("resolveWidgetRow", () => {
  test("uses a valid V1 definition", () => {
    const definition = createWidgetDefinition("overview");
    const resolved = resolveWidgetRow(
      { ...row, definitionVersion: 1, definitionJson: definition },
      "overview",
    );
    const compiled = compileWidgetDefinition(definition, {
      surface: "overview",
    });
    expect(resolved.source).toBe("v1");
    expect(resolved.legacySpec).toBeNull();
    expect(compiled.valid).toBe(true);
    expect(compiled.plan).not.toBeNull();
    expect(resolved.definition).toEqual(compiled.plan!.definition);
  });

  test("falls back to legacy columns for unknown JSON", () => {
    const resolved = resolveWidgetRow(
      { ...row, definitionVersion: 1, definitionJson: { apiVersion: 999 } },
      "overview",
    );
    expect(resolved.source).toBe("legacy");
    expect(resolved.legacySpec?.display).toBe("gauge");
    expect(resolved.definition.analysis.measure).toMatchObject({
      kind: "metric",
      metric: "passRate",
    });
    expect(resolved.issues.length).toBeGreaterThan(0);
  });

  test("keeps the persisted sparkline display in the legacy spec", () => {
    const resolved = resolveWidgetRow(
      { ...row, metric: "average", display: "sparkline" },
      "overview",
    );

    expect(resolved.source).toBe("legacy");
    expect(resolved.legacySpec).toMatchObject({
      metric: "average",
      display: "sparkline",
    });
  });
});
