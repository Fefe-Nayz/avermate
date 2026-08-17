import { describe, expect, it } from "bun:test";
import { layoutCards, type CardSpec } from "./cards";
import {
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
/** A value card at half span: one column on two, two on four. */
const small = (id: string) => card(id, 2, "value");
/** A quarter-span value card: one column on four. */
const quarter = (id: string) => card(id, 1, "value");

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

describe("a reorder changes how wide cards are, not only where they sit", () => {
  const reordered = (
    specs: readonly CardSpec[],
    columns: number,
    activeId: string,
    overId: string,
  ) => {
    const order = planGridReorder(specs, columns, activeId, overId).order;
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    return layoutCardGrid(
      order.flatMap((id) => {
        const spec = byId.get(id);
        return spec ? [spec] : [];
      }),
      columns,
    );
  };

  it("widens the cards a move leaves alone on their rows", () => {
    // The case a translated preview cannot draw. `A` and `B` share a row, so
    // each has one column. Send `B` below the full-width `M` and neither has a
    // partner any more: the packer widens *both* to close their rows, and `A`
    // has not been dragged at all.
    const specs = [small("A"), small("B"), wide("M")];
    expect(widths(specs, 2)).toEqual(["A=1", "B=1", "M=2"]);

    const layout = reordered(specs, 2, "B", "M");

    expect(layout.items.map((item) => item.spec.id)).toEqual(["A", "M", "B"]);
    expect(layout.byId.get("A")?.columns).toBe(2);
    expect(layout.byId.get("M")?.columns).toBe(2);
    expect(layout.byId.get("B")?.columns).toBe(2);
  });

  it("narrows a card that gains a partner", () => {
    // And the other direction: `A` and `B` are each alone and widened, and
    // bringing them together halves both. A preview that keeps the width it
    // measured draws two full-row cards in one row of two columns.
    const specs = [small("A"), wide("M"), small("B")];
    expect(widths(specs, 2)).toEqual(["A=2", "M=2", "B=2"]);

    const layout = reordered(specs, 2, "B", "A");

    expect(layout.items.map((item) => item.spec.id)).toEqual(["B", "A", "M"]);
    expect(layout.byId.get("B")?.columns).toBe(1);
    expect(layout.byId.get("A")?.columns).toBe(1);
  });

  it("re-splits the rows of the arrangement in the recording", () => {
    // Four small cards under a full-width average, which is the dashboard in the
    // video. Dropping the average below them takes it from a row of its own to
    // sharing a row with the ranking — half the width it had.
    const specs = [
      small("average"),
      quarter("latest"),
      quarter("weakest"),
      quarter("strongest"),
      quarter("pass"),
      small("ranking"),
    ];
    expect(rows(specs, 4)).toEqual([
      ["average", "latest", "weakest"],
      ["strongest", "pass", "ranking"],
    ]);

    const layout = reordered(specs, 4, "average", "ranking");

    expect(layout.rows.map((row) => row.items.map((item) => item.spec.id)))
      .toEqual([
        ["latest", "weakest", "strongest", "pass"],
        ["ranking", "average"],
      ]);
    expect(layout.byId.get("average")?.columns).toBe(2);
    expect(layout.byId.get("ranking")?.columns).toBe(2);
    for (const id of ["latest", "weakest", "strongest", "pass"]) {
      expect(layout.byId.get(id)?.columns).toBe(1);
    }
  });

  it("answers the same however many times the same target is resolved", () => {
    // The property the drag relies on: the target is resolved against the order
    // the drag *started* from, so a pointer that has not moved cannot produce a
    // second, different arrangement — however often the grid re-renders in
    // between.
    const specs = [small("A"), small("B"), wide("M")];
    const first = planGridReorder(specs, 2, "B", "M").order;

    for (let step = 0; step < 20; step += 1) {
      expect(planGridReorder(specs, 2, "B", "M").order).toEqual(first);
    }
  });
});
