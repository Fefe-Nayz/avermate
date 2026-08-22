import { describe, expect, test } from "bun:test"
import {
  MATERIAL_TREE_ROOT,
  materialFolderTrail,
  materialTreeItems,
} from "./materials-model"

/**
 * What the rail and the header trail read.
 *
 * The rail is a real tree component now, and a tree asks two questions about an
 * id: what is it called, and what is inside it. The header breadcrumb asks a
 * third — how did I get here — which is the trail.
 */

const folder = (id: string, parentId: string | null, sortOrder = 0) => ({
  id,
  name: id,
  parentId,
  sortOrder,
})

const folders = [
  folder("maths", null, 0),
  folder("chapter-1", "maths", 0),
  folder("corrections", "chapter-1", 0),
  folder("physics", null, 1),
]

describe("the folder tree, as a tree component asks for it", () => {
  test("hangs the top-level folders off a root that is never drawn", () => {
    expect(materialTreeItems(folders)[MATERIAL_TREE_ROOT]?.childIds).toEqual([
      "maths",
      "physics",
    ])
  })

  test("answers what is inside a folder, and what it is called", () => {
    const items = materialTreeItems(folders)

    expect(items["maths"]).toEqual({
      name: "maths",
      childIds: ["chapter-1"],
      issue: null,
    })
    expect(items["corrections"]?.childIds).toEqual([])
  })

  test("a folder whose parent is missing becomes a root, not a hidden row", () => {
    const items = materialTreeItems([folder("lost", "gone", 0)])

    expect(items[MATERIAL_TREE_ROOT]?.childIds).toEqual(["lost"])
    expect(items["lost"]?.issue).toBe("orphan")
  })
})

describe("the path down to a folder", () => {
  test("runs from a root to the folder itself", () => {
    expect(
      materialFolderTrail(folders, "corrections").map((entry) => entry.id)
    ).toEqual(["maths", "chapter-1", "corrections"])
  })

  test("a folder that is not there has no path at all", () => {
    // Half a trail would name folders that do not lead anywhere.
    expect(materialFolderTrail(folders, "gone")).toEqual([])
  })

  test("a parent cycle stops instead of walking forever", () => {
    const cyclic = [folder("a", "b", 0), folder("b", "a", 1)]

    expect(materialFolderTrail(cyclic, "a").map((entry) => entry.id)).toEqual([
      "b",
      "a",
    ])
  })
})
