"use client"

import { useFormatter } from "next-intl"
import type { WidgetValueType, WidgetVisualizationV1 } from "@avermate/core"
import { cn } from "@/lib/utils"
import { widgetValuePresentation } from "./widget-view-model"

export function WidgetNumberText({
  value,
  valueType,
  format,
  scale,
  defaultDecimals,
  daysLabel,
  signed = false,
  showRatioScale = false,
  className,
}: {
  value: number
  valueType: WidgetValueType
  format: WidgetVisualizationV1["format"]
  scale: number
  defaultDecimals: number
  daysLabel: string
  signed?: boolean
  showRatioScale?: boolean
  className?: string
}) {
  const formatter = useFormatter()
  const presentation = widgetValuePresentation(
    value,
    valueType,
    format,
    scale,
    defaultDecimals
  )
  const number = formatter.number(presentation.displayed, {
    minimumFractionDigits: presentation.decimals,
    maximumFractionDigits: presentation.decimals,
    notation: presentation.compact ? "compact" : "standard",
    signDisplay: signed ? "exceptZero" : "auto",
  })

  return (
    <span className={cn("numeric", className)}>
      {number}
      {presentation.unit === "percent" ? "%" : null}
      {presentation.unit === "days" ? ` ${daysLabel}` : null}
      {presentation.unit === "ratio" && showRatioScale ? (
        <span className="ml-1 text-[0.7em] font-normal text-muted-foreground">
          / {formatter.number(scale)}
        </span>
      ) : null}
    </span>
  )
}
