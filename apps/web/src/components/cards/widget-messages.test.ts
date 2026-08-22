import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { WIDGET_RECIPES } from "@avermate/core"
import { WIDGET_FLOW_SCHEMA } from "@avermate/core/widget-flow-schema"

/**
 * Every key the editor can be handed has a sentence here.
 *
 * `useWidgetMessages` passes an unknown key *through*, because a reference label — a
 * subject's name, a goal's — is user data and must not be translated. The cost of that
 * choice is that a missing key does not fail: it renders as itself. The chart picker
 * shipped reading `widget.recipe.sparkline` down its whole list, because the flow moved
 * from marks to recipes and these entries did not, and nothing anywhere said so.
 *
 * Read as source rather than by calling the hook: it needs React, and the question here is
 * about the table, not about rendering.
 */
const messages = readFileSync(
  new URL("./use-widget-messages.ts", import.meta.url),
  "utf8"
)

describe("widget messages", () => {
  test("names every recipe the editor can offer", () => {
    const missing = WIDGET_RECIPES.filter(
      (recipe) => !messages.includes(`"widget.recipe.${recipe}":`)
    )

    expect(missing).toEqual([])
  })

  test("has no name left over from a recipe that no longer exists", () => {
    const named = [...messages.matchAll(/"widget\.recipe\.([a-z-]+)":/g)].map(
      (match) => match[1] as string
    )
    const stale = named.filter(
      (recipe) => !WIDGET_RECIPES.includes(recipe as never)
    )

    expect(stale).toEqual([])
  })

  test("names every field, variant and option the editor can show", () => {
    /**
     * The schema itself, not a grep over its source.
     *
     * This read the file with a regular expression and missed every id a helper builds:
     * `windowFields` names its six controls from a prefix, so the whole of a window pair —
     * twelve fields — was invisible to the check and unnamed in the map. Walking the
     * exported schema catches whatever the schema actually declares, however it was
     * written.
     */
    const declared = new Set<string>()
    for (const item of WIDGET_FLOW_SCHEMA) {
      declared.add(item.messageKey)
      if (item.descriptionKey) declared.add(item.descriptionKey)
      for (const option of item.options ?? []) declared.add(option.messageKey)
      for (const variant of item.collection?.variants ?? []) {
        declared.add(variant.messageKey)
        for (const child of variant.fields) {
          declared.add(child.messageKey)
          for (const option of child.options ?? []) {
            declared.add(option.messageKey)
          }
        }
      }
      if (item.collection) declared.add(item.collection.addMessageKey)
    }
    const missing = [...declared].filter(
      (key) => !messages.includes(`"${key}":`)
    )

    expect(missing.sort()).toEqual([])
  })

  test("says every refusal the compiler can emit", () => {
    /**
     * The message keys of `widget.error.*` come from core, so core is where they are
     * counted. A refusal rendering as `widget.error.difference-needs-two` is worse than an
     * unnamed chart: it appears at the moment somebody is mid-way through building a card.
     */
    const compiler = readFileSync(
      new URL(
        "../../../../../packages/core/src/widget-definition.ts",
        import.meta.url
      ),
      "utf8"
    )
    const emitted = new Set(
      [...compiler.matchAll(/"(widget\.error\.[a-z.-]+)"/g)].map(
        (match) => match[1] as string
      )
    )
    const missing = [...emitted].filter(
      (key) => !messages.includes(`"${key}":`)
    )

    expect(missing.sort()).toEqual([])
  })
})
