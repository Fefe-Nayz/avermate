import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compileWidgetDefinition,
  defaultCards,
  widgetDefinitionFromCard,
} from "@avermate/core";

/**
 * Every path that writes a dashboard card has to write a definition.
 *
 * A card *is* its definition; the `metric` / `targetKind` / `display` columns
 * beside it are a projection of it that nothing reads. So a writer that fills in
 * only those columns produces a row the app cannot read — and it fails silently,
 * because the row inserts cleanly and only turns into "this card could not be
 * read" when someone opens the screen. The demo seed and the importer were both
 * doing exactly that.
 *
 * Nothing here imports a server module. That is deliberate: reaching `src/db`
 * binds the database singleton to whatever `DATABASE_URL` says at import time,
 * and the integration suite sets it to `file::memory:` *after* its imports, from
 * `beforeAll`. A unit test that pulls the singleton in first therefore points the
 * whole run at `dev.db` and writes to it. It cost a restore from backup to find
 * out.
 */
describe("seeded cards", () => {
  test("the default dashboard compiles as definitions", () => {
    // The conversion behind `academicCardRows`, which is what year creation,
    // presets, class templates and the importer all seed through.
    const cards = defaultCards();
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      const definition = widgetDefinitionFromCard({
        metric: card.metric,
        targetKind: card.target.kind,
        targetId: card.target.referenceId,
        goalId: null,
        display: card.display,
      });
      const compiled = compileWidgetDefinition(definition, {
        surface: "overview",
      });
      expect(compiled.issues, card.metric).toEqual([]);
      expect(compiled.valid, card.metric).toBe(true);
    }
  });

  test("every extra shape the demo account seeds compiles too", () => {
    // The complete demo account exists to draw every branch of the renderer, so
    // each of these is a shape that would otherwise only be exercised by hand.
    const shapes = [
      { metric: "goalProgress", display: "gauge", goalId: "goal-1" },
      { metric: "average", display: "sparkline", targetKind: "custom" },
      { metric: "average", display: "value", targetKind: "subject" },
      { metric: "distribution", display: "chart" },
      { metric: "subjectRanking", display: "list" },
      { metric: "passStreak", display: "value" },
      { metric: "lastGrade", display: "value" },
      { metric: "median", display: "value" },
    ] as const;

    for (const shape of shapes) {
      const targetKind = "targetKind" in shape ? shape.targetKind : "general";
      const definition = widgetDefinitionFromCard({
        metric: shape.metric,
        targetKind,
        targetId: targetKind === "general" ? null : "reference-1",
        goalId: "goalId" in shape ? shape.goalId : null,
        display: shape.display,
      });
      const compiled = compileWidgetDefinition(definition, {
        surface: "overview",
      });
      expect(compiled.issues, shape.metric).toEqual([]);
    }
  });

  const root = join(import.meta.dir, "../..");
  const WRITERS = [
    "src/routers/cards.ts",
    "src/routers/years.ts",
    "src/routers/averages.ts",
    "src/routers/presets.ts",
    "src/routers/social/groups.ts",
    "src/lib/class-template.ts",
    "scripts/seed-demo.ts",
    "scripts/migrate-legacy.ts",
  ];

  test("every writer supplies one", () => {
    for (const path of WRITERS) {
      const source = readFileSync(join(root, path), "utf8");
      expect(source, path).toContain("insert(dashboardCards)");
      // Either it builds the row itself with a definition, or it defers to a
      // helper that does.
      expect(
        /definitionJson|academicCardRows|demoCard|card\.row/.test(source),
        path,
      ).toBe(true);
    }
  });

  test("names every file that writes a card", () => {
    // A new writer that forgets the definition would otherwise never be checked.
    // This fails when one appears, which is the point at which to look at it.
    const glob = new Bun.Glob("{src,scripts}/**/*.ts");
    const found = [...glob.scanSync({ cwd: root })]
      .filter((path) => !path.endsWith(".test.ts"))
      .filter((path) =>
        readFileSync(join(root, path), "utf8").includes(
          "insert(dashboardCards)",
        ),
      )
      .map((path) => path.replaceAll("\\", "/"))
      .sort();

    expect(found).toEqual([...WRITERS].sort());
  });
});
