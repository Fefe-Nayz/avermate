"use client"

import NumberFlow, { type Format } from "@number-flow/react"
import { useEffect, useState } from "react"
import { useLocale } from "next-intl"
import type { WidgetValueType, WidgetVisualizationV1 } from "@avermate/core"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { cn } from "@/lib/utils"
import { widgetValuePresentation } from "./widget-view-model"

/**
 * How a card sets a figure, and how it arrives.
 *
 * These were the dashboard's own, and they went out with the renderer they lived
 * in — after which every card drew its number as plain text at a fixed size, with
 * no entrance. The type stopped answering the width it was given and the reels
 * stopped turning. Both are back, and shared now, so a card drawn from a widget
 * definition looks like the card it replaced.
 */

/**
 * Type that grows with the card — one step at a time.
 *
 * The grid hands a card anything from a third of a phone to half a desktop, and a
 * number that suits one is lost in the other. Each card is its own query
 * container, so these ladders read the width *this* card actually got — two
 * neighbouring cards of different spans quite rightly set their figures at
 * different sizes. Two steps and no more: a wide value card gets a bigger figure,
 * not a poster.
 */
export const VALUE_TEXT =
  "text-3xl font-semibold @[16rem]/card:text-4xl @[26rem]/card:text-5xl"
export const NAME_TEXT =
  "text-lg leading-tight font-semibold @[16rem]/card:text-xl @[26rem]/card:text-2xl"
export const SUPPORT_TEXT = "text-sm @[16rem]/card:text-base"
export const FOOTNOTE_TEXT = "text-xs @[16rem]/card:text-sm"

/**
 * The entrance: a headline figure mounts at zero and rolls up to its value.
 *
 * NumberFlow only animates *changes*, so the entry is made of one — the first
 * paint shows zero, and the real value lands a frame later on the reel. The same
 * flag drives the gauge bars, whose width transition needs a zero to start from
 * for the same reason.
 */
export function useEntered(): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return entered
}

/** Zero on the first frame, so the reels and gauges have an entrance. */
export function useEnterValue(): (value: number | null) => number | null {
  const entered = useEntered()
  return (value) => (entered ? value : value === null ? null : 0)
}

/** A plain figure on the same reel the averages already use. */
export function TickNumber({
  value,
  className,
  format,
}: {
  value: number
  className?: string
  format?: Format
}) {
  const locale = useLocale()
  const entered = useEntered()
  return (
    <span className={cn("numeric", className)}>
      {/* NumberFlow paints its digits into a shadow root, which assistive
          technology and copy-paste cannot reach. The reel is decorative;
          this is the value. */}
      <span className="sr-only">{value.toLocaleString(locale, format)}</span>
      <NumberFlow
        aria-hidden
        value={entered ? value : 0}
        locales={locale}
        format={format}
      />
    </span>
  )
}

interface FigureProps {
  valueType: WidgetValueType
  format: WidgetVisualizationV1["format"]
  scale: number
  defaultDecimals: number
  daysLabel: string
  className?: string
}

/**
 * A card's headline figure, whatever the definition measures.
 *
 * The presentation comes from the definition — unit, decimals, compaction — and
 * the *rendering* comes from wherever the app already renders that kind of number.
 * An average is an `AverageValue`, the same component the subject pages and the
 * grade tables use, so it arrives on the same reel with the same "/ 20" and the
 * same band tint. Everything else lands on the plain reel.
 *
 * This is the difference between a card that reads like the rest of the app and
 * one that reads like a report: the widget renderer set every number as static
 * text at a fixed size, so the figures stopped turning and stopped answering the
 * width of the card they were in.
 */
export function CardFigure({
  value,
  colored = false,
  ...rest
}: FigureProps & { value: number; colored?: boolean }) {
  const { valueType, format, scale, defaultDecimals, daysLabel, className } =
    rest
  const presentation = widgetValuePresentation(
    value,
    valueType,
    format,
    scale,
    defaultDecimals
  )
  const enter = useEnterValue()

  if (presentation.unit === "ratio") {
    return (
      <AverageValue
        ratio={enter(value)}
        showScale
        colored={colored}
        decimals={presentation.decimals}
        className={className}
      />
    )
  }
  if (presentation.unit === "percent") {
    // Intl's percent style scales and suffixes in one go, which is how the old
    // pass-rate card was set.
    return (
      <TickNumber
        value={value}
        className={className}
        format={{
          style: "percent",
          minimumFractionDigits: presentation.decimals,
          maximumFractionDigits: presentation.decimals,
        }}
      />
    )
  }
  return (
    <span className={cn("inline-flex items-baseline", className)}>
      <TickNumber
        value={presentation.displayed}
        format={{
          minimumFractionDigits: presentation.decimals,
          maximumFractionDigits: presentation.decimals,
          notation: presentation.compact ? "compact" : "standard",
        }}
      />
      {presentation.unit === "days" ? (
        <span className="ml-1 text-[0.7em] font-normal text-muted-foreground">
          {daysLabel}
        </span>
      ) : null}
    </span>
  )
}

/**
 * The change beside it, in the app's own hand: `±`, `+` or `−` — a real minus
 * sign — and muted, green or red by which way it went.
 */
export function CardDelta({ delta, ...rest }: FigureProps & { delta: number }) {
  const { valueType, format, scale, defaultDecimals, className } = rest
  const locale = useLocale()
  const presentation = widgetValuePresentation(
    delta,
    valueType,
    format,
    scale,
    defaultDecimals
  )

  if (presentation.unit === "ratio") {
    return (
      <DeltaValue
        delta={delta}
        decimals={presentation.decimals}
        className={className}
      />
    )
  }
  return (
    <span
      className={cn(
        "numeric",
        Math.abs(presentation.displayed) < 0.0005
          ? "text-muted-foreground"
          : presentation.displayed > 0
            ? "text-positive"
            : "text-negative",
        className
      )}
    >
      {presentation.displayed > 0
        ? "+"
        : presentation.displayed < 0
          ? "−"
          : "±"}
      {Math.abs(presentation.displayed).toLocaleString(locale, {
        minimumFractionDigits: presentation.decimals,
        maximumFractionDigits: presentation.decimals,
      })}
      {presentation.unit === "percent" ? "%" : null}
    </span>
  )
}
