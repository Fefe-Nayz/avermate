"use client"

import { useLocale } from "next-intl"
import { bandOf, type ResultBand } from "@avermate/core"
import { useEntered } from "@/components/cards/card-figure"
import { useYear } from "@/components/year/year-provider"
import { cn } from "@/lib/utils"

/**
 * One result, placed on the year's own scale.
 *
 * The app already sorts every result into five bands — `bandOf` derives them from
 * the year's passing mark, so they hold at 20, at 100 and at a 4-point GPA — but
 * until now those bands only ever showed as the *colour* of a number. Which means
 * the one question a grade page never answered was the first one anybody asks:
 * 14, is that good?
 *
 * Making the bands spatial answers it without a word. The mark sits somewhere
 * along a strip whose colours the reader already knows from every badge in the
 * app, with the averages it should be compared against ticked beside it: above
 * your subject, below your year, still in the green. Nothing here is a new
 * language — it is the existing one, laid out flat.
 */

const BAND_FILL: Record<ResultBand, string> = {
  excellent: "bg-band-excellent/22",
  good: "bg-band-good/22",
  fair: "bg-band-fair/22",
  weak: "bg-band-weak/22",
  poor: "bg-band-poor/22",
}

const BAND_DOT: Record<ResultBand, string> = {
  excellent: "bg-band-excellent",
  good: "bg-band-good",
  fair: "bg-band-fair",
  weak: "bg-band-weak",
  poor: "bg-band-poor",
}

/**
 * The band edges, straight out of `bandOf`'s own arithmetic.
 *
 * Recomputed here rather than hard-coded because the thresholds move with the
 * passing mark: a year that passes at 60% has a different green from one that
 * passes at half. Reading them off the same expression is what keeps the strip
 * and the badges from ever disagreeing about where a colour starts.
 */
function bands(passingRatio: number): Array<{ band: ResultBand; to: number }> {
  const headroom = 1 - passingRatio
  return [
    { band: "poor", to: passingRatio * 0.7 },
    { band: "weak", to: passingRatio },
    { band: "fair", to: passingRatio + headroom * 0.4 },
    { band: "good", to: passingRatio + headroom * 0.7 },
    { band: "excellent", to: 1 },
  ]
}

export interface ScaleMarker {
  id: string
  label: string
  ratio: number
}

export function GradeScale({
  ratio,
  markers = [],
  className,
}: {
  /** The result this strip is about. */
  ratio: number
  /** Averages worth comparing it to — the subject's, the year's. */
  markers?: readonly ScaleMarker[]
  className?: string
}) {
  const locale = useLocale()
  const { scale, decimals, passingRatio } = useYear()
  // The mark travels in from the left edge on the first paint, like every other
  // figure in the app arriving on its reel.
  //
  // It was left out at first on the argument that a marker crossing five colour
  // bands asserts a different verdict at every frame. That is true, and it is
  // the reason the chip rides *with* the marker rather than sitting still while
  // the tick catches up: the number and its position are never out of step, so
  // the intermediate frames read as an arrival rather than as a claim.
  const entered = useEntered()
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const band = bandOf(ratio, passingRatio)
  const shown = (value: number) =>
    (value * scale).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  const segments = bands(passingRatio)
  const ends = [0, scale].map((value) =>
    value.toLocaleString(locale, { maximumFractionDigits: 0 })
  )

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Room above the strip for the mark's own label, which is the one reading
          that has to be findable without looking anywhere else. */}
      <div className="relative pt-7">
        <div
          className="absolute top-0 -translate-x-1/2 transition-[left] duration-700 ease-out"
          style={{ left: `${clamp(entered ? ratio : 0) * 100}%` }}
        >
          <span
            className={cn(
              "numeric block rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap",
              band ? BAND_DOT[band] : "bg-foreground",
              "text-background"
            )}
          >
            {shown(ratio)}
          </span>
        </div>

        <div className="relative flex h-2.5 overflow-hidden rounded-full">
          {segments.map(({ band: segment, to }, index) => (
            <span
              key={segment}
              aria-hidden
              className={BAND_FILL[segment]}
              style={{
                width: `${(to - (segments[index - 1]?.to ?? 0)) * 100}%`,
              }}
            />
          ))}
          {/* The passing mark, as the one line on the strip that is a rule
              rather than a reading. */}
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-foreground/35"
            style={{ left: `${clamp(passingRatio) * 100}%` }}
          />
          {markers.map((marker) => (
            <span
              key={marker.id}
              aria-hidden
              className="absolute inset-y-0 w-0.5 rounded-full bg-foreground/70"
              style={{ left: `${clamp(marker.ratio) * 100}%` }}
            />
          ))}
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 w-1 rounded-full transition-[left] duration-700 ease-out",
              band ? BAND_DOT[band] : "bg-foreground"
            )}
            style={{ left: `${clamp(entered ? ratio : 0) * 100}%` }}
          />
        </div>

        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          {/* Both ends, so the strip says what scale it is drawn on rather than
              leaving the reader to infer it from the numbers on it. */}
          <span className="numeric">{ends[0]}</span>
          <span className="numeric">{ends[1]}</span>
        </div>
      </div>

      {/* The averages are named here rather than beside their ticks: two labels
          positioned on a strip collide as soon as two averages are close, and a
          collision is worse than a legend. The ticks carry the comparison; this
          row carries the values. */}
      {markers.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {markers.map((marker) => (
            <li key={marker.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-0.5 rounded-full bg-foreground/70"
              />
              {marker.label}
              <span className="numeric text-foreground">
                {shown(marker.ratio)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
