import { describe, expect, test } from "bun:test"
import type { HierarchyNode } from "@avermate/core"
import {
  labelledTreemapTiles,
  TREEMAP_ROOT,
  treemapTiles,
} from "./card-treemap"

const node = (
  id: string,
  parentId: string | null,
  depth: number,
  value: number,
  leaf: boolean,
  kind: HierarchyNode["kind"] = "subject"
): HierarchyNode => ({ id, parentId, label: id, value, depth, leaf, kind })

/**
 * A treemap's areas are shares, and the two ways such a chart lies are counting a
 * branch as well as its children, and quietly dropping the part of the tree it did
 * not draw. Both are arithmetic, so both are testable here.
 */
const tree: HierarchyNode[] = [
  node("sciences", null, 0, 0.8, false, "category"),
  node("maths", "sciences", 1, 0.2, true),
  node("physique", "sciences", 1, 0.6, true),
  node("art", null, 0, 0.2, true),
]

describe("treemap tiles", () => {
  test("hangs everything from one root, because the mark insists on one", () => {
    // A year has several top-level subjects and the mark refuses more than one root
    // — measured: `treemap: multiple roots`. The root is synthetic and valueless, so
    // it is the sum of the year and is never a rectangle of its own.
    const tiles = treemapTiles(tree, 2)
    const roots = tiles.filter((tile) => tile.parentId === null)

    expect(roots).toHaveLength(1)
    expect(roots[0]?.id).toBe(TREEMAP_ROOT)
    expect(roots[0]?.value).toBeNull()
    expect(
      tiles.filter((tile) => tile.parentId === TREEMAP_ROOT).map((t) => t.id)
    ).toEqual(["sciences", "art"])
  })

  test("gives every leaf a parent row to hang from", () => {
    // The mark builds its hierarchy from the rows it is handed, so a leaf naming a
    // parent that is not among them is a hard error rather than a missing rectangle.
    const tiles = treemapTiles(tree, 2)
    const ids = new Set(tiles.map((tile) => tile.id))

    for (const tile of tiles) {
      if (tile.parentId === null) continue
      expect(ids.has(tile.parentId), `${tile.id} → ${tile.parentId}`).toBe(true)
    }
  })

  test("leaves the branch without a value of its own", () => {
    const tiles = treemapTiles(tree, 2)
    const branch = tiles.find((tile) => tile.id === "sciences")
    const leaf = tiles.find((tile) => tile.id === "maths")

    // Null, so the mark sums it from its children. A branch with both its own value
    // and children would count every nested subject twice.
    expect(branch?.value).toBeNull()
    // The mark still gets null, while the tooltip and accessible summary get the real
    // aggregate instead of claiming zero or saying nothing.
    expect(branch?.displayValue).toBeCloseTo(0.8, 10)
    expect(leaf?.value).toBeCloseTo(0.2, 10)
    expect(leaf?.displayValue).toBeCloseTo(0.2, 10)
  })

  test("the drawn values still sum to the whole", () => {
    const total = treemapTiles(tree, 2)
      .filter((tile) => tile.value !== null)
      .reduce((sum, tile) => sum + (tile.value ?? 0), 0)

    expect(total).toBeCloseTo(1, 10)
  })

  test("rolls a cut-off subtree into the deepest node it does draw", () => {
    const tiles = treemapTiles(tree, 1)

    // One level: Sciences becomes a rectangle carrying its whole subtree, and Art
    // keeps its own. Nothing is dropped, so the total is unchanged.
    expect(
      tiles
        .map((tile) => tile.id)
        .filter((id) => id !== TREEMAP_ROOT)
        .sort()
    ).toEqual(["art", "sciences"])
    expect(tiles.find((tile) => tile.id === "sciences")?.value).toBeCloseTo(
      0.8,
      10
    )
    expect(tiles.reduce((sum, tile) => sum + (tile.value ?? 0), 0)).toBeCloseTo(
      1,
      10
    )
  })

  test("colours by the top-level branch, not by the leaf", () => {
    const tiles = treemapTiles(tree, 2)

    expect(tiles.find((tile) => tile.id === "maths")?.branch).toBe("sciences")
    expect(tiles.find((tile) => tile.id === "physique")?.branch).toBe(
      "sciences"
    )
    // A top-level subject is its own branch, which is how the tooltip knows not to
    // repeat the name back to the reader.
    expect(tiles.find((tile) => tile.id === "art")?.branch).toBe("art")
  })

  test("says nothing when there is nothing to draw", () => {
    expect(treemapTiles([], 2)).toEqual([])
    expect(treemapTiles(tree, 0)).toEqual([])
  })
})

describe("own-marks labelling", () => {
  const shout = (subject: string) => `${subject} (mine)`

  test("renames own-marks branches and leaves every other tile alone", () => {
    const marks = [
      ...tree,
      node("perso", "sciences", 1, 0.1, true, "own-marks"),
    ]
    const labels = new Map(
      labelledTreemapTiles(marks, 2, shout).map((tile) => [tile.id, tile.label])
    )

    expect(labels.get("perso")).toBe("perso (mine)")
    expect(labels.get("maths")).toBe("maths")
  })

  test("labels the node the geometry was built from, when ids repeat", () => {
    // `treemapTiles` resolves a repeated id last-wins, because it indexes the
    // rows into a Map. The label pass used to scan with `find`, which is
    // first-wins — so a duplicated id could be drawn as one node and named
    // after the other. Both read the same way now.
    const twice: HierarchyNode[] = [
      node("art", null, 0, 0.2, true),
      node("clash", null, 0, 0.4, true, "subject"),
      node("clash", null, 0, 0.4, true, "own-marks"),
    ]
    const drawn = labelledTreemapTiles(twice, 2, shout)

    expect(drawn.find((tile) => tile.id === "clash")?.label).toBe(
      "clash (mine)"
    )
  })
})
