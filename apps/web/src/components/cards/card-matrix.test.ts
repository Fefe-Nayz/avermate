import { describe, expect, test } from "bun:test"
import { compileWidgetDefinition } from "@avermate/core"
import {
  CARD_BODIES,
  cardMatrix,
  cardMatrixEmpty,
  cardMatrixSample,
  cardMatrixVariants,
} from "./card-matrix"

const source = (file: string) => Bun.file(new URL(file, import.meta.url)).text()

const fixtures = {
  goalId: "goal-1",
  periodId: "period-1",
  subjectIds: ["s-1", "s-2"],
}

function everyCard() {
  return [
    ...cardMatrix(1, fixtures),
    ...cardMatrix(1, { ...fixtures, surface: "insights" }),
    ...cardMatrixSample(1, fixtures),
    ...cardMatrixEmpty(1, fixtures),
    ...cardMatrixVariants(1, fixtures),
  ]
}

/**
 * The matrix is generated, so the thing worth asserting is that generation only
 * produces definitions the app can read, and that between them they reach every
 * body the renderer has. A combination the registry allows but the compiler
 * rejects would render as "This card could not be read" on the test page — a
 * broken fixture reported as a broken card.
 */
describe("the card matrix", () => {
  test("covers every measure the registry declares", () => {
    const measures = new Set(cardMatrix().map((card) => card.key.split(":")[1]))

    // Every card metric, and more than one shape of card for most of them.
    expect(measures.size).toBeGreaterThanOrEqual(21)
    expect(cardMatrix().length).toBeGreaterThan(measures.size)
  })

  test("generates only definitions the compiler accepts", () => {
    const broken = everyCard().flatMap((card) => {
      const compiled = compileWidgetDefinition(card.definition, {
        surface: card.surface,
      })
      return compiled.valid && compiled.plan
        ? []
        : [
            `${card.key}: ${compiled.issues
              .map((issue) => `${issue.path} ${issue.code}`)
              .join(", ")}`,
          ]
    })

    expect(broken).toEqual([])
  })

  /**
   * Per generator, not across them: the sample is a subset of the full matrix and
   * shares its keys by design. A section of the page draws one generator, so
   * that is the scope React keys have to be unique in.
   */
  test("gives every card in a section a key of its own", () => {
    const sections = {
      matrix: cardMatrix(1, fixtures),
      insights: cardMatrix(1, { ...fixtures, surface: "insights" }),
      sample: cardMatrixSample(1, fixtures),
      empty: cardMatrixEmpty(1, fixtures),
      variants: cardMatrixVariants(1, fixtures),
    }

    for (const [name, cards] of Object.entries(sections)) {
      const keys = cards.map((card) => card.key)
      expect(new Set(keys).size, name).toBe(keys.length)
    }
  })

  /**
   * The completeness check.
   *
   * `WidgetBody` dispatches to one body per result shape, mark and surface, and
   * three of them — the plain series list, the full chart for a time series, the
   * histogram as a study — are only reachable with `expanded`, which is the
   * insights surface. A matrix of dashboard cards alone silently misses them, and
   * "are all the formats on the page?" becomes unanswerable.
   *
   * So the renderer's bodies are read out of its source and matched against the
   * list the matrix claims to reach. Add a body and this fails until the claim is
   * updated.
   */
  test("accounts for every body the renderer can draw", async () => {
    const view = await source("./widget-view.tsx")

    // Component definitions in the renderer, plus the two it imports as bodies.
    const declared = new Set(
      [...view.matchAll(/^function (Widget[A-Za-z]+)\(/gm)].map(
        (match) => match[1] as string
      )
    )
    // Bodies that live in their own file. Read from the imports rather than listed
    // here, because a list is a list somebody forgets: the waffle was drawn for a
    // week without being accounted for, and the strip would have been the second.
    for (const [, imported] of view.matchAll(
      /^import \{ (\w+) \} from "\.\/card-[a-z-]+"$/gm
    )) {
      if (view.includes(`<${imported}`)) declared.add(imported as string)
    }

    // Helpers, not bodies: they render inside one rather than being dispatched to.
    const helpers = new Set([
      "WidgetBody",
      // Measures the host and resolves presentation before handing the same
      // analytical result to the bodies below; it is a boundary, not a body the
      // matrix has to reach as a separate card.
      "WidgetBodyContent",
      "WidgetNumberText",
    ])
    const bodies = [...declared].filter((name) => !helpers.has(name))

    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies.filter((name) => !(name in CARD_BODIES))).toEqual([])
    // And nothing claimed that no longer exists.
    expect(
      Object.keys(CARD_BODIES).filter((name) => !declared.has(name))
    ).toEqual([])
  })

  test("reaches the insights rendering, where three of those bodies live", () => {
    const insights = cardMatrix(1, { ...fixtures, surface: "insights" })

    expect(insights.length).toBeGreaterThan(0)
    expect(insights.every((card) => card.expanded)).toBe(true)
    // The list that becomes a plain series list, and the series that becomes a
    // full chart instead of a reading over a sparkline.
    expect(insights.some((card) => card.key.endsWith(":list"))).toBe(true)
    expect(insights.some((card) => card.key.endsWith(":line"))).toBe(true)
  })

  /**
   * The dashboard's own average card is a line with its axes turned off. A matrix
   * built from default options would not contain it, which is the whole reason the
   * variants exist.
   */
  test("covers the options that change what a card looks like", () => {
    const variants = cardMatrixVariants(1, fixtures)
    const titles = variants.map((card) => card.title).join("\n")

    expect(
      variants.some(
        (card) =>
          !card.definition.visualization.axes.x.visible &&
          !card.definition.visualization.axes.y.visible &&
          card.definition.visualization.recipe === "area"
      )
    ).toBe(true)
    for (const option of [
      "thresholds",
      "no delta",
      "trend arrow",
      "thick track",
      "bar alone",
      "step curve",
      "horizontal",
      "bins",
      "outliers hidden",
      "sequential",
      "diverging",
      "names only",
      "reversed",
      "legend",
      "previous window",
      "baseline",
      "moving average",
      "cumulative",
      "compact",
      "percentage",
      "rolling thirty days",
      "passed grades only",
    ]) {
      expect(titles, option).toContain(option)
    }
  })
})
