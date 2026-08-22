import { describe, expect, test } from "bun:test"
import {
  buildMaterialFolderTree,
  canMoveMaterialFolder,
  flattenMaterialFolders,
  type MaterialFolderLike,
} from "./materials-model"

function folder(
  id: string,
  parentId: string | null,
  sortOrder = 0,
  name = id
): MaterialFolderLike {
  return { id, name, parentId, sortOrder }
}

describe("material folder view model", () => {
  test("nests folders and flattens them with their depth", () => {
    const flat = flattenMaterialFolders([
      folder("grandchild", "child"),
      folder("root", null),
      folder("child", "root"),
    ])

    expect(flat.map(({ folder: row, depth }) => [row.id, depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
    ])
  })

  test("sorts every level by order, then name, then id", () => {
    const flat = flattenMaterialFolders([
      folder("b", null, 0, "Zulu"),
      folder("c", null, 0, "alpha"),
      folder("a", null, 0, "Alpha"),
      folder("last", null, 2, "First alphabetically"),
    ])

    expect(flat.map(({ folder: row }) => row.id)).toEqual([
      "a",
      "c",
      "b",
      "last",
    ])
  })

  test("keeps an orphan visible as an explicit root", () => {
    const [node] = buildMaterialFolderTree([
      folder("orphan", "missing"),
      folder("child", "orphan"),
    ])

    expect(node?.folder.id).toBe("orphan")
    expect(node?.issue).toBe("orphan")
    expect(node?.children[0]?.folder.id).toBe("child")
  })

  test("keeps every cycle member visible once and terminates", () => {
    const flat = flattenMaterialFolders([
      folder("a", "b"),
      folder("b", "a"),
      folder("child", "a"),
    ])

    expect(flat.map(({ folder: row }) => row.id).sort()).toEqual([
      "a",
      "b",
      "child",
    ])
    expect(flat.filter(({ issue }) => issue === "cycle")).toHaveLength(2)
  })

  test("rejects self, descendant, unknown and cyclic move targets", () => {
    const folders = [
      folder("root", null),
      folder("child", "root"),
      folder("grandchild", "child"),
      folder("cycle-a", "cycle-b"),
      folder("cycle-b", "cycle-a"),
    ]

    expect(canMoveMaterialFolder(folders, "root", null)).toBe(true)
    expect(canMoveMaterialFolder(folders, "child", "root")).toBe(true)
    expect(canMoveMaterialFolder(folders, "root", "root")).toBe(false)
    expect(canMoveMaterialFolder(folders, "root", "grandchild")).toBe(false)
    expect(canMoveMaterialFolder(folders, "root", "missing")).toBe(false)
    expect(canMoveMaterialFolder(folders, "root", "cycle-a")).toBe(false)
  })
})
