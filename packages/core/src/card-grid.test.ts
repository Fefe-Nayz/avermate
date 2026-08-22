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
  recipe: CardSpec["recipe"] = display === "value" || display === "gauge"
    ? "value"
    : "bar",
): CardSpec {
  return {
    id,
    metric: "average",
    target: { kind: "general", referenceId: null },
    display,
    recipe,
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
/** Three quarters: the width no run of halves or wholes can add up to. */
const three = (id: string) => card(id, 3, "value");

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
          const plan = planGridReorder(specs, columns, activeId, overId);
          const result = plan.order;

          // A permutation, every time.
          expect([...result].sort()).toEqual([...ids].sort());
          expect(new Set(result).size).toBe(result.length);

          // Everything the gesture did not name keeps its relative order — and
          // the names are the active card plus whatever it traded places with,
          // which the plan reports because an exchange is the one outcome that
          // moves more than the card being dragged.
          const moved = new Set([activeId, ...(plan.exchanged ?? [])]);
          const untouched = (list: readonly string[]) =>
            list.filter((id) => !moved.has(id));
          expect(untouched(result)).toEqual(untouched(ids));

          // A one-for-one exchange additionally leaves every row totalling exactly
          // what it totalled, which is why it can never widen or narrow a card:
          // two equal numbers swapping places leaves the width sequence the packer
          // reads identical. One card for *several* keeps the two touched rows'
          // totals but shifts every card between them by the difference in count,
          // so a ragged row in between may re-break — see `planGridReorder`.
          if (plan.exchanged?.length === 1) {
            const totals = (order: readonly string[]) =>
              layoutCardGrid(
                order.map((id) => specs.find((spec) => spec.id === id)!),
                columns,
              ).rows.map((row) => row.requestedColumns);
            expect(totals(result)).toEqual(totals(ids));
          }

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

  it("shifts a wide card a row without dragging it twice", () => {
    // The dashboard as it ships on four columns, and the gesture that had no
    // answer: move the wide `average` down a row, or `ranking` up one.
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

    const moved = resolveGridReorder(specs, 4, "average", "ranking");
    expect(moved).toEqual([
      "ranking",
      "latest",
      "weakest",
      "strongest",
      "pass",
      "average",
    ]);

    // The two rows keep their exact shapes; the wide cards have exchanged them.
    // Insertion instead gave `[… ranking average]`, putting both wide cards side
    // by side on one row — neither of them where the pointer was.
    const after = moved.map((id) => specs.find((spec) => spec.id === id)!);
    expect(rows(after, 4)).toEqual([
      ["ranking", "latest", "weakest"],
      ["strongest", "pass", "average"],
    ]);
    // The *widths* are untouched, column for column — which is the property that
    // makes the swap safe rather than merely desirable.
    expect(layoutCards(after, 4).map((item) => item.columns)).toEqual(
      layoutCards(specs, 4).map((item) => item.columns),
    );

    // And it reads the same from either end of the gesture.
    expect(resolveGridReorder(specs, 4, "ranking", "average")).toEqual(moved);
  });

  it("trades one wide card for the two narrow ones that add up to it", () => {
    // The partner does not have to be a single card. A full-width card dropped on
    // a row of two half-width ones is worth exactly that pair, and trading it for
    // the pair is what the gesture means — the same answer the row-atomic
    // insertion used to reach, now for a reason that says which cards moved.
    const specs = [wide("M"), small("A"), small("B")];
    expect(rows(specs, 4)).toEqual([["M"], ["A", "B"]]);

    for (const target of ["A", "B"]) {
      const plan = planGridReorder(specs, 4, "M", target);
      expect(plan.order, target).toEqual(["A", "B", "M"]);
      expect(plan.exchanged, target).toEqual(["A", "B"]);
    }
  });

  it("takes as much of the row as it needs, starting where it was aimed", () => {
    // A half-width card onto a full row of quarters — the case that started this:
    // a card two columns wide is worth two cards one column wide.
    const specs = [
      small("M"),
      quarter("a"),
      quarter("b"),
      quarter("p"),
      quarter("q"),
      quarter("r"),
      quarter("s"),
    ];
    expect(rows(specs, 4)).toEqual([
      ["M", "a", "b"],
      ["p", "q", "r", "s"],
    ]);

    // Aimed at `p`: it lands with its leading edge there and takes `q` with it.
    const forward = planGridReorder(specs, 4, "M", "p");
    expect(forward.exchanged).toEqual(["p", "q"]);
    expect(forward.order).toEqual(["p", "q", "a", "b", "M", "r", "s"]);

    // Aimed at `q`, one along: the run moves along with the aim.
    expect(planGridReorder(specs, 4, "M", "q").exchanged).toEqual(["q", "r"]);

    // Aimed at `s`, the last: nothing lies to its right, so the run reaches back
    // and the card lands with its *trailing* edge on what was pointed at, rather
    // than the gesture being refused.
    expect(planGridReorder(specs, 4, "M", "s").exchanged).toEqual(["r", "s"]);
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

  it("never splits a pair the dragged card is worth", () => {
    // The move a flat sortable gets wrong. Dropping the full-width card onto the
    // left half previews `[A, M, B]` — A widened into M's place, B alone below —
    // while the drop is `[A, B, M]`. The two halves are together worth exactly what
    // the dragged card is, so the answer is that the three of them trade rows.
    const plan = planGridReorder(specs, 2, "M", "A");

    expect(plan.order).toEqual(["A", "B", "M"]);
    expect(plan.exchanged).toEqual(["A", "B"]);
  });

  it("answers the same from either half of that row", () => {
    // Both halves mean the pair, which is the rule this exists to make visible.
    const left = planGridReorder(specs, 2, "M", "A");
    const right = planGridReorder(specs, 2, "M", "B");

    expect(right.order).toEqual(left.order);
    expect(right.exchanged).toEqual(left.exchanged);
  });

  it("trades the same way coming up as going down", () => {
    const fromBelow = [small("A"), small("B"), wide("M")];
    const plan = planGridReorder(fromBelow, 2, "M", "B");

    expect(plan.order).toEqual(["M", "A", "B"]);
    expect(plan.exchanged).toEqual(["A", "B"]);
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

describe("the plan says which of the two things it did", () => {
  /**
   * Both outcomes describe themselves, and a caller that draws an affordance needs
   * to know which it got. What it must *not* do is re-plan against what the plan
   * reports — the drag learned that the hard way and stopped.
   *
   * `insertion.anchorId` was once fed back as the drag's target, so that dnd-kit's
   * own sorting strategy would preview `arrayMove` onto it and land on the order
   * the drop produced. That mechanism is gone: the grid renders the candidate order
   * itself and no strategy draws anything. Feeding the anchor back was left behind,
   * and it is worse than useless now that a card can *trade* with a run of the
   * destination row — the row-end the anchor names may have a trade partner the
   * aimed card had not, so planning again from the anchor could reach a different
   * arrangement than the plan that produced it.
   */
  it("reports the row and the edge when it inserts against a whole row", () => {
    // A three-quarter card over a row of two halves: no stretch of that row is
    // worth three columns — one is two, both are four — so there is nothing to
    // trade for and it lands against the row instead.
    const specs = [three("M"), small("A"), small("B")];
    expect(rows(specs, 4)).toEqual([["M"], ["A", "B"]]);

    const plan = planGridReorder(specs, 4, "M", "A");

    expect(plan.exchanged).toBeNull();
    expect(plan.insertion).toEqual({
      rowIndex: 1,
      edge: "after",
      anchorId: "B",
    });
    // Never between the row's members, whichever of them was pointed at.
    for (const over of ["A", "B"]) {
      expect(planGridReorder(specs, 4, "M", over).order, over).toEqual(
        plan.order,
      );
    }
  });

  it("reports the cards it traded with when it exchanges", () => {
    const specs = [wide("M"), small("A"), small("B")];
    const plan = planGridReorder(specs, 2, "M", "A");

    expect(plan.insertion).toBeNull();
    expect(plan.exchanged).toEqual(["A", "B"]);
  });

  it("never reports both", () => {
    const specs = [
      wide("M"),
      small("A"),
      small("B"),
      quarter("c"),
      small("N"),
      quarter("d"),
    ];
    const ids = specs.map((spec) => spec.id);

    for (const columns of [1, 2, 3, 4]) {
      for (const activeId of ids) {
        for (const overId of ids) {
          const plan = planGridReorder(specs, columns, activeId, overId);
          expect(
            plan.insertion === null || plan.exchanged === null,
            `${columns} ${activeId}->${overId}`,
          ).toBe(true);
        }
      }
    }
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

  it("changes only the occupancy when two equals trade rows", () => {
    // The boundary of the claim this suite makes. Widths follow from the order, so
    // *most* reorders change them — and there is exactly one shape of reorder that
    // cannot, because the packer reads only the sequence of requested widths and
    // exchanging two equal ones leaves that sequence identical.
    //
    // This test used to assert the opposite and was wrong to. It dropped the wide
    // `average` onto the wide `ranking` and expected the two to end up side by
    // side on one row, with four quarter cards above them — an arrangement neither
    // end of the gesture pointed at, and the reason a wide card could not be
    // shifted a row at all. See `planGridReorder`'s swap rule.
    const specs = [
      small("average"),
      quarter("latest"),
      quarter("weakest"),
      quarter("strongest"),
      quarter("pass"),
      small("ranking"),
    ];

    const layout = reordered(specs, 4, "average", "ranking");

    expect(
      layout.rows.map((row) => row.items.map((item) => item.spec.id)),
    ).toEqual([
      ["ranking", "latest", "weakest"],
      ["strongest", "pass", "average"],
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
