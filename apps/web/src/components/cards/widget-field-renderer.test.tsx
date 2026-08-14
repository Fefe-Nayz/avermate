import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { WidgetFlowField } from "@avermate/core/widget-types"
import { WIDGET_FILTER_SCHEMA } from "@avermate/core/widget-flow-schema"
import { WidgetFieldRenderer } from "./widget-field-renderer"

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
})
