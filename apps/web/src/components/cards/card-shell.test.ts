import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")

/**
 * The file with its commentary removed.
 *
 * These files explain the drift they ended, so they name the very classes the
 * assertions below forbid. Reading the prose as code makes a comment about a bug
 * indistinguishable from the bug.
 */
const code = (file: string) =>
  source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

const shell = code("./card-shell.tsx")
const surfaces = {
  "the dashboard grid": code("./card-grid.tsx"),
  "the legacy card editor": code("./card-form.tsx"),
  "the widget editor": code("./widget-form.tsx"),
}

describe("the card shell", () => {
  test("draws every card the app shows, preview or not", () => {
    // The bug this ends: three hand-written copies of the same chrome. A
    // preview whose whole job is to predict the card is the one component that
    // cannot afford its own copy — each of these had drifted somewhere the
    // difference showed.
    for (const [name, file] of Object.entries(surfaces)) {
      expect(file, name).toContain("CardShell")
      // None of them builds the chrome itself any more.
      expect(file, name).not.toContain("<CardHeader")
      expect(file, name).not.toContain("<CardTitle")
      expect(file, name).not.toContain("<CardContent")
    }
  })

  test("hands the row's spare height to the body", () => {
    // The loudest half of "the preview looks nothing like the card": without
    // this the body takes its natural height instead of the row's, so a chart
    // is a different size in the editor than on the dashboard.
    expect(shell).toContain("min-h-0 flex-1 px-4")
  })

  test("has no minimum height of its own", () => {
    // The widget preview had grown a `min-h-36` floor the real card has no
    // trace of, so an editor card stood taller than the one it was predicting.
    expect(shell).not.toContain("min-h-36")
  })

  test("wraps a long title one way, not three", () => {
    // One copy dropped `min-w-0` and `break-words`, another dropped
    // `line-clamp-2` as well — so the same title broke in three places
    // depending on the screen.
    expect(shell).toContain("line-clamp-2")
    expect(shell).toContain("min-w-0")
    expect(shell).toContain("break-words")
  })

  test("resolves the accent itself, from the stored name", () => {
    // Each caller used to resolve it and pass the resolved object, which is how
    // one of them ended up styling a bar the others did not draw.
    expect(shell).toContain("cardAccent(accent)")
    for (const [name, file] of Object.entries(surfaces)) {
      expect(file, name).not.toContain("accentBar")
      expect(file, name).not.toContain("accentStyle")
    }
  })

  test("previews an insights body at the height it will be drawn at", () => {
    // The divergence the shell could not fix, because it is the body's own
    // prop: `expanded` takes a chart from 170px to 300 or 320. The grid passes
    // it for every insights card; the editor's preview passed nothing, so an
    // insights card was previewed at half the height it would have.
    for (const [name, file] of Object.entries({
      "the dashboard grid": surfaces["the dashboard grid"],
      "the widget editor": surfaces["the widget editor"],
    })) {
      expect(file, name).toContain('expanded={surface === "insights"}')
    }
  })

  test("sizes the preview row from the pane, not from its own box", () => {
    // Measured at a 1280px viewport: dividing the editor's aside into four gave
    // a quarter-width card 107px against the dashboard's 311px, and the body
    // scales its type and its charts to `@container/card`. Sizing the tracks
    // from the pane brings that ratio to 1.
    expect(shell).toContain("useScrollPane")
    expect(shell).toContain("ResizeObserver")
    expect(shell).toContain("gridTemplateColumns")
    // A row wider than the aside scrolls inside itself rather than widening the
    // page, and its own box is as wide as its tracks.
    expect(shell).toContain("overflow-x-auto")
    expect(shell).toContain("w-max")
  })

  test("carries the card's state styling on every surface", () => {
    // The widget preview rendered no `cardSurface` at all, so it never showed a
    // loading, empty or error state — the three things a preview most needs to
    // show before you save.
    for (const [name, file] of Object.entries(surfaces)) {
      expect(file, name).toContain("cardSurface(")
    }
  })
})
