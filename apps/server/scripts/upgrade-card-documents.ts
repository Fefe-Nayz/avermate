import { Database } from "bun:sqlite";
import {
  compileWidgetDefinition,
  WIDGET_DEFINITION_VERSION,
  type WidgetChartRecipe,
  type WidgetDefinition,
  type WidgetSurface,
} from "@avermate/core";

/**
 * Rewrites stored card documents from the first version into the second.
 *
 * A one-off, run by hand, and deliberately *not* a reader inside the app: the second
 * version is the only shape the code knows, and a permanent translation layer would mean
 * two shapes forever — which is exactly what the model change was for. So the translation
 * lives here, runs once against a database, and is then history.
 *
 * What it has to reconstruct is the derivation the old model did at render time. A first
 * version document stored a *mark*, and what a card actually looked like depended on the
 * rest of the document: a `gauge` carrying thresholds was drawn as a bullet, a `line` with
 * every axis turned off was the dashboard's sparkline, a day-grained `heatmap` over a
 * completed calendar was a calendar, a subject-grouped `list` was the measured ranking. The
 * second version stores that answer instead of re-deriving it, so this is where the old
 * derivation is performed for the last time.
 *
 *   bun run scripts/upgrade-card-documents.ts [--apply] [path/to/dev.db]
 *
 * Without `--apply` it reports what it would write and changes nothing.
 */

const apply = process.argv.includes("--apply");
const file =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "dev.db";

// `readonly: false` is not the inverse of `readonly: true` for this driver — passing it
// explicitly is a misuse — so the writable case takes the plain constructor.
const database = apply
  ? new Database(file)
  : new Database(file, { readonly: true });

/** The recipe a first-version document meant, from its mark and its context. */
function recipeOf(document: Record<string, any>): WidgetChartRecipe {
  const visualization = document.visualization ?? {};
  const mark: string = visualization.mark ?? "value";
  const groupBy = document.analysis?.groupBy ?? { kind: "none" };
  const axes = visualization.axes ?? {};
  const bare = !axes.x?.visible && !axes.y?.visible;

  if (mark === "gauge") {
    return (visualization.thresholds ?? []).length > 0 ? "bullet" : "gauge";
  }
  if (mark === "line" || mark === "area") return bare ? "sparkline" : mark;
  if (mark === "heatmap") {
    return groupBy.kind === "time" &&
      groupBy.interval === "day" &&
      groupBy.fill === "calendar"
      ? "calendar"
      : "heatmap";
  }
  if (mark === "list") return groupBy.kind === "subject" ? "ranking" : "list";
  if (mark === "band") return "projection-band";
  return mark as WidgetChartRecipe;
}

const DIMENSION_ID = "group";
const MEASURE_ID = "measure";

/** The channel, pointed at the id that replaced its fixed field name. */
function channelOf(
  encoding: Record<string, any> | null | undefined,
  hasDimension: boolean,
): { field: string; type: string } | null {
  if (!encoding || typeof encoding.field !== "string") return null;
  const field: string = encoding.field;
  if (field === "date" || field === "category") {
    return hasDimension
      ? { field: DIMENSION_ID, type: field === "date" ? "temporal" : "nominal" }
      : null;
  }
  return {
    field: field === "value" ? MEASURE_ID : `${MEASURE_ID}.${field}`,
    type: "quantitative",
  };
}

function upgrade(
  document: Record<string, any>,
  surface: WidgetSurface,
): WidgetDefinition {
  const analysis = document.analysis ?? {};
  const groupBy = analysis.groupBy ?? { kind: "none" };
  const dimensions =
    groupBy.kind === "time"
      ? [
          {
            id: DIMENSION_ID,
            kind: "time" as const,
            grain: groupBy.interval ?? "week",
            accumulation: groupBy.accumulation ?? "running",
            fill: groupBy.fill ?? "observed",
          },
        ]
      : groupBy.kind === "subject"
        ? [
            {
              id: DIMENSION_ID,
              kind: "subject" as const,
              // The first version's subject grouping listed every node it could, filtered
              // by `includeCategories`: that is `all`.
              level: "all" as const,
              includeCategories: groupBy.includeCategories ?? false,
              limit: groupBy.limit ?? 10,
            },
          ]
        : [];

  const visualization = document.visualization ?? {};
  const encoding = visualization.encoding ?? {};
  const hasDimension = dimensions.length > 0;

  return {
    apiVersion: WIDGET_DEFINITION_VERSION,
    query: {
      source: "grades",
      scope: document.query?.scope ?? { kind: "general" },
      window: document.query?.window ?? { kind: "active-period" },
      filters: document.query?.filters ?? [],
    },
    analysis: {
      measures: [
        {
          id: MEASURE_ID,
          label: null,
          expression: analysis.measure ?? {
            kind: "metric",
            metric: "average",
            goalId: null,
          },
        },
      ],
      dimensions,
      comparison: analysis.comparison ?? { kind: "none" },
      transforms: analysis.transforms ?? [],
    },
    visualization: {
      recipe: recipeOf(document),
      encoding: {
        x: channelOf(encoding.x, hasDimension),
        y: channelOf(encoding.y, hasDimension),
        color: channelOf(encoding.color, hasDimension),
        series: null,
        facet: null,
      },
      options: visualization.options ?? {
        kind: "value",
        showDelta: true,
        trendIndicator: true,
      },
      scale: visualization.scale ?? {
        x: { reverse: false },
        y: { zero: false, min: null, max: null, reverse: false },
      },
      axes: visualization.axes ?? {
        x: { visible: false, grid: false, label: null },
        y: { visible: false, grid: false, label: null },
      },
      legend: visualization.legend ?? { visible: false, position: "bottom" },
      format: visualization.format ?? {
        decimals: null,
        unit: "auto",
        compact: false,
      },
      thresholds: visualization.thresholds ?? [],
    },
    presentation: {
      mode: surface === "insights" ? "analytical" : "dashboard",
      responsiveBehavior: "adapt",
    },
  } as WidgetDefinition;
}

/**
 * The series channel is dropped rather than carried across.
 *
 * In the first version a series channel naming `category` was the *only* way to say "one
 * line per subject", and it worked by a special case in the evaluator. The second version
 * says it with a second dimension, and a channel pointing at a dimension that is not there
 * would be refused by the compiler. Those cards become single-series charts — the same
 * measure over the same window — and can be split again in the editor, deliberately.
 */

interface Row {
  id: string;
  definitionVersion: number;
  definitionJson: string;
  surface?: string;
  surfaces?: string;
}

let converted = 0;
let alreadyCurrent = 0;
const failures: Array<{ table: string; id: string; issues: string[] }> = [];

for (const table of ["dashboard_cards", "card_templates"] as const) {
  const rows = database
    .query(
      table === "dashboard_cards"
        ? `select id, definitionVersion, definitionJson, surface from ${table}`
        : `select id, definitionVersion, definitionJson, surfaces from ${table}`,
    )
    .all() as Row[];

  const update = apply
    ? database.prepare(
        `update ${table} set definitionVersion = ?, definitionJson = ? where id = ?`,
      )
    : null;

  for (const row of rows) {
    const document = JSON.parse(row.definitionJson) as Record<string, any>;
    // Decided by the *document*, not by the column beside it. Three template rows carried a
    // version of 2 and a first-version body — written by a client that stamped the current
    // version onto an old payload — and they were exactly the rows that crashed the admin
    // gallery with "analysis.measures is not iterable". A column claiming a shape is not
    // the shape.
    if (Array.isArray(document.analysis?.measures)) {
      alreadyCurrent += 1;
      continue;
    }
    const surface = (row.surface ??
      (JSON.parse(row.surfaces ?? '["overview"]') as string[])[0] ??
      "overview") as WidgetSurface;
    const upgraded = upgrade(document, surface);

    // Compiled before it is written: a row that will not compile is a card that reads as
    // unreadable in the app, and finding that out here is the point of the exercise.
    const compiled = compileWidgetDefinition(upgraded, { surface });
    if (!compiled.valid) {
      failures.push({
        table,
        id: row.id,
        issues: compiled.issues.map((issue) => `${issue.path} ${issue.code}`),
      });
      continue;
    }

    update?.run(
      WIDGET_DEFINITION_VERSION,
      // The *canonical* document, not the hand-built one: whatever the compiler decided is
      // what the app will read back, so that is what gets stored.
      JSON.stringify(compiled.plan?.definition ?? upgraded),
      row.id,
    );
    converted += 1;
  }
}

console.log(
  `${apply ? "converted" : "would convert"} ${converted} document(s); ${alreadyCurrent} already current; ${failures.length} refused`,
);
for (const failure of failures.slice(0, 20)) {
  console.log(`  ${failure.table} ${failure.id}: ${failure.issues.join(", ")}`);
}
if (failures.length > 20) {
  console.log(`  …and ${failures.length - 20} more`);
}
