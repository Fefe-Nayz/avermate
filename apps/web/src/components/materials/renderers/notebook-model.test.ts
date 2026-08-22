import { describe, expect, test } from "bun:test"
import { MAX_NOTEBOOK_CELLS, parseSafeNotebook } from "./notebook-model"

describe("safe Jupyter notebook parsing", () => {
  test("keeps Markdown, code and inert text outputs", () => {
    const parsed = parseSafeNotebook(
      JSON.stringify({
        metadata: { language_info: { name: "python" } },
        cells: [
          { cell_type: "markdown", source: ["# Result\n", "Safe"] },
          {
            cell_type: "code",
            execution_count: 3,
            source: "print(2)",
            outputs: [
              { output_type: "stream", text: "2\n" },
              {
                output_type: "display_data",
                data: { "text/html": "<script>alert(1)</script>" },
              },
            ],
          },
        ],
      })
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.cells[0]).toMatchObject({
      kind: "markdown",
      source: "# Result\nSafe",
    })
    expect(parsed.cells[1]).toMatchObject({
      kind: "code",
      language: "python",
      executionCount: "3",
      outputs: [{ kind: "text", text: "2\n" }],
    })
    expect(JSON.stringify(parsed)).not.toContain("<script>")
  })

  test("permits only bounded PNG image output", () => {
    const parsed = parseSafeNotebook(
      JSON.stringify({
        cells: [
          {
            cell_type: "code",
            source: "plot()",
            outputs: [
              {
                output_type: "display_data",
                data: { "image/png": "iVBORw0KGgo=" },
              },
              {
                output_type: "display_data",
                data: { "image/svg+xml": "<svg onload='alert(1)'/>" },
              },
            ],
          },
        ],
      })
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.cells[0]?.outputs).toEqual([
      {
        kind: "image",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        alt: "Notebook output",
      },
    ])
  })

  test("rejects invalid JSON and caps the number of cells", () => {
    expect(parseSafeNotebook("not json").ok).toBe(false)
    const parsed = parseSafeNotebook(
      JSON.stringify({
        cells: Array.from({ length: MAX_NOTEBOOK_CELLS + 1 }, () => ({
          cell_type: "raw",
          source: "x",
        })),
      })
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.cells).toHaveLength(MAX_NOTEBOOK_CELLS)
    expect(parsed.truncated).toBe(true)
  })
})
