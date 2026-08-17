"use client"

import { defineChart } from "@tanstack/charts"
import { tooltip } from "@tanstack/charts/tooltip"
import { useExtracted, useFormatter } from "next-intl"
import { useMemo, useState } from "react"
import { INSTANT_CHART_UPDATES, ResponsiveChart } from "./responsive-chart"
import { radarSpec, type RadarPoint } from "./subject-radar-spec"
import { Card, CardContent } from "@/components/ui/card"
import { useYear } from "@/components/year/year-provider"

/** The headline subjects on one comparable radial scale. */
export function SubjectRadarChart({ title }: { title: string }) {
  const t = useExtracted()
  const format = useFormatter()
  const { graph, scale } = useYear()

  const points = useMemo<RadarPoint[]>(
    () =>
      graph.subjects.flatMap((subject) => {
        if (!subject.isMain) return []
        const ratio = graph.ratio(subject.id)
        return ratio === null
          ? []
          : [
              {
                subject: subject.shortName ?? subject.name,
                value: ratio * scale,
              },
            ]
      }),
    [graph, scale]
  )

  /**
   * The subject under the pointer.
   *
   * Held here because the spec cannot ask: no radial mark takes a focus state
   * and no channel is told what is focused, so the host reports focus to React
   * and React hands it back to the spec. That is what draws the active point —
   * see `radarSpec`. The definition is rebuilt on each focus change, which is
   * seven subjects' worth of layout and lands instantly because
   * `INSTANT_CHART_UPDATES` leaves nothing to tween.
   */
  const [focusedSubject, setFocusedSubject] = useState<string | null>(null)

  const definition = useMemo(
    () =>
      defineChart({
        chart: ({ width, height }) =>
          radarSpec({
            points,
            scale,
            width,
            height,
            formatValue: (value) => format.number(value),
            focusedSubject,
          }),
        focus: "nearest",
        // The renderer's built-in focus ring is a `Canvas`-filled circle under
        // the primary point — white on a light card, and reading as a halo the
        // design never asked for. Off everywhere, not just on the sparkline.
        // The radar's own active point above replaces it; turning this off
        // without one is what had left this chart with no active point at all.
        focusRing: false,
        svgAnimation: {
          duration: 240,
          easing: "ease-out",
          respectReducedMotion: true,
          resize: false,
        },
        tooltip: {
          use: tooltip,
          placement: ["top", "right", "left", "bottom"],
          content: (focused) => {
            const point = focused[0]?.datum
            return {
              title: point?.subject,
              rows: point
                ? [
                    {
                      color: "var(--chart-1)",
                      label: t("Average"),
                      value: format.number(point.value, {
                        maximumFractionDigits: 2,
                      }),
                    },
                  ]
                : [],
            }
          },
        },
      }),
    [focusedSubject, format, points, scale, t]
  )

  if (points.length < 3) return null

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <h3 className="px-1 text-sm font-medium">{title}</h3>
      <Card className="min-h-0 flex-1 gap-2 py-4">
        {/* The ring is bound by the shorter side of its box, so height buys
            label room as directly as width does. */}
        <CardContent className="h-[340px] px-2 text-muted-foreground">
          <ResponsiveChart
            ariaDescription={t(
              "Comparison of the current averages for your main subjects."
            )}
            ariaLabel={title}
            definition={definition}
            entrance="rise"
            height={340}
            initialWidth={360}
            onFocusChange={(point) =>
              setFocusedSubject(point?.datum?.subject ?? null)
            }
            updateTransition={INSTANT_CHART_UPDATES}
          />
        </CardContent>
      </Card>
    </section>
  )
}
