"use client"

import NumberFlow from "@number-flow/react"
import { useLocale } from "next-intl"
import { bandOf, type Ratio, type ResultBand } from "@avermate/core"
import { cn } from "@/lib/utils"
import { useYear } from "@/components/year/year-provider"

/**
 * How a number appears.
 *
 * Averages animate between values — when a coefficient moves, watching the
 * general average slide is the feedback that makes the weighting legible.
 * Figures are tabular so nothing shifts while they do.
 */

const BAND_TEXT: Record<ResultBand, string> = {
  excellent: "text-band-excellent",
  good: "text-band-good",
  fair: "text-band-fair",
  weak: "text-band-weak",
  poor: "text-band-poor",
}

const BAND_BG: Record<ResultBand, string> = {
  excellent: "bg-band-excellent/12 text-band-excellent",
  good: "bg-band-good/12 text-band-good",
  fair: "bg-band-fair/14 text-band-fair",
  weak: "bg-band-weak/14 text-band-weak",
  poor: "bg-band-poor/14 text-band-poor",
}

export function useScale() {
  const { scale, decimals, passingRatio } = useYear()
  return { scale, decimals, passingRatio }
}

interface AverageProps {
  ratio: Ratio
  className?: string
  /** Show the "/ 20" suffix. */
  showScale?: boolean
  /** Tint the number by result band. */
  colored?: boolean
  animate?: boolean
  decimals?: number
  placeholder?: string
}

export function AverageValue({
  ratio,
  className,
  showScale = false,
  colored = false,
  animate = true,
  decimals,
  placeholder = "—",
}: AverageProps) {
  const locale = useLocale()
  const { scale, decimals: defaultDecimals, passingRatio } = useScale()
  const digits = decimals ?? defaultDecimals

  if (ratio === null) {
    return (
      <span className={cn("numeric text-muted-foreground", className)}>
        {placeholder}
      </span>
    )
  }

  const value = ratio * scale
  const band = bandOf(ratio, passingRatio)
  const formatted = value.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

  return (
    <span
      className={cn(
        "numeric inline-flex items-baseline gap-1",
        colored && band ? BAND_TEXT[band] : undefined,
        className
      )}
    >
      {animate ? (
        <>
          {/* NumberFlow paints its digits into a shadow root, which assistive
              technology and copy-paste cannot reach. The reel is decorative;
              this is the value. */}
          <span className="sr-only">
            {showScale
              ? `${formatted} / ${scale.toLocaleString(locale)}`
              : formatted}
          </span>
          <NumberFlow
            aria-hidden
            value={value}
            locales={locale}
            format={{
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            }}
          />
        </>
      ) : (
        formatted
      )}
      {showScale ? (
        <span
          aria-hidden={animate ? true : undefined}
          className="text-[0.7em] font-normal text-muted-foreground"
        >
          / {scale.toLocaleString(locale)}
        </span>
      ) : null}
    </span>
  )
}

export function ResultBadge({
  ratio,
  className,
  showScale = true,
}: {
  ratio: Ratio
  className?: string
  showScale?: boolean
}) {
  const { passingRatio } = useScale()
  const band = bandOf(ratio, passingRatio)

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-sm font-medium",
        band ? BAND_BG[band] : "bg-muted text-muted-foreground",
        className
      )}
    >
      <AverageValue
        ratio={ratio}
        showScale={showScale}
        animate={false}
        className="gap-0.5"
      />
    </span>
  )
}

/** A signed change, phrased on the year's scale rather than as a percentage. */
export function DeltaValue({
  delta,
  className,
  decimals,
  neutralThreshold = 0.0005,
}: {
  delta: number | null
  className?: string
  decimals?: number
  neutralThreshold?: number
}) {
  const locale = useLocale()
  const { scale, decimals: defaultDecimals } = useScale()
  const digits = decimals ?? defaultDecimals

  if (delta === null) {
    return <span className={cn("text-muted-foreground", className)}>—</span>
  }

  const value = delta * scale
  const neutral = Math.abs(delta) < neutralThreshold
  const formatted = Math.abs(value).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

  return (
    <span
      className={cn(
        "numeric",
        neutral
          ? "text-muted-foreground"
          : value > 0
            ? "text-positive"
            : "text-negative",
        className
      )}
    >
      {neutral ? "±" : value > 0 ? "+" : "−"}
      {formatted}
    </span>
  )
}

/** Raw points as entered, e.g. "14 / 20". Never normalised. */
export function PointsValue({
  value,
  outOf,
  className,
}: {
  value: number
  outOf: number
  className?: string
}) {
  const locale = useLocale()
  const show = (input: number) =>
    input.toLocaleString(locale, { maximumFractionDigits: 2 })

  return (
    <span className={cn("numeric", className)}>
      {show(value)}
      <span className="text-muted-foreground"> / {show(outOf)}</span>
    </span>
  )
}

export function CoefficientBadge({
  coefficient,
  className,
}: {
  coefficient: number
  className?: string
}) {
  const locale = useLocale()
  if (coefficient === 1) return null

  return (
    <span
      className={cn(
        "numeric rounded border border-dashed px-1 text-[11px] leading-4 text-muted-foreground",
        className
      )}
    >
      ×{coefficient.toLocaleString(locale, { maximumFractionDigits: 2 })}
    </span>
  )
}
