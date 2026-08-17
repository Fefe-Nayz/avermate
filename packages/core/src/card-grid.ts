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
 * The stretch of a row the active card can trade places with.
 *
 * Not a single card: a half-width card is worth two quarter-width ones, and a
 * person dropping it onto a pair of them means exactly that. What is needed is a
 * *contiguous run of one row*, containing the card under the pointer, whose
 * requested widths add up to the active card's own — one card of the same width,
 * or two, or four, whatever the row is made of.
 *
 * Searched from the target outwards, and that order is the whole of the rule:
 *
 * - **Starting at the target**, so the card lands with its leading edge on the
 *   card that was pointed at. That is where a person aiming expects it.
 * - **Then reaching back**, one card at a time, for a target too near the end of
 *   its row to have enough room to its right. Reaching back the least is
 *   preferred, so the run stays as centred on the target as the row allows.
 *
 * The sums are positive, so at most one run can start at a given card — there is
 * never a choice to arbitrate, only the first start that works.
 */
function swapRun(
  items: readonly CardPlacement[],
  at: number,
  width: number,
): { start: number; end: number } | null {
  for (let start = at; start >= 0; start -= 1) {
    let sum = 0;
    for (let end = start; end < items.length; end += 1) {
      sum += (items[end] as CardPlacement).requestedColumns;
      if (sum > width) break;
      // `end >= at` keeps the card that was pointed at inside the run; without
      // it, reaching back could find a run that stops short of the target and
      // exchange with cards nobody aimed at.
      if (sum === width && end >= at) return { start, end };
    }
  }
  return null;
}

/**
 * The active card and a run of another row trade places.
 *
 * One card goes where the run was and the run goes where the card was, each
 * keeping its internal order. `from` is never inside `[runFrom, runTo]` — the run
 * is in another row — so the two substitutions cannot interfere.
 */
function exchange(
  ids: readonly string[],
  from: number,
  runFrom: number,
  runTo: number,
): string[] {
  const run = ids.slice(runFrom, runTo + 1);
  const active = ids[from] as string;
  const next: string[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    if (index === from) next.push(...run);
    else if (index === runFrom) next.push(active);
    else if (index > runFrom && index <= runTo) continue;
    else next.push(ids[index] as string);
  }
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
  /**
   * The cards the active one traded places with, or `null` for an insertion.
   *
   * Reported because an exchange is the one outcome here that moves more than the
   * card being dragged, and a caller cannot work out which cards those were from
   * the order alone. Its first use is to keep the invariant honest — "nothing the
   * gesture did not name is disturbed" has to name these too — and a drag that
   * wanted to outline what is about to move has it to hand.
   */
  exchanged: string[] | null;
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
    return { order: ids, insertion: null, exchanged: null };
  }

  const layout = layoutCardGrid(specs, columns);
  const active = layout.byId.get(activeId);
  const target = layout.byId.get(overId);
  if (!active || !target) {
    return { order: moveTo(ids, from, over), insertion: null, exchanged: null };
  }

  const row = layout.rows[target.rowIndex];
  const sameRow = active.rowIndex === target.rowIndex;

  /**
   * Crossing rows onto cards that add up to this one is an *exchange*, not a move.
   *
   * The reported symptom was that a wide card could not be shifted one row up or
   * down in a single gesture — only diagonally, and then along its new row. Here
   * is why. Take the dashboard as it ships on four columns:
   *
   *     [average(2) latest(1) weakest(1)]        order: average latest weakest
   *     [strongest(1) pass(1) ranking(2)]               strongest pass ranking
   *
   * Drag `average` down onto `ranking` and an insertion gives
   * `[latest weakest strongest pass ranking average]`, which repacks as a row of
   * four small cards over `ranking` and `average` *side by side*. Neither wide card
   * went where it was pointed. No pointer position produces the arrangement being
   * asked for either, because an insertion can only ever insert.
   *
   * Exchanging them gives `[ranking latest weakest strongest pass average]` — the
   * two rows keep their shapes and the two wide cards have traded them.
   *
   * And the partner need not be one card. A half-width card is worth two
   * quarter-width ones, so dropping it onto a pair of them trades it for the pair;
   * `swapRun` finds whatever contiguous stretch of the target's row adds up to it.
   *
   * How much of the layout survives depends on how many cards the partner is, and
   * it is worth being exact about it, because the packer reads nothing but the
   * sequence of requested widths:
   *
   * - **One for one.** The sequence is *identical* — two equal numbers have swapped
   *   places. No row boundary can move, every row keeps the spare columns it had,
   *   and no card is widened or narrowed. Only the occupancy changes.
   * - **One for several.** The two rows that were touched keep their totals, since
   *   each site gave up and took back the same number of columns. Rows before the
   *   first site and after the second keep their exact composition too. Rows
   *   *between* the two sites can re-break: every card there shifts by the
   *   difference in card count, so a ragged row that had a hole may find a
   *   different neighbour to fill it. `[M‖A B‖c‖N‖d]` on two columns is the small
   *   case — trading `N` for `A B` lets `c` pair up with `A` and closes the row `c`
   *   had to itself.
   *
   * That second freedom is the same one every insertion already has, and it is the
   * price of the gesture being possible at all.
   *
   * Two conditions bound it, each excluding a case where something else is meant:
   *
   * - **Across rows.** Inside one row an insertion already *is* the exchange for
   *   two adjacent cards, and reads as a list — which is what a single row is.
   * - **The row is full.** A row with a hole beside the target can take the card
   *   *as well*, and that is more of what was asked for than evicting cards that
   *   were not in the way. Dropping a quarter card onto a lone half-width one joins
   *   it and narrows it; it does not send it to the other end of the dashboard.
   *
   * There is no third condition about widths. A run that adds up exists or it does
   * not, and when it does not — a half-width card aimed at a row of thirds — the
   * insertion below is still the honest answer.
   */
  const hasRoom = (row?.remainingColumns ?? 0) >= active.requestedColumns;
  const run =
    sameRow || hasRoom || !row
      ? null
      : swapRun(
          row.items,
          row.items.findIndex((item) => item.spec.id === overId),
          active.requestedColumns,
        );
  if (run) {
    const runFrom = ids.indexOf(
      (row?.items[run.start] as CardPlacement).spec.id,
    );
    const runTo = runFrom + (run.end - run.start);
    return {
      order: exchange(ids, from, runFrom, runTo),
      insertion: null,
      exchanged: ids.slice(runFrom, runTo + 1),
    };
  }

  const joins = active.requestedColumns <= target.requestedColumns || hasRoom;

  if (sameRow || !row || joins) {
    return { order: moveTo(ids, from, over), insertion: null, exchanged: null };
  }

  const after = from < over;
  // SAFETY: a row is only recorded once a card has been placed in it, so
  // `items` is never empty and both of its ends are real placements.
  const anchor = after
    ? (row.items[row.items.length - 1] as CardPlacement).spec.id
    : (row.items[0] as CardPlacement).spec.id;
  const to = ids.indexOf(anchor);
  if (to < 0)
    return { order: moveTo(ids, from, over), insertion: null, exchanged: null };

  return {
    order: moveTo(ids, from, to),
    insertion: {
      rowIndex: target.rowIndex,
      edge: after ? "after" : "before",
      anchorId: anchor,
    },
    exchanged: null,
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
