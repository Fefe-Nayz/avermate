"use client"

import Link from "next/link"
import type { Impact } from "@avermate/core"
import { useExtracted } from "next-intl"
import {
  AverageValue,
  DeltaValue,
  NEUTRAL_DELTA,
} from "@/components/data/value"
import { useEntered } from "@/hooks/use-entered"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * The magnitude a row contributes to the shared scale — zero if it did not move.
 *
 * Anything under `NEUTRAL_DELTA` counts as no movement, and it has to, because
 * comparing against exact zero was wrong in the way that matters. An average is a
 * sum of quotients: remove a grade, recompute, add it back, and the float that
 * comes out differs from the one that went in by about `1e-16`. Every impact on a
 * page where a grade changes nothing was therefore a *different* tiny non-zero
 * number — and a scale normalised on the largest of them turned that noise into a
 * full-length bar, with the rest ranked neatly underneath it. Five rows reading
 * `±0.00` and `14.01 → 14.01`, each with a confident red bar of its own length.
 *
 * So the threshold is the one the number beside it uses. The bar and the figure now
 * agree by construction: no bar can appear next to a `±`.
 */
export function impactMagnitude(delta: number | null): number {
  if (delta === null) return 0
  const magnitude = Math.abs(delta)
  return magnitude < NEUTRAL_DELTA ? 0 : magnitude
}

/**
 * How much of a row's half-track one impact fills, as a percentage.
 *
 * `scale` is the largest magnitude in the list, so the lengths are comparable to
 * each other rather than each to itself — which is the whole reason the bars exist.
 * Half the track is one direction, so the biggest impact fills its side exactly.
 *
 * The floor is deliberate. An impact of 0.004 against a scale of 0.44 is half a
 * percent of the track — a fraction of a pixel, indistinguishable from no bar at
 * all — and the row would then read as if the grade had not moved that average. It
 * did; the stub says so.
 */
export function impactBarShare(delta: number | null, scale: number): number {
  const magnitude = impactMagnitude(delta)
  if (magnitude === 0 || scale <= 0) return 0
  return Math.max(2, (magnitude / scale) * 50)
}

export interface ImpactReading {
  href?: string
  id: string
  impact: Impact
  label: string
}

/**
 * One value's effect on every average it touches, as rows on a shared scale.
 *
 * This was a grid of cards, one per scope, each with its own large delta. Which
 * gave the smallest reading exactly the same visual weight as the largest — and
 * these readings differ by an order of magnitude, because that is what an impact
 * *is*: a grade moves its subject a lot, its parent less, the year least. Six
 * bordered boxes made the reader gather six numbers and do the comparison in their
 * head, when the comparison is the whole point.
 *
 * So: rows, and a bar per row measured against the largest impact in the list.
 * Sign becomes direction, magnitude becomes length, and the attenuation is a shape
 * rather than arithmetic. Not a table — a list, like every other stack of readings
 * in this app; the rows are readings, not records with columns to sort.
 */
export function ImpactGrid({
  readings,
  title,
  order = "given",
}: {
  readings: readonly ImpactReading[]
  title: string
  /**
   * How to sequence the rows.
   *
   * `given` keeps the caller's order, which is the right answer wherever that
   * order means something — on a grade or a subject it is the cascade outwards,
   * narrowest scope first, and the bars then shorten down the list.
   *
   * `magnitude` sorts by the size of the effect, for a list of peers where the
   * caller's order carries nothing: the subjects contributing to one average have
   * no natural sequence, so the largest contribution goes first.
   */
  order?: "given" | "magnitude"
}) {
  const t = useExtracted()
  // Bars grow out of the centre on the first paint, for the same reason the reels
  // start at zero and the gauge fills: a bar that is simply *there* never moved.
  const entered = useEntered()
  const available = readings.filter(
    (reading) =>
      reading.impact.withValue !== null || reading.impact.withoutValue !== null
  )
  if (available.length === 0) return null

  const magnitude = (reading: ImpactReading) =>
    impactMagnitude(reading.impact.delta)
  const rows =
    order === "magnitude"
      ? [...available].sort((left, right) => magnitude(right) - magnitude(left))
      : available
  // The scale every bar is drawn against, so the lengths are comparable to each
  // other rather than each to itself. Zero when nothing moved by an amount anyone
  // could read, which is then the one case with no bars to draw and no division.
  const scale = Math.max(...rows.map(magnitude))

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium">{title}</h2>
      <Card className="py-4">
        <CardContent className="px-4">
          <ul className="flex flex-col gap-2">
            {rows.map((reading) => {
              const delta = reading.impact.delta
              const share = impactBarShare(delta, scale)

              return (
                <li
                  key={reading.id}
                  className="flex items-center gap-3 border-b pb-2 last:border-0 last:pb-0"
                >
                  <span className="min-w-0 flex-[2] truncate text-sm">
                    {reading.href ? (
                      <Link href={reading.href} className="hover:underline">
                        {reading.label}
                      </Link>
                    ) : (
                      reading.label
                    )}
                  </span>

                  {/* The bar is scenery for the number beside it, so it is hidden
                      from assistive technology and dropped first when the pane is
                      too narrow to make a length worth reading.

                      Three things make it read as a mark rather than as a progress
                      bar. The track is a faint groove instead of a grey slab,
                      because the ink belongs on the data and there is a lot of
                      track per row. The bar is rounded only on its *outer* end —
                      the end at the axis is flat, so it looks anchored to zero
                      rather than floating near it, which is what a pill did to
                      short bars. And it fades outward from the axis, the same
                      gradient language the sparkline fills and the streak surface
                      already use: the colour is strongest where the movement
                      started.

                      Fading also settles the loudest problem, which was colour
                      said twice. The delta beside it is already green or red, so a
                      bar at full saturation on every row put two shouts on one
                      line; this keeps the hue and gives up the shouting. */}
                  <span
                    aria-hidden
                    className="relative hidden h-2 min-w-0 flex-1 rounded-full bg-muted/40 @sm/main:block"
                  >
                    <span className="absolute -inset-y-1 left-1/2 w-px -translate-x-1/2 rounded-full bg-foreground/20" />
                    {share > 0 ? (
                      <span
                        className={cn(
                          "absolute inset-y-0 transition-[width] duration-500",
                          (delta as number) > 0
                            ? "rounded-r-full bg-linear-to-r from-positive to-positive/45"
                            : "rounded-l-full bg-linear-to-l from-negative to-negative/45"
                        )}
                        style={{
                          [(delta as number) > 0 ? "left" : "right"]: "50%",
                          width: `${entered ? share : 0}%`,
                        }}
                      />
                    ) : null}
                  </span>

                  {/* The signed number sits against the bar, because the two say
                      one thing twice — a length and a figure — and splitting them
                      put the reader's eye across the row to check that the bar it
                      just read was the number it was looking for. */}
                  <DeltaValue
                    delta={delta}
                    className="w-14 shrink-0 text-right text-sm font-semibold"
                  />

                  {/* Where the average was and where it is, last: it is the
                      working behind the change rather than the reading, and it is
                      the first thing a narrow pane can do without. */}
                  <span
                    className="numeric hidden shrink-0 text-right text-xs text-muted-foreground @2xl/main:inline"
                    aria-label={t("Average without and with this value")}
                  >
                    <AverageValue
                      ratio={reading.impact.withoutValue}
                      animate={false}
                      decimals={2}
                    />
                    {" → "}
                    <AverageValue
                      ratio={reading.impact.withValue}
                      animate={false}
                      decimals={2}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
