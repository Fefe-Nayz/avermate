import { describe, expect, test } from "bun:test";
import {
  gridKeyboardTarget,
  layoutCardGrid,
  planGridKeyboardMove,
} from "./card-grid";
import type { CardSpec } from "./cards";

/**
 * Moving a card without a pointer.
 *
 * The audit asks that the keyboard and the pointer produce the same intention, and the
 * grid already has a vocabulary for one: a target card, which `planGridReorder` reads as
 * an insertion or an exchange. So the keyboard's whole job is choosing that card, and the
 * step lands wherever the equivalent drop would — including the row-atomic exchange, which
 * is the case a flat sortable's own keyboard handling gets wrong.
 *
 * The rows below are the dashboard's own shape on four columns:
 *
 *     [ average(2)    latest(1)  weakest(1) ]
 *     [ strongest(1)  pass(1)    ranking(2) ]
 */
const spec = (id: string, span: CardSpec["span"]): CardSpec => ({
  id,
  metric: "average",
  target: { kind: "general", referenceId: null },
  display: "value",
  // A reading, so the layout policy is the value recipe's and a card of one column stays
  // one column: this is about where a step *lands*, not about how wide a chart wants to be.
  recipe: "value",
  span,
  title: id,
  accent: null,
  goalId: null,
  sortOrder: 0,
  hidden: false,
});

const dashboard: CardSpec[] = [
  spec("average", 2),
  spec("latest", 1),
  spec("weakest", 1),
  spec("strongest", 1),
  spec("pass", 1),
  spec("ranking", 2),
];

describe("choosing where a keyboard step lands", () => {
  test("walks the canonical order sideways", () => {
    expect(gridKeyboardTarget(dashboard, 4, "latest", "right")).toBe("weakest");
    expect(gridKeyboardTarget(dashboard, 4, "latest", "left")).toBe("average");
  });

  test("stops at the ends rather than wrapping", () => {
    // Wrapping would move the first card to the last place on a single keypress, which is
    // a reorder nobody asked for and cannot be undone by pressing the other way.
    expect(gridKeyboardTarget(dashboard, 4, "average", "left")).toBeNull();
    expect(gridKeyboardTarget(dashboard, 4, "ranking", "right")).toBeNull();
  });

  test("steps down onto the card that covers the same columns", () => {
    // `average` occupies columns one and two, so below it is `strongest`, not the card
    // that happens to share its index.
    expect(gridKeyboardTarget(dashboard, 4, "average", "down")).toBe(
      "strongest",
    );
    // `weakest` is the fourth column; below it is the wide `ranking`.
    expect(gridKeyboardTarget(dashboard, 4, "weakest", "down")).toBe("ranking");
  });

  test("steps up by column, which is not the mirror of stepping down", () => {
    // `weakest` sits in the fourth column and steps down onto `ranking`, which spans the
    // third and fourth — but `ranking` *starts* in the third, so stepping up from it lands
    // on `latest`. Not a bug and not a symmetry: a wide card covers several columns and
    // can only be at one of them.
    expect(gridKeyboardTarget(dashboard, 4, "weakest", "down")).toBe("ranking");
    expect(gridKeyboardTarget(dashboard, 4, "ranking", "up")).toBe("latest");
    expect(gridKeyboardTarget(dashboard, 4, "strongest", "up")).toBe("average");
  });

  test("has nowhere to go off the top or the bottom", () => {
    expect(gridKeyboardTarget(dashboard, 4, "average", "up")).toBeNull();
    expect(gridKeyboardTarget(dashboard, 4, "ranking", "down")).toBeNull();
  });

  test("says nothing about a card that is not there", () => {
    expect(gridKeyboardTarget(dashboard, 4, "nobody", "down")).toBeNull();
  });
});

describe("what a keyboard step produces", () => {
  test("reaches the exchange a drag reaches, not the insertion a list would", () => {
    const plan = planGridKeyboardMove(dashboard, 4, "average", "down");

    /**
     * `average` is two columns wide and lands on `strongest`, so it trades with the run
     * that adds up to its own width — `strongest` and `pass` — and the two rows keep their
     * shapes: four single cards, then the two wide ones. An `arrayMove` onto the same
     * target gives `[latest weakest strongest average pass ranking]`, which repacks into
     * something nobody aimed at.
     */
    expect(plan.order).toEqual([
      "strongest",
      "pass",
      "latest",
      "weakest",
      "average",
      "ranking",
    ]);
    expect(plan.exchanged).not.toBeNull();
    // And the card really did move down a row.
    const after = layoutCardGrid(
      plan.order.flatMap((id) => {
        const found = dashboard.find((item) => item.id === id);
        return found ? [found] : [];
      }),
      4,
    );
    expect(after.byId.get("average")?.rowIndex).toBe(1);
  });

  test("keeps every card, exactly once", () => {
    for (const direction of ["left", "right", "up", "down"] as const) {
      for (const card of dashboard) {
        const plan = planGridKeyboardMove(dashboard, 4, card.id, direction);

        expect([...plan.order].sort()).toEqual(
          dashboard.map((item) => item.id).sort(),
        );
      }
    }
  });

  test("leaves the order alone where there is nowhere to go", () => {
    const plan = planGridKeyboardMove(dashboard, 4, "average", "up");

    expect(plan.order).toEqual(dashboard.map((item) => item.id));
    expect(plan.insertion).toBeNull();
    expect(plan.exchanged).toBeNull();
  });

  test("comes back to the row it left", () => {
    const specsOf = (order: readonly string[]) =>
      order.flatMap((id) => {
        const found = dashboard.find((item) => item.id === id);
        return found ? [found] : [];
      });
    const down = specsOf(
      planGridKeyboardMove(dashboard, 4, "latest", "down").order,
    );
    const back = specsOf(planGridKeyboardMove(down, 4, "latest", "up").order);

    expect(layoutCardGrid(down, 4).byId.get("latest")?.rowIndex).toBe(1);
    expect(layoutCardGrid(back, 4).byId.get("latest")?.rowIndex).toBe(0);
    /**
     * The *row*, and deliberately not the exact order.
     *
     * Down and up is not the identity, and asserting that it were would be asserting
     * something false: moving a card out of a row closes the row up, so stepping back into
     * it arrives at whichever card now covers that column. A reorder repacks — that is the
     * whole premise of the grid — and the honest invariant is that the card goes back where
     * it came from, not that the world is unchanged around it.
     */
    expect(back.map((item) => item.id).sort()).toEqual(
      dashboard.map((item) => item.id).sort(),
    );
  });

  test("agrees with the packer about which row a card is in", () => {
    // The step is chosen from the layout, so it cannot disagree with what is drawn: the
    // policy is a pure function of the definitions and never of the current result.
    const layout = layoutCardGrid(dashboard, 4);

    expect(layout.byId.get("average")?.rowIndex).toBe(0);
    expect(layout.byId.get("ranking")?.rowIndex).toBe(1);
  });
});
