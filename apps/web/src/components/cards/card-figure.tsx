"use client"

import NumberFlow, { type Format } from "@number-flow/react"
import { useLocale } from "next-intl"
import type { WidgetValueType, WidgetVisualization } from "@avermate/core"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { useEnterValue, useEntered } from "@/hooks/use-entered"
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
 *
 * Width and not height, deliberately. A row is as tall as its tallest card, so a
 * two-line card beside a chart has height to spare, and the obvious answer —
 * measure the box, scale the type to it — is the wrong one here: the measurement
 * only exists after the first paint, so every reload would show the small version
 * first and grow. The same trap the ranking's cell count fell into. So the ladders
 * stay declarative, and the *layout* is what spends the leftover height: a body
 * that fills its card distributes its bands rather than stacking them at the top.
 *
 * `READING_TEXT` is the middle rung, for a figure that is the card's answer while
 * something else is its headline — the average under a subject's name. It used to
 * be set at `SUPPORT_TEXT`, which read as a caption on a card with room for three
 * proper bands.
 */
export const VALUE_TEXT =
  "text-3xl font-semibold @[16rem]/card:text-4xl @[26rem]/card:text-5xl"
export const NAME_TEXT =
  "text-xl leading-tight font-semibold @[16rem]/card:text-2xl @[26rem]/card:text-3xl"
export const READING_TEXT =
  "text-2xl leading-none font-semibold @[16rem]/card:text-3xl @[26rem]/card:text-4xl"
export const SUPPORT_TEXT = "text-base @[16rem]/card:text-lg"
export const FOOTNOTE_TEXT = "text-xs @[16rem]/card:text-sm"

/**
 * A category name on a chart axis, cut to the share of the card it may take.
 *
 * Only *sideways* axes need this, and they need it badly: a horizontal bar chart spends its
 * width twice — on the names down the left and on the bars — and the chart reserves whatever
 * the longest name asks for. A subject called "Travaux d'Initiative Personnelle Encadrés —
 * Compétences Transversales" asks for about three hundred and eighty pixels, so on a 228px
 * card the plot was pushed off the right edge entirely: measured on the bench, seven of
 * eight bars one pixel wide at x = 356, and the same for the waterfall's steps.
 *
 * A third of the width for names, and the full name stays in the tooltip. `5.5` is the
 * advance of a character at the 10px these labels are drawn at — the same figure
 * `CHARACTER_WIDTH` uses for the radar's spokes.
 *
 * Vertical axes are left alone on purpose: names under a chart collide rather than steal
 * the plot, and the renderer already thins them.
 */
export function axisNameAtWidth(label: string, width: number): string {
  const budget = Math.max(6, Math.floor((width * 0.34) / 5.5))
  return label.length <= budget
    ? label
    : label.slice(0, budget - 1).trimEnd() + "…"
}

/**
 * Room between a card's bands, up to a point.
 *
 * `justify-between` fills a card the row made a little taller than the content,
 * and ruins one it made much taller: two bands at opposite ends of a 477px card
 * are not a filled card, they are a card with a hole in it. `justify-center`
 * with these between the bands spreads them while the spare height is small and
 * then stops, so the bands stay a block and the block centres. Pure CSS, and so
 * right on the first paint — a measured version of this would be wrong until an
 * effect ran, which is the trap the ranking's cell count fell into.
 */
export function BandGap() {
  return <span aria-hidden className="max-h-5 min-h-0 flex-1" />
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
  format: WidgetVisualization["format"]
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
  difference = false,
  ...rest
}: FigureProps & {
  value: number
  colored?: boolean
  /** A signed movement on the scale, not a level out of that scale. */
  difference?: boolean
}) {
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

  if (difference) {
    return <CardDelta {...rest} delta={enter(value) ?? 0} />
  }

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
  const { valueType, format, scale, defaultDecimals, daysLabel, className } =
    rest
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
      {presentation.unit === "days" ? ` ${daysLabel}` : null}
    </span>
  )
}
