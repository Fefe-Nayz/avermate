import { describe, expect, test } from "bun:test"
import { DOCUMENT_CALLOUT_KINDS } from "./document-model"
import { remarkCallouts, transformCalloutBlockquote } from "./callouts"

interface TestCalloutNode {
  type: string
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
  children: Array<{
    type: string
    children: Array<{ type: string; value: string }>
  }>
}

function blockquote(marker: string, body = "Important text"): TestCalloutNode {
  return {
    type: "blockquote",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: `${marker}\n${body}` }],
      },
    ],
  }
}

describe("fiche callout directives", () => {
  for (const kind of DOCUMENT_CALLOUT_KINDS) {
    test(`turns ${kind} into a labelled semantic aside`, () => {
      const node = blockquote(`[!${kind}]`)
      expect(transformCalloutBlockquote(node)).toBe(kind)
      expect(node.data).toEqual({
        hName: "aside",
        hProperties: { "data-callout": kind, role: "note" },
      })
      expect(node.children[0]?.children[0]?.value).toBe("Important text")
    })
  }

  test("leaves ordinary and unknown blockquotes untouched", () => {
    const ordinary = blockquote("Remember")
    const unknown = blockquote("[!INFO]")
    expect(transformCalloutBlockquote(ordinary)).toBeNull()
    expect(transformCalloutBlockquote(unknown)).toBeNull()
    expect(ordinary).not.toHaveProperty("data")
    expect(unknown).not.toHaveProperty("data")
  })

  test("walks nested markdown without erasing an empty marker paragraph", () => {
    const callout = blockquote("[!CHECK]", "")
    const tree = {
      type: "root",
      children: [{ type: "list", children: [callout] }],
    }
    remarkCallouts()(tree)
    expect(callout.data?.hProperties?.["data-callout"]).toBe("CHECK")
    expect(callout.children).toEqual([])
  })
})
