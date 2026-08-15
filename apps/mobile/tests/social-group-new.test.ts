import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "..", "app", "social", "groups", "new.tsx"),
  "utf8",
);
const indexSource = readFileSync(
  join(import.meta.dir, "..", "app", "social", "groups", "index.tsx"),
  "utf8",
);
const layoutSource = readFileSync(
  join(import.meta.dir, "..", "app", "_layout.tsx"),
  "utf8",
);

describe("native class creation flow", () => {
  test("uses a registered full-page route instead of an inline form", () => {
    expect(layoutSource).toContain('name="social/groups/new"');
    expect(indexSource).toContain('router.push("/social/groups/new")');
    expect(indexSource).not.toContain("setCreating");
  });

  test("submits both supported class template variants", () => {
    expect(source).toContain('{ mode: "year", yearId: templateYearId! }');
    expect(source).toContain('mode: "builder"');
    expect(source).toContain("configuration,");
    expect(source).toContain("presetId,");
  });

  test("supports templates and editable custom periods", () => {
    expect(source).toContain('mode: "template"');
    expect(source).toContain('mode: "custom"');
    expect(source).toContain('periodMode === "custom"');
    expect(source).toContain("<CustomPeriodsEditor");
  });

  test("keeps technical preset controls out of the consumer builder", () => {
    expect(source).toContain("technical={false}");
  });
});
