import { packCardGrid, type CardSpec, type PackedCard } from "./cards";

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

/**
 * `packCardGrid`, in the shape this module's callers already expect.
 *
 * Derived rather than recomputed: this used to walk the cards a second time to
 * rebuild the rows, which meant the renderer's rows and the reorder resolver's
 * rows were two implementations of one rule.
 */
export function layoutCardGrid(
  specs: readonly CardSpec[],
  columns: number,
): CardGridLayout {
  const packed = packCardGrid(specs, columns);
  const placement = (card: PackedCard): CardPlacement => ({
    spec: card.spec,
    requestedColumns: card.requestedColumns,
    columns: card.renderedColumns,
    rowIndex: card.rowIndex,
    grewToFill: card.grewToFill,
  });
  const items = packed.cards.map(placement);
  const byId = new Map(items.map((item) => [item.spec.id, item]));

  return {
    columns: packed.columns,
    rows: packed.rows.map((row) => ({
      index: row.index,
      // The same objects the layout reports, so a caller cannot be handed two
      // different placements for one card.
      items: row.cards.flatMap((card) => {
        const item = byId.get(card.spec.id);
        return item ? [item] : [];
      }),
      requestedColumns: row.requestedColumns,
      renderedColumns: row.renderedColumns,
      remainingColumns: row.remainingColumns,
    })),
    items,
    byId,
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

/*
 * There was a `cardGridCells` here, which said which cell each card lands in so
 * a drag could translate the cards into those cells and draw the candidate
 * arrangement itself. It has gone, along with the preview that used it.
 *
 * Predicting the arrangement can only ever be half right. Cells give position,
 * and this grid also changes *widths*: the packer widens a card to close a row's
 * hole, so a reorder can take a card from two columns to one. A translated card
 * keeps its old width and lands on its neighbour — which was the overlap on
 * screen — and there is no fixing that from here, because a card's own body
 * scales its type and its charts to its width. Any predicted geometry is a second
 * layout engine to keep in step with CSS.
 *
 * So the caller renders the candidate order and lets the browser lay it out. What
 * this file still owes it is the *order* — `planGridReorder` — and nothing about
 * pixels.
 */

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
