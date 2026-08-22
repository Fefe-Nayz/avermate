import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import type { WidgetFlowField } from "@avermate/core/widget-types"
import {
  WIDGET_DIMENSION_SCHEMA,
  WIDGET_FILTER_SCHEMA,
} from "@avermate/core/widget-flow-schema"
import {
  collectionAddVariants,
  WidgetFieldRenderer,
} from "./widget-field-renderer"

const message = (key: string) =>
  (
    ({
      "widget.field.scope": "Scope",
      "widget.option.general": "Whole selection",
      "widget.option.subjects": "Selected subjects",
      "widget.field.filters": "Filters",
      "widget.action.add-filter": "Add filter",
      "widget.filter.grade-ratio": "Grade value",
      "widget.filter.coefficient": "Coefficient",
      "widget.filter.has-note": "Numeric result",
      "widget.filter.grade-name": "Grade name",
      "widget.filter.passed": "Pass status",
      "widget.field.dimensions": "Grouping",
      "widget.action.add-dimension": "Add grouping",
      "widget.dimension.time": "Over time",
      "widget.dimension.subject": "By subject",
      "widget.field.time-interval": "Time interval",
      "widget.field.subject-level": "Which subjects",
    }) as Record<string, string>
  )[key] ?? key

const base = {
  editor: "definition",
  section: "data",
  order: 1,
  descriptionKey: null,
  required: true,
  clearWhenHidden: true,
  visibleWhen: { kind: "always" },
  active: true,
  error: null,
  optionProvider: undefined,
  min: undefined,
  max: undefined,
  step: undefined,
} satisfies Partial<WidgetFlowField>

describe("declarative widget field renderer", () => {
  test("renders choices supplied by a descriptor", () => {
    const field = {
      ...base,
      id: "scope",
      path: "query.scope.kind",
      control: "choice",
      messageKey: "widget.field.scope",
      options: [
        { value: "general", messageKey: "widget.option.general" },
        { value: "subjects", messageKey: "widget.option.subjects" },
      ],
    } satisfies WidgetFlowField

    const html = renderToStaticMarkup(
      <WidgetFieldRenderer
        field={field}
        draft={{ query: { scope: { kind: "general" } } }}
        message={message}
        onChange={() => undefined}
      />
    )

    expect(html).toContain("Scope")
    expect(html).toContain("Whole selection")
    expect(html).toContain('aria-checked="true"')
  })

  test("renders collection variants from the recursive core schema", () => {
    const field = {
      ...base,
      id: "filters",
      path: "query.filters",
      control: "filters",
      messageKey: "widget.field.filters",
      required: false,
      options: [],
      collection: WIDGET_FILTER_SCHEMA,
    } satisfies WidgetFlowField

    const html = renderToStaticMarkup(
      <WidgetFieldRenderer
        field={field}
        draft={{ query: { filters: [] } }}
        message={message}
        onChange={() => undefined}
      />
    )

    expect(html).toContain("Add filter")
    expect(html).toContain("Grade value")
    expect(WIDGET_FILTER_SCHEMA.variants.map((item) => item.value)).toContain(
      "passed"
    )
  })

  test("renders a grouping list, and each item's own options with it", () => {
    /**
     * The control that replaced `group-by`.
     *
     * Nothing here is new code — a collection field is rendered by the same editor the
     * filters use — and that is the point worth asserting: the second grouping the model
     * has always allowed is reachable through machinery that already existed, so what
     * needed writing was the schema.
     */
    const field = {
      ...base,
      id: "dimensions",
      path: "analysis.dimensions",
      control: "dimensions",
      messageKey: "widget.field.dimensions",
      required: false,
      options: [],
      collection: {
        ...WIDGET_DIMENSION_SCHEMA,
        variants: WIDGET_DIMENSION_SCHEMA.variants
          .filter((variant) => ["time", "subject"].includes(variant.value))
          .map((variant) => ({
            ...variant,
            // Number controls call `useExtracted`, which throws outside the next-intl
            // compiler — a limit of this harness, not of the control. What is under test
            // here is which fields an item shows, and the choices say that.
            fields: variant.fields.filter((item) => item.control !== "number"),
          })),
      },
    } satisfies WidgetFlowField

    const html = renderToStaticMarkup(
      // A number control inside an item formats its value, and formatting needs a locale.
      <NextIntlClientProvider locale="fr" messages={{}}>
        <WidgetFieldRenderer
          field={field}
          draft={{
            analysis: {
              dimensions: [
                { kind: "time", grain: "week" },
                { kind: "subject", limit: 8 },
              ],
            },
          }}
          message={message}
          onChange={() => undefined}
        />
      </NextIntlClientProvider>
    )

    // Both items, each showing the fields of its own kind and not the other's.
    expect(html).toContain("Time interval")
    expect(html).toContain("Which subjects")
    // Two is the ceiling, so there is nothing more to add — the row that would offer it
    // is gone, which is the collection editor enforcing `maxItems` for free.
    expect(html).not.toContain("Add grouping")

    const room = renderToStaticMarkup(
      <NextIntlClientProvider locale="fr" messages={{}}>
        <WidgetFieldRenderer
          field={field}
          draft={{
            analysis: { dimensions: [{ kind: "time", grain: "week" }] },
          }}
          message={message}
          onChange={() => undefined}
        />
      </NextIntlClientProvider>
    )

    // With room for a second, the add row is back — and it comes with the chooser that
    // says which kind. Which kinds are offered is the flow's answer, asserted where the
    // capability gate lives; a closed select renders only its current value.
    expect(room).toContain("Add grouping")
    expect(room).toContain("Over time")
  })

  test("uses the restricted variants only for adding collection items", () => {
    const subject = WIDGET_DIMENSION_SCHEMA.variants.find(
      (variant) => variant.value === "subject"
    )
    expect(subject).toBeDefined()
    const restricted = {
      ...WIDGET_DIMENSION_SCHEMA,
      addVariants: [subject!],
    }

    expect(
      collectionAddVariants(restricted).map((variant) => variant.value)
    ).toEqual(["subject"])
    expect(
      collectionAddVariants(WIDGET_DIMENSION_SCHEMA).map(
        (variant) => variant.value
      )
    ).toEqual(WIDGET_DIMENSION_SCHEMA.variants.map((variant) => variant.value))
  })
})
