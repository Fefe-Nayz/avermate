import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The reorder maths, tested straight out of the component's source.
 *
 * `sortable-list.tsx` imports react-native, which bun cannot parse, and the
 * pure functions should not leave the component just to become importable. So
 * the block between the extraction markers is lifted out as text, transpiled
 * and evaluated — the same source-as-text trick i18n.test.ts uses for the
 * catalogue. The meta test below fails loudly if the markers ever drift.
 */

interface ItemLayout {
  y: number;
  h: number;
}

interface ReorderMath {
  moveItem: <T>(items: readonly T[], from: number, to: number) => T[];
  listGap: (layouts: readonly ItemLayout[]) => number;
  projectIndex: (
    layouts: readonly ItemLayout[],
    from: number,
    translation: number,
  ) => number;
  siblingOffset: (
    index: number,
    from: number,
    target: number,
    span: number,
  ) => number;
  settleOffset: (
    layouts: readonly ItemLayout[],
    from: number,
    target: number,
  ) => number;
}

const START_MARKER = "// --- pure reorder math";
const END_MARKER = "// --- end pure reorder math";

function extractMath(): ReorderMath {
  const source = readFileSync(
    join(import.meta.dir, "sortable-list.tsx"),
    "utf8",
  );
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      "The pure reorder math markers are missing from sortable-list.tsx",
    );
  }
  const block = source
    .slice(source.indexOf("\n", start) + 1, end)
    .replaceAll(/\bexport /g, "");
  const transpiled = new Bun.Transpiler({ loader: "ts" }).transformSync(block);
  return new Function(
    `${transpiled}\nreturn { moveItem, listGap, projectIndex, siblingOffset, settleOffset };`,
  )() as ReorderMath;
}

const math = extractMath();

/** Stack rows of the given heights with a uniform gap, like the container. */
function rows(heights: number[], gap: number): ItemLayout[] {
  const layouts: ItemLayout[] = [];
  let y = 0;
  for (const h of heights) {
    layouts.push({ y, h });
    y += h + gap;
  }
  return layouts;
}

describe("extraction", () => {
  test("finds every function between the markers", () => {
    expect(typeof math.moveItem).toBe("function");
    expect(typeof math.listGap).toBe("function");
    expect(typeof math.projectIndex).toBe("function");
    expect(typeof math.siblingOffset).toBe("function");
    expect(typeof math.settleOffset).toBe("function");
  });
});

describe("moveItem", () => {
  test("moves an item forward", () => {
    expect(math.moveItem(["a", "b", "c", "d"], 0, 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  test("moves an item backward", () => {
    expect(math.moveItem(["a", "b", "c", "d"], 3, 1)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  test("keeps the array when from equals to", () => {
    expect(math.moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  test("never mutates its input", () => {
    const input = ["a", "b", "c"];
    math.moveItem(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("listGap", () => {
  test("recovers the gap from measured geometry", () => {
    expect(math.listGap(rows([80, 120, 60], 16))).toBe(16);
    expect(math.listGap(rows([48, 48], 0))).toBe(0);
  });

  test("is zero when fewer than two rows exist", () => {
    expect(math.listGap([])).toBe(0);
    expect(math.listGap([{ y: 0, h: 100 }])).toBe(0);
  });
});

describe("projectIndex", () => {
  // Equal rows: 48 high, 16 gap — each slot spans 64 from centre to centre.
  const equal = rows([48, 48, 48, 48], 16);

  test("stays home without movement", () => {
    expect(math.projectIndex(equal, 1, 0)).toBe(1);
  });

  test("stays home below half a slot of travel", () => {
    expect(math.projectIndex(equal, 1, 31)).toBe(1);
    expect(math.projectIndex(equal, 1, -31)).toBe(1);
  });

  test("advances one slot past the next centre's midpoint", () => {
    expect(math.projectIndex(equal, 1, 33)).toBe(2);
    expect(math.projectIndex(equal, 1, -33)).toBe(0);
  });

  test("reaches across several slots", () => {
    expect(math.projectIndex(equal, 0, 3 * 64)).toBe(3);
  });

  test("clamps at both ends of the list", () => {
    expect(math.projectIndex(equal, 0, 10_000)).toBe(3);
    expect(math.projectIndex(equal, 3, -10_000)).toBe(0);
  });

  test("compares centres, so mixed heights project asymmetrically", () => {
    // Rows at y 0/96/216 with heights 80/104/40: centres 40, 148, 236.
    const mixed = rows([80, 104, 40], 16);
    // Dragging row 0 (centre 40) down: row 1's centre is 108 away, so 60
    // is still closest to home while 100 crosses to row 1.
    expect(math.projectIndex(mixed, 0, 54)).toBe(0);
    expect(math.projectIndex(mixed, 0, 100)).toBe(1);
    // Row 2's centre is 196 away from home.
    expect(math.projectIndex(mixed, 0, 160)).toBe(2);
  });

  test("returns from when the lifted row was never measured", () => {
    expect(math.projectIndex([], 2, 500)).toBe(2);
  });
});

describe("siblingOffset", () => {
  const span = 64;

  test("moves only the rows between from and target, downward drag", () => {
    // Dragging row 1 to row 3: rows 2 and 3 step up, the rest hold still.
    expect(math.siblingOffset(0, 1, 3, span)).toBe(0);
    expect(math.siblingOffset(1, 1, 3, span)).toBe(0);
    expect(math.siblingOffset(2, 1, 3, span)).toBe(-span);
    expect(math.siblingOffset(3, 1, 3, span)).toBe(-span);
    expect(math.siblingOffset(4, 1, 3, span)).toBe(0);
  });

  test("moves only the rows between target and from, upward drag", () => {
    // Dragging row 3 to row 1: rows 1 and 2 step down.
    expect(math.siblingOffset(0, 3, 1, span)).toBe(0);
    expect(math.siblingOffset(1, 3, 1, span)).toBe(span);
    expect(math.siblingOffset(2, 3, 1, span)).toBe(span);
    expect(math.siblingOffset(3, 3, 1, span)).toBe(0);
    expect(math.siblingOffset(4, 3, 1, span)).toBe(0);
  });

  test("moves nothing when the drag hovers over home", () => {
    for (const index of [0, 1, 2, 3]) {
      expect(math.siblingOffset(index, 2, 2, span)).toBe(0);
    }
  });

  test("moves nothing while no drag is running", () => {
    expect(math.siblingOffset(2, -1, -1, span)).toBe(0);
  });
});

describe("settleOffset", () => {
  test("is zero when the row goes home", () => {
    expect(math.settleOffset(rows([48, 48, 48], 16), 1, 1)).toBe(0);
  });

  test("is zero when the geometry is missing", () => {
    expect(math.settleOffset([], 0, 2)).toBe(0);
  });

  test("lands exactly where layout puts the row after the commit", () => {
    // The invariant the drop animation relies on: the settle translation must
    // equal the difference between the row's top before the reorder and its
    // top once the container lays the new order out.
    const heights = [80, 104, 40, 64, 48];
    for (const gap of [0, 16]) {
      const layouts = rows(heights, gap);
      for (let from = 0; from < heights.length; from += 1) {
        for (let target = 0; target < heights.length; target += 1) {
          const settled = math.settleOffset(layouts, from, target);
          const reordered = rows(math.moveItem(heights, from, target), gap);
          const landing = math
            .moveItem(
              heights.map((_, index) => index),
              from,
              target,
            )
            .indexOf(from);
          expect(settled).toBe(reordered[landing]!.y - layouts[from]!.y);
        }
      }
    }
  });
});
