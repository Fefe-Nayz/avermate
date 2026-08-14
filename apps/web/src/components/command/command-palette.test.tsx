import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CommandResultColumns } from "./command-palette"

describe("command palette result columns", () => {
  test("pins numeric values to a compact right-aligned column", () => {
    const html = renderToStaticMarkup(
      <CommandResultColumns
        primary="A subject with a deliberately long name"
        secondary="17.1"
        secondaryKind="value"
      />
    )

    expect(html).toContain("grid-cols-[minmax(0,1fr)_minmax(3rem,auto)]")
    expect(html).toContain("justify-self-end")
    expect(html).toContain("text-right")
    expect(html).toContain("whitespace-normal")
    expect(html).toContain("break-words")
    expect(html).not.toContain("truncate")
  })

  test("reserves a stable right column for long subject labels", () => {
    const html = renderToStaticMarkup(
      <CommandResultColumns
        primary="A grade with a deliberately long name"
        secondary="A subject with a deliberately long name"
        secondaryKind="label"
      />
    )

    expect(html).toContain("grid-cols-[minmax(0,1fr)_minmax(6rem,40%)]")
    expect(html).toContain('data-secondary-kind="label"')
    expect(html).toContain("justify-self-end")
    expect(html).toContain("text-right")
    expect(html).not.toContain("truncate")
  })
})
