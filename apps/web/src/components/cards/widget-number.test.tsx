import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import { WidgetNumberText } from "./widget-number"

const autoFormat = {
  decimals: null,
  unit: "auto",
  compact: false,
} as const

function renderNumber(
  props: Partial<React.ComponentProps<typeof WidgetNumberText>> &
    Pick<React.ComponentProps<typeof WidgetNumberText>, "value" | "valueType">
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={{}}>
      <WidgetNumberText
        format={autoFormat}
        scale={20}
        defaultDecimals={2}
        daysLabel="days"
        {...props}
      />
    </NextIntlClientProvider>
  )
}

describe("widget number renderer", () => {
  test("formats percent deltas in displayed units", () => {
    expect(
      renderNumber({ value: 0.1, valueType: "percent", signed: true })
    ).toContain(">+10%</span>")
  })

  test("honours explicit decimals and ratio scale labels", () => {
    const html = renderNumber({
      value: 0.85,
      valueType: "ratio",
      showRatioScale: true,
      format: { ...autoFormat, decimals: 1 },
    })
    expect(html).toContain("17.0")
    expect(html).toContain("/ 20")
  })

  test("adds the localized days suffix", () => {
    expect(renderNumber({ value: 4, valueType: "days" })).toContain(
      ">4 days</span>"
    )
  })
})
