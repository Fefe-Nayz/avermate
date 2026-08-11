import { describe, expect, test } from "bun:test"
import { adjacentSortableItem, sameSortableGroup } from "./sortable-list"
import type { Active, DroppableContainer } from "@dnd-kit/core"

function carrier(id?: string) {
  return {
    data: {
      current: id
        ? { sortable: { containerId: id, index: 0, items: ["first"] } }
        : undefined,
    },
  }
}

describe("sortable tree collision scope", () => {
  test("keeps only siblings from the active sortable group", () => {
    const first = carrier("root")
    const nested = carrier("nested")
    const second = carrier("root")

    const result = sameSortableGroup(
      first as unknown as Active,
      [first, nested, second] as unknown as DroppableContainer[]
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(first as unknown as DroppableContainer)
    expect(result[1]).toBe(second as unknown as DroppableContainer)
  })

  test("keeps keyboard movement inside sibling boundaries", () => {
    const siblings = ["one", "two", "three"]

    expect(adjacentSortableItem(siblings, "two", -1)).toBe("one")
    expect(adjacentSortableItem(siblings, "two", 1)).toBe("three")
    expect(adjacentSortableItem(siblings, "one", -1)).toBeUndefined()
    expect(adjacentSortableItem(siblings, "three", 1)).toBeUndefined()
    expect(adjacentSortableItem(siblings, "nested", 1)).toBeUndefined()
  })

  test("does not hide candidates when sortable metadata is unavailable", () => {
    const candidates = [carrier("root"), carrier("nested")]
    const typedCandidates = candidates as unknown as DroppableContainer[]
    expect(
      sameSortableGroup(carrier() as unknown as Active, typedCandidates)
    ).toBe(typedCandidates)
  })
})
