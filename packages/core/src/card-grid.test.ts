import { describe, expect, it } from "bun:test";
import { layoutCards, type CardSpec } from "./cards";
import {
  cardGridCells,
  layoutCardGrid,
  planGridReorder,
  resolveGridReorder,
} from "./card-grid";

function card(
  id: string,
  span: CardSpec["span"],
  display: CardSpec["display"],
): CardSpec {
  return {
    id,
    metric: "average",
    target: { kind: "general", referenceId: null },
    display,
    span,
    title: id,
    accent: null,
    goalId: null,
    sortOrder: 0,
    hidden: false,
  };
}

/** A drawing at full span: the whole row on two columns. */
const wide = (id: string) => card(id, 4, "sparkline");
/** A value card at half span: one column on two. */
const small = (id: string) => card(id, 2, "value");

const widths = (specs: readonly CardSpec[], columns: number) =>
  layoutCards(specs, columns).map((item) => `${item.spec.id}=${item.columns}`);

const rows = (specs: readonly CardSpec[], columns: number) =>
  layoutCardGrid(specs, columns).rows.map((row) =>
    row.items.map((item) => item.spec.id),
  );

describe("layoutCardGrid", () => {
  it("reports the rows the packer actually drew", () => {
    const layout = layoutCardGrid([wide("M"), small("A"), small("B")], 2);

    expect(layout.rows.map((row) => row.items.map((i) => i.spec.id))).toEqual([
      ["M"],
      ["A", "B"],
    ]);
    expect(layout.rows[0]?.remainingColumns).toBe(0);
    expect(layout.rows[1]?.remainingColumns).toBe(0);
  });

  it("keeps the hole a row had, even once filling closed it", () => {
    // One small card alone on two columns is widened to fill the row; the row
    // still had a column free for anything that asked for one.
    const layout = layoutCardGrid([small("A")], 2);

    expect(layout.byId.get("A")?.requestedColumns).toBe(1);
    expect(layout.byId.get("A")?.columns).toBe(2);
    expect(layout.byId.get("A")?.grewToFill).toBe(true);
    expect(layout.rows[0]?.remainingColumns).toBe(1);
  });

  it("agrees with layoutCards on every width", () => {
    const specs = [wide("M"), small("A"), small("B"), small("C")];
    for (const columns of [1, 2, 3, 4]) {
      const layout = layoutCardGrid(specs, columns);
      expect(layout.items.map((item) => item.columns)).toEqual(
        layoutCards(specs, columns).map((item) => item.columns),
      );
    }
  });
});

describe("resolveGridReorder", () => {
  it("drops a full-row card past a two-card row without splitting it", () => {
    const specs = [wide("M"), small("A"), small("B")];

    // The reported bug: the pointer settles on whichever small card it is
    // nearest, and both must mean the same thing.
    expect(resolveGridReorder(specs, 2, "M", "A")).toEqual(["A", "B", "M"]);
    expect(resolveGridReorder(specs, 2, "M", "B")).toEqual(["A", "B", "M"]);

    // And the arrangement that comes out is the one asked for, rather than a
    // small card widened into the big card's place.
    expect(
      widths(
        ["A", "B", "M"].map((id) => specs.find((s) => s.id === id)!),
        2,
      ),
    ).toEqual(["A=1", "B=1", "M=2"]);
    expect(rows([small("A"), small("B"), wide("M")], 2)).toEqual([
      ["A", "B"],
      ["M"],
    ]);
  });

  it("is the same story on a wide grid", () => {
    const specs = [wide("M"), small("A"), small("B")];
    expect(resolveGridReorder(specs, 4, "M", "A")).toEqual(["A", "B", "M"]);
    expect(resolveGridReorder(specs, 4, "M", "B")).toEqual(["A", "B", "M"]);
  });

  it("lifts a full-row card above a row it is travelling up to", () => {
    const specs = [small("A"), small("B"), wide("M")];
    expect(resolveGridReorder(specs, 2, "M", "A")).toEqual(["M", "A", "B"]);
    expect(resolveGridReorder(specs, 2, "M", "B")).toEqual(["M", "A", "B"]);
  });

  it("keeps single-card precision where the card really fits beside", () => {
    // `B` asks for one column and row `[A]` has one free, so the horizontal
    // choice is a real one and is honoured.
    const specs = [wide("M"), small("A"), small("B")];
    expect(resolveGridReorder(specs, 2, "B", "A")).toEqual(["M", "B", "A"]);
  });

  it("leaves the order alone for a no-op drop", () => {
    const specs = [wide("M"), small("A"), small("B")];
    expect(resolveGridReorder(specs, 2, "M", "M")).toEqual(["M", "A", "B"]);
    expect(resolveGridReorder(specs, 2, "M", "absent")).toEqual([
      "M",
      "A",
      "B",
    ]);
  });

  it("never loses, duplicates or reshuffles the cards it did not move", () => {
    const specs = [
      wide("M"),
      small("A"),
      small("B"),
      small("C"),
      wide("N"),
      small("D"),
    ];
    const ids = specs.map((spec) => spec.id);

    for (const columns of [1, 2, 3, 4]) {
      for (const activeId of ids) {
        for (const overId of ids) {
          const result = resolveGridReorder(specs, columns, activeId, overId);

          // A permutation, every time.
          expect([...result].sort()).toEqual([...ids].sort());
          expect(new Set(result).size).toBe(result.length);

          // Everything the gesture did not touch keeps its relative order.
          expect(result.filter((id) => id !== activeId)).toEqual(
            ids.filter((id) => id !== activeId),
          );

          // And nothing overflows the grid it was packed for.
          for (const row of layoutCardGrid(
            result.map((id) => specs.find((spec) => spec.id === id)!),
            columns,
          ).rows) {
            expect(row.renderedColumns).toBeLessThanOrEqual(columns);
          }
        }
      }
    }
  });

  it("swaps within a uniform 2x2 without reaching for another row", () => {
    const specs = [small("A"), small("B"), small("C"), small("D")];
    expect(rows(specs, 2)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);

    // Top-right onto top-left: one row, one swap. Reasoning about rows computed
    // with B lifted out merged A and C into a row nobody can see, and answered
    // as if B could not sit beside A.
    expect(resolveGridReorder(specs, 2, "B", "A")).toEqual([
      "B",
      "A",
      "C",
      "D",
    ]);

    // Crossing a row, where the card is no wider than the one it displaces.
    expect(resolveGridReorder(specs, 2, "B", "C")).toEqual([
      "A",
      "C",
      "B",
      "D",
    ]);
  });

  it("is a function of the stored order, which is why it must be fed only that", () => {
    // A move is not idempotent, and must not be expected to be: "put B where A
    // is" applied to its own result puts them back. That is correct for a
    // reorder and is exactly why the grid resolves against the *stored* order
    // once, rather than against the order it is currently showing. Feeding the
    // resolver its own output is what produced reordering that never settled.
    const ids = ["A", "B", "C", "D"];
    const stored = ids.map((id) => small(id));

    const first = resolveGridReorder(stored, 2, "B", "A");
    expect(first).toEqual(["B", "A", "C", "D"]);

    // Called any number of times against the stored order, the answer is one
    // and the same — the property the component actually relies on.
    for (let step = 0; step < 5; step += 1) {
      expect(resolveGridReorder(stored, 2, "B", "A")).toEqual(first);
    }

    // Whereas iterating on the result flips, as any move would.
    const second = resolveGridReorder(
      first.map((id) => small(id)),
      2,
      "B",
      "A",
    );
    expect(second).toEqual(ids);
  });

  it("is deterministic", () => {
    const specs = [wide("M"), small("A"), small("B")];
    const once = resolveGridReorder(specs, 2, "M", "A");
    const twice = resolveGridReorder(specs, 2, "M", "A");
    expect(once).toEqual(twice);
  });
});

describe("planGridReorder", () => {
  const specs = [wide("M"), small("A"), small("B")];

  it("reports the destination edge when a card lands against a whole row", () => {
    // The move a flat sortable gets wrong. Dropping the full-width card onto the
    // left half previews `[A, M, B]` — A widened into M's place, B alone below —
    // while the drop is `[A, B, M]`. Saying so lets the drag draw the edge it is
    // really heading for instead of shuffling a card that is not going to move.
    const plan = planGridReorder(specs, 2, "M", "A");

    expect(plan.order).toEqual(["A", "B", "M"]);
    expect(plan.insertion).toEqual({
      rowIndex: 1,
      edge: "after",
      anchorId: "B",
    });
  });

  it("reports the same edge from either half of that row", () => {
    // Both halves mean the row, which is the rule this exists to make visible.
    const left = planGridReorder(specs, 2, "M", "A");
    const right = planGridReorder(specs, 2, "M", "B");

    expect(right.order).toEqual(left.order);
    expect(right.insertion).toEqual(left.insertion);
  });

  it("marks the near edge when the card comes from below", () => {
    const fromBelow = [small("A"), small("B"), wide("M")];
    const plan = planGridReorder(fromBelow, 2, "M", "B");

    expect(plan.order).toEqual(["M", "A", "B"]);
    expect(plan.insertion).toEqual({
      rowIndex: 0,
      edge: "before",
      anchorId: "A",
    });
  });

  it("claims no edge for a swap inside one row", () => {
    // Here the sortable's own preview is exactly right, so it should be left
    // alone: the two halves genuinely trade places.
    const plan = planGridReorder(specs, 2, "A", "B");

    expect(plan.order).toEqual(["M", "B", "A"]);
    expect(plan.insertion).toBeNull();
  });

  it("claims no edge when the card simply fits where it is going", () => {
    const plan = planGridReorder(
      [small("A"), wide("M"), small("B")],
      2,
      "A",
      "B",
    );

    expect(plan.insertion).toBeNull();
  });

  it("agrees with resolveGridReorder, which is now a view of it", () => {
    const moves: readonly [string, string][] = [
      ["M", "A"],
      ["M", "B"],
      ["A", "B"],
      ["B", "M"],
    ];
    for (const [active, over] of moves) {
      expect(resolveGridReorder(specs, 2, active, over)).toEqual(
        planGridReorder(specs, 2, active, over).order,
      );
    }
  });
});

describe("the anchor makes a flat preview honest", () => {
  const specs = [wide("M"), small("A"), small("B")];
  const ids = specs.map((spec) => spec.id);

  const arrayMove = (order: readonly string[], from: number, to: number) => {
    const next = [...order];
    const [moved] = next.splice(from, 1);
    if (moved !== undefined) next.splice(to, 0, moved);
    return next;
  };

  it("gives the same order a sortable would compute from it", () => {
    // A sortable previews `arrayMove` onto whatever it is told the target is.
    // Told the card under the pointer, it disagrees with the drop; told the
    // anchor, it agrees exactly — which is the whole point of reporting it.
    for (const over of ["A", "B"]) {
      const plan = planGridReorder(specs, 2, "M", over);
      const anchor = plan.insertion?.anchorId ?? over;

      expect(arrayMove(ids, 0, ids.indexOf(anchor))).toEqual(plan.order);
    }
  });

  it("disagrees when told the card under the pointer, which was the bug", () => {
    const plan = planGridReorder(specs, 2, "M", "A");

    expect(arrayMove(ids, 0, ids.indexOf("A"))).not.toEqual(plan.order);
  });

  it("resolves to itself, so reporting it cannot oscillate", () => {
    const plan = planGridReorder(specs, 2, "M", "A");
    const anchor = plan.insertion?.anchorId ?? "A";
    const again = planGridReorder(specs, 2, "M", anchor);

    expect(again.order).toEqual(plan.order);
    expect(again.insertion?.anchorId).toBe(anchor);
  });
});

describe("cardGridCells", () => {
  const cells = (specs: readonly CardSpec[], columns: number) =>
    [...cardGridCells(specs, columns)].map(
      ([id, cell]) =>
        `${id}@${cell.rowIndex}:${cell.columnStart}+${cell.columnSpan}`,
    );

  it("gives every card the cell the grid places it in", () => {
    expect(cells([wide("M"), small("A"), small("B")], 2)).toEqual([
      "M@0:0+2",
      "A@1:0+1",
      "B@1:1+1",
    ]);
  });

  it("counts columns from the drawn widths, as auto-placement does", () => {
    // `A` is alone on its row and widened to close the gap, so `B` starts at the
    // top of the next row rather than beside it. Walking the requested widths
    // would put the two in one row and overlap them.
    expect(cells([wide("M"), small("A"), wide("B")], 2)).toEqual([
      "M@0:0+2",
      "A@1:0+2",
      "B@2:0+2",
    ]);
  });

  it("moves the cells a reorder produces, not a permutation of the old ones", () => {
    const specs = [wide("M"), small("A"), small("B")];
    const order = planGridReorder(specs, 2, "M", "A").order;
    const byId = new Map(specs.map((spec) => [spec.id, spec]));

    // The pair keeps its row and rises into row 0; `M` takes row 1. No card
    // inherits another's cell, which is exactly what a rect swap assumes.
    expect(
      cells(
        order.flatMap((id) => {
          const spec = byId.get(id);
          return spec ? [spec] : [];
        }),
        2,
      ),
    ).toEqual(["A@0:0+1", "B@0:1+1", "M@1:0+2"]);
  });
});
