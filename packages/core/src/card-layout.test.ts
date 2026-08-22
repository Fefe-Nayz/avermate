import { describe, expect, test } from "bun:test";
import {
  availableSpans,
  cardColumns,
  layoutCards,
  spanForColumns,
  type CardDisplay,
  type CardMetric,
  type CardSpec,
} from "./cards";
import { layoutCardGrid } from "./card-grid";
import {
  WIDGET_RECIPES,
  widgetRecipeLayout,
  type WidgetChartRecipe,
} from "./widget-recipes";

/** What the web derives from a definition, in the shape these fixtures speak. */
function recipeForDisplay(display: CardDisplay): WidgetChartRecipe {
  if (display === "value") return "value";
  if (display === "gauge") return "gauge";
  if (display === "sparkline") return "sparkline";
  if (display === "list") return "ranking";
  return "bar";
}

function card(
  id: string,
  span: CardSpec["span"],
  display: CardDisplay = "value",
  metric: CardMetric = "average",
  recipe: WidgetChartRecipe = recipeForDisplay(display),
): CardSpec {
  return {
    id,
    metric,
    target: { kind: "general", referenceId: null },
    display,
    recipe,
    span,
    title: null,
    accent: null,
    goalId: null,
    sortOrder: 0,
    hidden: false,
  };
}

const number = { recipe: "value" as const };
const named = { recipe: "value" as const };
/** A body that cannot be read in a sliver, whatever its metric is. */
const wide = { recipe: "histogram" as const };

const widths = (specs: CardSpec[], columns: number) =>
  layoutCards(specs, columns).map((item) => item.columns);

/** Every ordered combination of one to four spans, for exhaustive checks. */
function everyRow(columns: number): Array<Array<1 | 2 | 3 | 4>> {
  const spans: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
  const rows: Array<Array<1 | 2 | 3 | 4>> = [];
  for (let length = 1; length <= 4; length += 1) {
    const walk = (prefix: Array<1 | 2 | 3 | 4>) => {
      if (prefix.length === length) {
        rows.push(prefix);
        return;
      }
      for (const span of spans) walk([...prefix, span]);
    };
    walk([]);
  }
  return rows;
}

describe("card layout", () => {
  test("a stored span means the same fraction of the row on every surface", () => {
    expect(cardColumns(card("a", 1), 4)).toBe(1);
    expect(cardColumns(card("a", 2), 4)).toBe(2);
    expect(cardColumns(card("a", 4), 4)).toBe(4);

    // Half the columns, so half the width — the layout is rescaled, not
    // thrown away and replaced by a stack of full-width cards.
    expect(cardColumns(card("a", 1), 2)).toBe(1);
    expect(cardColumns(card("a", 2), 2)).toBe(1);
    expect(cardColumns(card("a", 4), 2)).toBe(2);
  });

  test("a drawing is never squeezed below the width it needs", () => {
    // A number survives a quarter of a wide grid; a chart does not.
    expect(cardColumns(card("a", 1, "chart"), 4)).toBe(2);
    expect(cardColumns(card("a", 1, "list"), 4)).toBe(2);
    expect(cardColumns(card("a", 1, "gauge"), 4)).toBe(1);

    // On a two-column phone that floor is the whole row.
    expect(cardColumns(card("a", 1, "sparkline"), 2)).toBe(2);
    expect(cardColumns(card("a", 2, "chart"), 2)).toBe(2);
    expect(cardColumns(card("a", 1, "value"), 2)).toBe(1);
  });

  test("a text card keeps whatever width it was given", () => {
    // The cards that used to read "STRONGE… / Espag…" are not narrowed by the
    // engine: a grid only reaches four columns once it is wide enough for
    // them, so a quarter is a real tile and the dashboard keeps its variety.
    expect(cardColumns(card("a", 1, "value", "bestSubject"), 4)).toBe(1);
    expect(cardColumns(card("a", 1, "value", "lastGrade"), 3)).toBe(1);
    expect(cardColumns(card("a", 1, "value", "passRate"), 4)).toBe(1);
  });

  test("a short row is filled by growing its cards evenly", () => {
    expect(widths([card("a", 1), card("b", 1)], 4)).toEqual([2, 2]);
    expect(widths([card("a", 2), card("b", 1)], 4)).toEqual([2, 2]);
    expect(widths([card("a", 3)], 4)).toEqual([4]);
  });

  test("a card is never grown to more than twice what it asked for", () => {
    // The rule is per card, and the fill now stops at each card's own cap
    // instead of cancelling the whole row's growth when one card would exceed
    // it. A lone quarter-row card cannot quadruple, so it doubles and the
    // dashboard keeps the smaller hole — which is where the "add a card" button
    // goes. It used to be reset all the way back to a quarter, leaving three
    // columns empty to avoid a violation that only ever applied to the fourth.
    expect(widths([card("a", 1)], 4)).toEqual([2]);
    expect(widths([card("a", 1)], 3)).toEqual([2]);
    expect(widths([card("a", 4), card("b", 1)], 4)).toEqual([4, 2]);
  });

  test("filling a row is maximal under that cap", () => {
    // Exhaustive over every row a grid this size can hold: the fill must never
    // overflow, never exceed a card's cap, and never stop while some card could
    // still legally take a column.
    for (const columns of [1, 2, 3, 4]) {
      for (const spans of everyRow(columns)) {
        const cards = spans.map((span, index) => card(`c${index}`, span));
        const placed = layoutCards(cards, columns);
        const rows = layoutCardGrid(cards, columns).rows;

        for (const row of rows) {
          const drawn = row.items.reduce((sum, item) => sum + item.columns, 0);
          expect(drawn, `${columns}:${spans.join(",")}`).toBeLessThanOrEqual(
            columns,
          );

          for (const item of row.items) {
            const cap = Math.min(columns, item.requestedColumns * 2);
            expect(
              item.columns,
              `${columns}:${spans.join(",")}`,
            ).toBeLessThanOrEqual(cap);
          }

          // Maximal: if the row has room left, every card in it is at its cap.
          if (drawn < columns) {
            for (const item of row.items) {
              const cap = Math.min(columns, item.requestedColumns * 2);
              expect(item.columns, `${columns}:${spans.join(",")}`).toBe(cap);
            }
          }
        }

        // And the flat view agrees with the row view, card for card.
        expect(placed.map((item) => item.columns)).toEqual(
          rows.flatMap((row) => row.items.map((item) => item.columns)),
        );
      }
    }
  });

  test("a lone card on a phone takes the row rather than half of it", () => {
    expect(widths([card("a", 1)], 2)).toEqual([2]);
    expect(widths([card("a", 1), card("b", 1)], 2)).toEqual([1, 1]);
    expect(widths([card("a", 1), card("b", 1), card("c", 1)], 2)).toEqual([
      1, 1, 2,
    ]);
  });

  test("the dashboard in the screenshot keeps its two-up rhythm on a phone", () => {
    const dashboard = [
      card("average", 2, "sparkline"),
      card("best", 1, "value", "bestSubject"),
      card("worst", 1, "value", "worstSubject"),
      card("last", 1, "value", "lastGrade"),
      card("pass", 1, "gauge", "passRate"),
      card("ranking", 2, "list", "subjectRanking"),
    ];

    // Two up, with the sparkline and the ranking taking their own rows.
    expect(widths(dashboard, 2)).toEqual([2, 1, 1, 1, 1, 2]);
    // And on a wide grid the arrangement is kept exactly as it was built.
    expect(widths(dashboard, 4)).toEqual([2, 1, 1, 1, 1, 2]);
  });

  test("no row ever overflows its grid", () => {
    const specs = [
      card("a", 3),
      card("b", 2),
      card("c", 1),
      card("d", 4),
      card("e", 1, "chart"),
      card("f", 1, "value", "bestSubject"),
      card("g", 1),
    ];

    for (const columns of [1, 2, 3, 4]) {
      let used = 0;
      for (const item of layoutCards(specs, columns)) {
        expect(item.columns).toBeGreaterThanOrEqual(1);
        expect(item.columns).toBeLessThanOrEqual(columns);
        used =
          used + item.columns > columns ? item.columns : used + item.columns;
        expect(used).toBeLessThanOrEqual(columns);
      }
    }
  });

  test("the editor offers the widths the surface actually has", () => {
    expect(availableSpans(number, 4).map((item) => item.columns)).toEqual([
      1, 2, 3, 4,
    ]);
    // A phone has two widths, not four, so it must not pretend otherwise.
    expect(availableSpans(number, 2).map((item) => item.columns)).toEqual([
      1, 2,
    ]);
    // And a chart on a phone has one: it cannot be drawn at half a row.
    expect(
      availableSpans({ recipe: "bar" }, 2).map((item) => item.columns),
    ).toEqual([2]);
    // A card that reports a name is offered every width, same as any other.
    expect(availableSpans(named, 4).map((item) => item.columns)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  test("editing a width on a phone leaves a desktop layout it already fits", () => {
    // Span 1 and span 2 both draw at half a phone row. Choosing "half" while
    // the card is already a desktop quarter must not silently widen it.
    expect(spanForColumns(1, 1, number, 2)).toBe(1);
    expect(spanForColumns(2, 1, number, 2)).toBe(2);
    expect(spanForColumns(3, 2, number, 2)).toBe(3);
  });

  test("editing a width on a phone moves to the nearest span that draws it", () => {
    expect(spanForColumns(1, 2, number, 2)).toBe(3);
    expect(spanForColumns(4, 1, number, 2)).toBe(2);
    expect(spanForColumns(2, 4, number, 4)).toBe(4);
  });

  test("a width the surface cannot draw leaves the stored span alone", () => {
    expect(spanForColumns(2, 1, { recipe: "bar" }, 2)).toBe(2);
  });

  test("a round trip through a phone edit is stable", () => {
    for (const span of [1, 2, 3, 4] as const) {
      const drawn = cardColumns({ ...number, span }, 2);
      expect(spanForColumns(span, drawn, number, 2)).toBe(span);
    }
  });
});
