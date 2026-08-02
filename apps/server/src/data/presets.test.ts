import { describe, expect, test } from "bun:test";
import { PRESETS } from "./presets";
import type { PresetSubject } from "./preset-types";

/**
 * Presets are hand-written data, and the one mistake they invite is a name in
 * a custom average that does not match any subject the preset creates. The
 * importer drops those entries silently, so a typo would ship as an average
 * that quietly counts nothing.
 */

function names(tree: readonly PresetSubject[], out: string[] = []): string[] {
  for (const node of tree) {
    out.push(node.name);
    if (node.children) names(node.children, out);
  }
  return out;
}

describe("presets", () => {
  test("ids are unique", () => {
    const ids = PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every preset creates at least one subject", () => {
    for (const preset of PRESETS) {
      expect(names(preset.subjects).length).toBeGreaterThan(0);
    }
  });

  test("subject names are unique within a preset", () => {
    for (const preset of PRESETS) {
      const list = names(preset.subjects);
      const duplicates = list.filter(
        (name, index) => list.indexOf(name) !== index,
      );
      expect({ preset: preset.id, duplicates }).toEqual({
        preset: preset.id,
        duplicates: [],
      });
    }
  });

  test("custom averages only reference subjects the preset creates", () => {
    for (const preset of PRESETS) {
      const known = new Set(names(preset.subjects));
      for (const average of preset.averages) {
        const unknown = average.entries
          .map((entry) => entry.name)
          .filter((name) => !known.has(name));
        expect({ preset: preset.id, average: average.name, unknown }).toEqual({
          preset: preset.id,
          average: average.name,
          unknown: [],
        });
      }
    }
  });

  test("coefficients are positive where they are set", () => {
    for (const preset of PRESETS) {
      const walk = (tree: readonly PresetSubject[]) => {
        for (const node of tree) {
          if (node.coefficient !== undefined) {
            expect(node.coefficient).toBeGreaterThan(0);
          }
          if (node.children) walk(node.children);
        }
      };
      walk(preset.subjects);
    }
  });
});
