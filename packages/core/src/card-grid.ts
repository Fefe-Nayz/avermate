import { cardColumns, layoutCards, type CardSpec } from "./cards";

/**
 * The grid, as rows — and reordering expressed against them.
 *
 * `layoutCards` already packs cards correctly. What was missing is that it threw
 * away *how* it packed them: callers received a flat list of widths and had no
 * way to know which cards shared a row. Drag-and-drop then reordered a flat
 * list of ids with `arrayMove`, targeting whichever single card the pointer
 * happened to be nearest.
 *
 * That is the whole bug. Take a full-width average card `M` above a row of two
 * small cards `A` and `B`, and drag `M` down over that row. On a two-column
 * grid the stored order is `[M, A, B]`, and the result depends on which of the
 * two small cards the pointer favoured:
 *
 *     [M, A, B]  →  M=2  A=1  B=1     the arrangement you had
 *     [A, M, B]  →  A=2  M=2  B=2     what dropping onto A produced
 *     [A, B, M]  →  A=1  B=1  M=2     what dropping onto the row means
 *
 * Landing on `A` splits the pair: `A` can no longer sit beside `M`, so its row
 * is closed and the packer widens it to fill the gap — and `B`, now alone at the
 * end, is widened too. A small card visibly takes the big card's place. The
 * packer is not at fault; it is faithfully drawing a bad order. The same happens
 * on a four-column grid, so this was never a mobile-only quirk.
 *
 * The fix is a translation layer between a two-dimensional gesture and the
 * one-dimensional canonical order: rows the caller can see, and a resolver that
 * treats a row the active card cannot join as a single destination.
 */

export interface CardPlacement {
  spec: CardSpec;
  /** Width before the row's spare columns were handed out. */
  requestedColumns: number;
  /** Width actually drawn. */
  columns: number;
  rowIndex: number;
  /** Whether packing widened this card to close a gap. */
  grewToFill: boolean;
}

export interface CardGridRow {
  index: number;
  items: CardPlacement[];
  /** Columns the row's cards asked for, before filling. */
  requestedColumns: number;
  /** Columns the row draws. */
  renderedColumns: number;
  /**
   * Room a further card could still ask for. Measured against the *requested*
   * widths, not the drawn ones: a row whose hole was closed by widening a card
   * still had that hole, and a card that would have fitted it still fits.
   */
  remainingColumns: number;
}

export interface CardGridLayout {
  columns: number;
  rows: CardGridRow[];
  items: CardPlacement[];
  byId: Map<string, CardPlacement>;
}

/** `layoutCards`, with the row structure it already computed kept. */
export function layoutCardGrid(
  specs: readonly CardSpec[],
  columns: number,
): CardGridLayout {
  const width = Math.max(1, Math.floor(columns));
  const drawn = layoutCards(specs, width);

  const items: CardPlacement[] = [];
  const rows: CardGridRow[] = [];
  let current: CardPlacement[] = [];
  let requestedUsed = 0;

  const closeRow = () => {
    if (current.length === 0) return;
    const requested = requestedUsed;
    rows.push({
      index: rows.length,
      items: current,
      requestedColumns: requested,
      renderedColumns: current.reduce((total, item) => total + item.columns, 0),
      remainingColumns: Math.max(0, width - requested),
    });
    current = [];
    requestedUsed = 0;
  };

  // The same walk `layoutCards` performs, so the rows recorded here are exactly
  // the rows it drew. Deriving them a second way is how the two would drift.
  for (const item of drawn) {
    const requestedColumns = cardColumns(item.spec, width);
    if (requestedUsed > 0 && requestedUsed + requestedColumns > width) {
      closeRow();
    }
    const placement: CardPlacement = {
      spec: item.spec,
      requestedColumns,
      columns: item.columns,
      rowIndex: rows.length,
      grewToFill: item.columns > requestedColumns,
    };
    current.push(placement);
    items.push(placement);
    requestedUsed += requestedColumns;
    if (requestedUsed >= width) closeRow();
  }
  closeRow();

  return {
    columns: width,
    rows,
    items,
    byId: new Map(items.map((item) => [item.spec.id, item])),
  };
}

/** Standard sortable move: pull the card out, put it back at `to`. */
function moveTo(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * The order a drop should produce, in canonical ids.
 *
 * `overId` is the card the pointer settled on, which is all a sortable context
 * can offer. Two rules, in this order:
 *
 * 1. **Inside one row, the exact card is honoured.** There the horizontal
 *    choice is a real one — swapping the two cards of a pair means the pair, not
 *    the row below it.
 * 2. **Crossing to another row, a row the card cannot join is one
 *    destination.** The card lands before all of it or after all of it, never
 *    between its members. Which side follows from where it came.
 *
 * "Cannot join" is not "the row is full": a card that is no wider than the one
 * it is displacing can always take that place. Measuring only the row's spare
 * columns made every move in a uniform grid row-atomic, because a full row of
 * equal cards has no spare columns — so dragging one of four identical cards
 * anywhere threw it below a whole row.
 *
 * The rows are read from the layout **as displayed**, with the active card still
 * in place. Computing them with it removed describes a grid nobody is looking
 * at: lift one card out of a uniform 2×2 and its two neighbours close up into a
 * row that is not on screen, and every decision taken against that phantom row
 * is wrong. That was the cause of the reordering that would not settle.
 */
export interface GridReorderPlan {
  /** The canonical order the drop should produce. */
  order: string[];
  /**
   * Where the card lands when it lands against a *whole row* rather than
   * swapping with one card — and `null` when it is an ordinary swap.
   *
   * This is the difference a flat sortable cannot see, and it is why the drag
   * needs its own affordance. A sortable previews `arrayMove` onto the single
   * card under the pointer, which for a row-atomic move is the very arrangement
   * the rule above exists to refuse. Drag a full-width card over the left half
   * of a two-card row and the preview shows `[A, M, B]` — A widened into the
   * dragged card's place, B alone underneath — while the drop produces
   * `[A, B, M]`. Both are then correct about different things, and the person
   * dragging sees the pair apparently swap on release.
   *
   * The way out is that this answer is *itself* a flat move — to `anchorId`, the
   * far card of the destination row. A caller that reports that card as the drag
   * target instead of the one under the pointer gets a sortable whose own
   * preview computes the order the drop will produce, with no second layout
   * mechanism and nothing to keep in step.
   */
  insertion: {
    rowIndex: number;
    edge: "before" | "after";
    /** The card whose index the move targets. Reporting it makes preview truth. */
    anchorId: string;
  } | null;
}

/** The plan a drop would carry out, and how it should be shown while dragging. */
export function planGridReorder(
  specs: readonly CardSpec[],
  columns: number,
  activeId: string,
  overId: string,
): GridReorderPlan {
  const ids = specs.map((spec) => spec.id);
  const from = ids.indexOf(activeId);
  const over = ids.indexOf(overId);
  if (from < 0 || over < 0 || from === over) {
    return { order: ids, insertion: null };
  }

  const layout = layoutCardGrid(specs, columns);
  const active = layout.byId.get(activeId);
  const target = layout.byId.get(overId);
  if (!active || !target) {
    return { order: moveTo(ids, from, over), insertion: null };
  }

  const row = layout.rows[target.rowIndex];
  const sameRow = active.rowIndex === target.rowIndex;
  const joins =
    active.requestedColumns <= target.requestedColumns ||
    (row?.remainingColumns ?? 0) >= active.requestedColumns;

  if (sameRow || !row || joins) {
    return { order: moveTo(ids, from, over), insertion: null };
  }

  const after = from < over;
  // SAFETY: a row is only recorded once a card has been placed in it, so
  // `items` is never empty and both of its ends are real placements.
  const anchor = after
    ? (row.items[row.items.length - 1] as CardPlacement).spec.id
    : (row.items[0] as CardPlacement).spec.id;
  const to = ids.indexOf(anchor);
  if (to < 0) return { order: moveTo(ids, from, over), insertion: null };

  return {
    order: moveTo(ids, from, to),
    insertion: {
      rowIndex: target.rowIndex,
      edge: after ? "after" : "before",
      anchorId: anchor,
    },
  };
}

export interface CardGridCell {
  rowIndex: number;
  /** First column the card occupies, zero-based. */
  columnStart: number;
  /** Columns it draws — the filled width, which is what CSS places. */
  columnSpan: number;
}

/**
 * Where each card sits in the grid, as cells rather than as a sequence.
 *
 * A sortable can only offer a preview by moving rectangles around, and it
 * assumes the rectangle a card lands in is the rectangle another card vacated.
 * That holds for a uniform grid. Ours *repacks*: change the order and the rows
 * are composed differently, so the cells in the new arrangement are not a
 * permutation of the old ones. Anything that wants to draw the new arrangement
 * has to be told which cell each card lands in, which is what this returns.
 *
 * Columns are cumulative over the *drawn* widths, because that is what CSS grid
 * auto-placement does — a card widened to close a gap pushes its neighbours
 * along by the width it actually got, not the one it asked for.
 */
export function cardGridCells(
  specs: readonly CardSpec[],
  columns: number,
): Map<string, CardGridCell> {
  const cells = new Map<string, CardGridCell>();
  for (const row of layoutCardGrid(specs, columns).rows) {
    let columnStart = 0;
    for (const item of row.items) {
      cells.set(item.spec.id, {
        rowIndex: row.index,
        columnStart,
        columnSpan: item.columns,
      });
      columnStart += item.columns;
    }
  }
  return cells;
}

/** The order a drop should produce, for callers that only need the sequence. */
export function resolveGridReorder(
  specs: readonly CardSpec[],
  columns: number,
  activeId: string,
  overId: string,
): string[] {
  return planGridReorder(specs, columns, activeId, overId).order;
}

/** The ids in canonical order, for callers that only need the sequence. */
export function cardGridOrder(specs: readonly CardSpec[]): string[] {
  return specs.map((spec) => spec.id);
}
