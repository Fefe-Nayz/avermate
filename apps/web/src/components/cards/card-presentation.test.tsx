import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import { TickNumber } from "./card-figure"

const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")

/** Assertions about behaviour must read the code, not the prose around it. */
const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((line) => {
      // Line comments *and* block comments: this dropped only `//` lines, so a doc
      // comment mentioning a truncated axis label failed the "nothing is truncated"
      // assertion below — a test reporting on its own prose.
      const trimmed = line.trimStart()
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*") &&
        !trimmed.startsWith("*")
      )
    })
    .join("\n")

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
    // Columns in CSS so the first paint is already in the right shape, cells
    // from the height, and what did not fit counted out loud rather than
    // silently dropped.
    expect(ranking).toContain("CARD_LIST_COLUMN_QUERIES")
    expect(ranking).toContain("cardListCellLimit(viewport)")
    expect(ranking).toContain('t("+{count} more"')
    expect(ranking).toContain("<FitSingleLine")
    // The ul is absolutely positioned, so revealing more entries into a taller
    // neighbour's row can never inflate that row in return.
    expect(ranking).toContain("absolute inset-0 grid overflow-hidden")
  })

  /**
   * The card is as tall as its row, and a body that stacks two lines at the top
   * of it leaves the rest empty — which is what the dashboard's own record cards
   * did: a name and an average in the top third of the card, and nothing under
   * them. Nothing here is measured, deliberately: see the ladders' comment.
   */
  test("spends the height the row gave it", () => {
    // Bands across the card rather than lines at its top — spread by a bounded
    // gap, so a much taller row centres them instead of opening a hole.
    expect(view).toContain("flex h-full flex-col justify-center gap-2")
    expect(view).toContain("<BandGap />")
    expect(figure).toContain('className="max-h-5 min-h-0 flex-1"')
    // A gauge holds the bottom edge while its reading centres above it, instead
    // of the pair sitting in the middle with a band of nothing either side.
    expect(view).toContain("flex min-h-0 flex-1 flex-col justify-center gap-3")
    // An average under a subject's name is that card's answer, so it is set as
    // one rather than as a caption.
    expect(view).toContain("className={READING_TEXT}")
    expect(figure).toContain(
      "text-2xl leading-none font-semibold @[16rem]/card:text-3xl @[26rem]/card:text-4xl"
    )
    // Growing type must never start truncating what a card exists to name.
    // Read from the code rather than the file: the word appears in prose about
    // truncated axes, and a test that greps comments tests the comments.
    expect(withoutComments(view)).not.toContain("truncate")
  })

  /**
   * `focusRing: false` turns off the renderer's own halo — a Canvas-filled circle
   * that reads white on a light card — and turning it off without putting
   * anything back left every card chart, and every insights study, with a tooltip
   * and no sign of which point it described.
   *
   * Solved the way the radar solves it: the host reports focus to React and React
   * hands it back to the spec as an explicit marker. Not as a mark `states` entry
   * — that is how the general-average chart does it, and it builds its own grouped
   * focus strategy to make the condition mean something; these charts ask for
   * `"nearest"`.
   */
  test("marks the point under the pointer", () => {
    expect(view).toContain("focusRing: false")
    expect(view).toContain("onFocusChange")
    expect(view).toContain('id: "widget-active-point"')
    // A marker outliving the pointer is worse than none.
    expect(view).toContain("onPointerLeave={() => setFocusedKey(null)}")
    // Rebuilt from the focused datum, so the marker is one dot and not a state
    // on every point.
    expect(view).toContain(
      "plotted.find((item) => String(item.key) === focusedKey)"
    )
  })

  /**
   * The recipes added on top of the eleven marks. Each is drawn from data the
   * result already carries — a slope arrow's tail is `value - delta`, a waffle's
   * bands are a distribution's buckets — so none of them needed a new result
   * shape, and none of them may claim a channel the model does not have.
   */
  test("draws the recipes the eleven marks could not", () => {
    // A stem to the baseline and a head at the reading.
    expect(view).toContain('id: "widget-lollipop-stems"')
    expect(view).toContain('id: "widget-lollipop-heads"')
    // Split by direction rather than coloured by a callback, which a rule does
    // not take here.
    expect(view).toContain('"widget-slope-shafts-up"')
    expect(view).toContain('"widget-slope-shafts-down"')
    expect(view).toContain('"widget-slope-heads-up"')
    expect(view).toContain('id: "widget-slope-starts"')
    /**
     * The tail is derived, not stored — and derived in the units the head is drawn in.
     *
     * `item.y` is the *encoded* value, the mark a reader sees; `item.delta` is the datum's
     * own ratio. Subtracting the second from the first mixed the two, and a dumbbell of
     * subject improvements drew its "before" end at 29.8 on a scale of twenty. Both ends
     * go through the same encoder now.
     */
    expect(view).toContain("item.y -")
    expect(view).toContain("widgetNumericEncodedValue(")
    expect(withoutComments(view)).not.toContain("item.y - item.delta")
    expect(view).toContain("<CardWaffle")
  })

  /**
   * A gauge carrying thresholds is a bullet: the bands are the thresholds and the
   * target is the highest of them. Both come out of the document as it already
   * stands — a card that says where it wants to get to has said it as a threshold.
   */
  test("draws a gauge with thresholds as a bullet", () => {
    expect(view).toContain("const bands = sortedThresholds.map")
    expect(view).toContain(
      "const target = sortedThresholds.at(-1)?.ratio ?? null"
    )
    // Behind the reading, not competing with it.
    expect(view).toContain("opacity: 0.16")
    // A target on the far edge would otherwise be clipped by the rounded end.
    expect(view).toContain('target > 0.98 ? "translateX(-100%)" : undefined')
  })

  test("draws the histogram as a shape, not as a study", () => {
    expect(distribution).toContain('fill: "var(--chart-1)"')
    expect(distribution).toContain("radius: 4")
    // Bucket floors on the x-axis, no y-axis, the full range owed to the tooltip.
    expect(distribution).toContain("axis: false")
    expect(distribution).toContain("title: point?.range")
  })

  /**
   * A table is the one body whose content has a hard minimum width: four columns
   * of it wanted 239px of body, and a 154px card gave them 122px. Measured, it
   * ran 85px past its box — reachable only by dragging a card sideways.
   */
  test("drops the table's secondary columns before the card has to scroll", () => {
    expect(view).toContain(
      'const COUNT_COLUMN = "hidden @[15rem]/card:table-cell"'
    )
    expect(view).toContain(
      'const DELTA_COLUMN = "hidden @[18rem]/card:table-cell"'
    )
    // The name is never one of them, and it wraps rather than widening the table.
    expect(view).toContain(
      'className="min-w-0 py-2 pr-3 [overflow-wrap:anywhere]"'
    )
  })

  /**
   * The audit's rule that a renderer must be chosen from the capabilities really
   * supported. Identity today — every recipe a card can be saved as has a web
   * renderer — so what is pinned here is that the body asks, not what it gets.
   */
  test("draws the recipe the web actually has a renderer for", () => {
    expect(view).toContain("widgetVisualizationForPlatform(")
    expect(view).toContain('"web",')
    expect(view).toContain("result.shape")
    // And then reads *that*, rather than the definition's own mark, everywhere in
    // the body: a resolution nothing consults is a comment.
    const body = view.slice(
      view.indexOf("export function WidgetBody({"),
      view.indexOf("function useDispersionFooter")
    )
    expect(body).not.toContain("definition.visualization.mark")
  })

  test("routes the definition's marks at these bodies", () => {
    expect(view).toContain("<MiniDistribution")
    expect(view).toContain("<RankingList")
    // Asked of the recipe, which is what a ranking *is* and what the document stores.
    // Reading a resolved slot instead sent every ranking to the plain series list: a list
    // card has no x channel, so the slot was null and the condition never held.
    expect(view).toContain('visualization.recipe === "ranking"')
  })

  test("keeps explicit units on signed readings in every recipe", () => {
    expect(view).toContain(
      "return difference ? number : `${number} / ${format.number(scale)}`"
    )
    expect(view).toContain("const formatDifferenceValue =")
    expect(view).toContain("difference: headlineIsDifference")
    expect(ranking).toContain("item.difference &&")
    expect(view).toContain("const formatDifferenceShownValue =")
    expect(view).toContain("formatDifferenceShownValue(")
    expect(view).toContain("widgetChannelValueIsDelta(yField, difference)")
    expect(view).toContain("widgetChannelValueIsDelta(colorField, difference)")
    expect(view).toContain("formatYShownValue(item.y, yValueType)")
    expect(view).toContain("formatColorShownValue(")
    expect(figure).toContain(
      'presentation.unit === "days" ? ` ${daysLabel}` : null'
    )
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
