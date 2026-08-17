import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import { TickNumber } from "./card-figure"

const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")

const figure = source("./card-figure.tsx")
const view = source("./widget-view.tsx")
const ranking = source("./card-ranking.tsx")
const distribution = source("./card-distribution.tsx")

/**
 * The dashboard's own presentation, on the widget renderer.
 *
 * Unifying the two renderers onto the widget one kept every card working and lost
 * how they looked: the reels stopped turning, the type stopped answering the width
 * of the card, the gauge became a ten-pixel pipe, the histogram grew a y-axis and
 * a grid, the ranking stacked a fixed six rows down a card half a desktop wide,
 * and the streak stopped burning. All of it came from one file that went with the
 * legacy path. It is back, and shared, so the definition still chooses *what* a
 * card measures while the app decides how a card looks.
 *
 * Rendered geometry was measured in a browser — 6px gauge track, a ranking grid of
 * two 213px columns on 32px rows, ten bucket floors and no y-axis on the
 * histogram, a grey flame on a broken streak. What is asserted here is the wiring
 * that produced it.
 */
describe("a card's figures", () => {
  test("mount at zero, so the reel has something to roll", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="fr" messages={{}}>
        <TickNumber value={17} />
      </NextIntlClientProvider>
    )

    // The first paint is zero and the entrance is the change to the real value.
    // NumberFlow only animates changes, so a figure painted straight at 17 never
    // moves.
    expect(html).toContain("0")
    // The reel paints into a shadow root that neither assistive technology nor
    // copy-paste can reach, so the value is also written out plainly.
    expect(html).toContain('class="sr-only"')
    expect(html).toContain("17")
  })

  test("come from the app's own components, not from the widget renderer", () => {
    // An average on a card is the same `AverageValue` as on a subject page: same
    // reel, same "/ 20", same band tint. The widget renderer set it as static
    // text at a fixed size.
    expect(figure).toContain("<AverageValue")
    expect(figure).toContain("<DeltaValue")
    expect(figure).toContain("NumberFlow")
    // The entrance itself moved to `use-entered`, and moved for a reason worth
    // keeping: a six-line hook should not drag a rendering library behind it, and
    // importing it from here pulled NumberFlow into every page that wanted a
    // figure to arrive — the impact bars, for one.
    expect(figure).toContain('from "@/hooks/use-entered"')
    expect(source("../../hooks/use-entered.ts")).toContain(
      "requestAnimationFrame"
    )
  })

  test("answer the width of the card they are in", () => {
    // Two steps, read from the card's own query container — not the viewport.
    expect(figure).toContain(
      "text-3xl font-semibold @[16rem]/card:text-4xl @[26rem]/card:text-5xl"
    )
    for (const ladder of ["VALUE_TEXT", "SUPPORT_TEXT", "FOOTNOTE_TEXT"]) {
      expect(view, ladder).toContain(ladder)
    }
    // The fixed sizes the widget renderer had are gone.
    expect(view).not.toContain("text-3xl @min-[18rem]/card:text-4xl")
  })
})

describe("a card's body", () => {
  test("draws the gauge as a hairline that grows with the card", () => {
    expect(view).toContain("h-1.5 @[20rem]/card:h-2")
    expect(view).toContain("transition-[width] duration-500")
    // From nothing on the first paint, for the same reason the reels start at
    // zero: a bar that is simply *there* never says it filled.
    expect(view).toContain("entered ? gaugeRatio : 0")
  })

  test("burns a live streak and greys a broken one", () => {
    expect(view).toContain("animate-flame")
    expect(view).toContain("animate-ember")
    expect(view).toContain("text-muted-foreground/50")
    expect(view).toContain("bg-band-weak/15 text-band-weak")
  })

  test("makes a record a way in to what it names", () => {
    expect(view).toContain("href={`/grades/${result.gradeId}`}")
    expect(view).toContain("href={`/subjects/${result.subjectId}`}")
    expect(view).toContain("<GradeResultBadge")
    // The name wraps rather than truncating — "Espagnol" cut to "Espag…" reports
    // nothing at all.
    expect(view).toContain('cn(NAME_TEXT, "break-words hover:underline")')
  })

  test("shows a goal against its target, and reddens one it cannot reach", () => {
    expect(view).toContain('{t("of")}')
    expect(view).toContain('"unreachable"')
    expect(view).toContain("bg-negative")
  })

  test("measures the ranking against the box it was given", () => {
    // Columns from the width, cells from the height, and what did not fit
    // counted out loud rather than silently dropped.
    expect(ranking).toContain("cardListColumns(viewport.width)")
    expect(ranking).toContain("cardListCellLimit(viewport)")
    expect(ranking).toContain('t("+{count} more"')
    expect(ranking).toContain("<FitSingleLine")
    // The ul is absolutely positioned, so revealing more entries into a taller
    // neighbour's row can never inflate that row in return.
    expect(ranking).toContain("absolute inset-0 grid content-center")
  })

  test("draws the histogram as a shape, not as a study", () => {
    expect(distribution).toContain('fill: "var(--chart-1)"')
    expect(distribution).toContain("radius: 4")
    // Bucket floors on the x-axis, no y-axis, the full range owed to the tooltip.
    expect(distribution).toContain("axis: false")
    expect(distribution).toContain("title: point?.range")
  })

  test("routes the definition's marks at these bodies", () => {
    expect(view).toContain("<MiniDistribution")
    expect(view).toContain("<RankingList")
    // Only where the rows are subjects: the list links each one to its page.
    expect(view).toContain('definition.analysis.groupBy.kind === "subject"')
  })
})

describe("a live streak", () => {
  test("dresses the whole card, through the wrapper it now arrives in", () => {
    const shell = source("./card-shell.tsx")

    // The evaluator returns a streak as a `structured` result whose value is the
    // streak, and this file once matched only the outer kind — which silently
    // stopped every streak card burning: nothing failed, the card just went quiet.
    //
    // The shape is now read in core, beside the union that declares it, so what
    // matters here is that the shell asks rather than unpicks. Whether the answer
    // is right is `widgetLiveStreak`'s own test, where it can be called instead of
    // read as text.
    expect(shell).toContain("widgetLiveStreak(result)")
    expect(shell).not.toContain('result.value.kind === "streak"')
    expect(shell).toContain("from-band-weak/15 via-card to-band-fair/10")
  })
})
