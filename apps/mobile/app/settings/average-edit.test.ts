import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "average-edit.tsx"), "utf8");
const presetEditor = readFileSync(
  join(
    import.meta.dir,
    "..",
    "..",
    "components",
    "admin",
    "preset-configuration-editor.tsx",
  ),
  "utf8",
);

describe("native custom average dashboard semantics", () => {
  test("offers a one-shot DataCard only on creation", () => {
    expect(source).toContain('label={t("Add a DataCard to the dashboard")}');
    expect(source).toContain("!existing");
    expect(source).toContain("addDashboardCard");
    expect(source).not.toContain("setIsMain");
    expect(source).not.toContain('label={t("Show on the dashboard")}');
  });

  test("the preset builder does not expose headline custom averages", () => {
    expect(presetEditor).not.toContain('label={t("Headline average")}');
    expect(presetEditor).not.toContain("value={selectedAverage.isMain}");
  });
});
