import { describe, expect, test } from "bun:test"
import {
  MINDMAP_LABEL_MAX_LENGTH,
  MINDMAP_META_MAX_BYTES,
  MINDMAP_MAX_DEPTH,
  addMindmapChild,
  addMindmapSibling,
  createMindmapContent,
  deleteMindmapNode,
  flattenMindmap,
  indentMindmapNode,
  layoutMindmap,
  mindmapContentIssue,
  outdentMindmapNode,
  setMindmapLabel,
  setMindmapNote,
  type MindmapContentV1,
} from "./mindmap-model"

function fixture(): MindmapContentV1 {
  return {
    version: 1,
    root: {
      id: "root",
      label: "Calculus",
      children: [
        { id: "limits", label: "Limits" },
        {
          id: "derivatives",
          label: "Derivatives",
          children: [{ id: "chain", label: "Chain rule" }],
        },
        { id: "integrals", label: "Integrals" },
      ],
    },
  }
}

describe("mind map outline operations", () => {
  test("creates and flattens the root in deterministic preorder", () => {
    expect(createMindmapContent("  Algebra  ", "root")).toEqual({
      version: 1,
      root: { id: "root", label: "Algebra" },
    })
    expect(
      flattenMindmap(fixture()).map(({ id, depth }) => [id, depth])
    ).toEqual([
      ["root", 0],
      ["limits", 1],
      ["derivatives", 1],
      ["chain", 2],
      ["integrals", 1],
    ])
  })

  test("adds children and siblings without mutating the source", () => {
    const original = fixture()
    const withChild = addMindmapChild(original, "limits", {
      id: "epsilon",
      label: "Epsilon definition",
    })
    const withSibling = addMindmapSibling(withChild, "limits", {
      id: "continuity",
      label: "Continuity",
    })
    expect(flattenMindmap(original).map((row) => row.id)).not.toContain(
      "epsilon"
    )
    expect(flattenMindmap(withSibling).map((row) => row.id)).toEqual([
      "root",
      "limits",
      "epsilon",
      "continuity",
      "derivatives",
      "chain",
      "integrals",
    ])
  })

  test("renames and edits notes while enforcing field maxima", () => {
    const renamed = setMindmapLabel(fixture(), "limits", "One-sided limits")
    const noted = setMindmapNote(renamed, "limits", "Use epsilon-delta.")
    expect(
      flattenMindmap(noted).find((row) => row.id === "limits")
    ).toMatchObject({ label: "One-sided limits", note: "Use epsilon-delta." })
    expect(
      setMindmapLabel(noted, "limits", "x".repeat(MINDMAP_LABEL_MAX_LENGTH + 1))
    ).toBe(noted)
  })

  test("indents under the previous sibling and outdents after the parent", () => {
    const indented = indentMindmapNode(fixture(), "integrals")
    expect(
      flattenMindmap(indented).map(({ id, depth }) => [id, depth])
    ).toEqual([
      ["root", 0],
      ["limits", 1],
      ["derivatives", 1],
      ["chain", 2],
      ["integrals", 2],
    ])
    const outdented = outdentMindmapNode(indented, "chain")
    expect(
      flattenMindmap(outdented).map(({ id, depth }) => [id, depth])
    ).toEqual([
      ["root", 0],
      ["limits", 1],
      ["derivatives", 1],
      ["integrals", 2],
      ["chain", 1],
    ])
  })

  test("deletes a whole subtree but never deletes or outdents the root", () => {
    const original = fixture()
    expect(deleteMindmapNode(original, "root")).toBe(original)
    expect(outdentMindmapNode(original, "root")).toBe(original)
    expect(
      flattenMindmap(deleteMindmapNode(original, "derivatives")).map(
        (row) => row.id
      )
    ).toEqual(["root", "limits", "integrals"])
  })

  test("refuses duplicate ids and an operation beyond eight levels", () => {
    const original = fixture()
    expect(
      addMindmapChild(original, "limits", { id: "chain", label: "Duplicate" })
    ).toBe(original)
    let deep = createMindmapContent("0", "n0")
    for (let depth = 1; depth < MINDMAP_MAX_DEPTH; depth += 1) {
      deep = addMindmapChild(deep, `n${depth - 1}`, {
        id: `n${depth}`,
        label: String(depth),
      })
    }
    expect(
      addMindmapChild(deep, `n${MINDMAP_MAX_DEPTH - 1}`, {
        id: "too-deep",
        label: "Too deep",
      })
    ).toBe(deep)
  })
})

describe("deterministic mind map layout", () => {
  test("places depth on x and centers parents across their children", () => {
    const layout = layoutMindmap(fixture(), { columnGap: 200, rowGap: 100 })
    const byId = new Map(layout.nodes.map((node) => [node.id, node]))
    expect(byId.get("root")).toMatchObject({ x: 0, y: 100 })
    expect(byId.get("limits")).toMatchObject({ x: 200, y: 0 })
    expect(byId.get("derivatives")).toMatchObject({ x: 200, y: 100 })
    expect(byId.get("chain")).toMatchObject({ x: 400, y: 100 })
    expect(byId.get("integrals")).toMatchObject({ x: 200, y: 200 })
    expect(layout.edges).toHaveLength(4)
  })

  test("reports invalid blank labels before autosave", () => {
    expect(mindmapContentIssue(setMindmapLabel(fixture(), "limits", ""))).toBe(
      "Every mind map node needs a short label"
    )
  })

  test("enforces the server metadata byte ceiling", () => {
    const content = createMindmapContent("Root", "root")
    content.root.children = Array.from({ length: 65 }, (_, index) => ({
      id: `node-${index}`,
      label: `Node ${index}`,
      note: "é".repeat(4_096),
    }))
    expect(JSON.stringify(content).length).toBeLessThan(MINDMAP_META_MAX_BYTES)
    expect(mindmapContentIssue(content)).toBe(
      "The mind map must stay under 512 KiB"
    )
  })
})
