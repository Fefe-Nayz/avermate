"use client"

import { defineChart } from "@tanstack/charts"
import { tooltip } from "@tanstack/charts/tooltip"
import { useExtracted, useFormatter } from "next-intl"
import { useMemo } from "react"
import { ResponsiveChart } from "./responsive-chart"
import { radarSpec, type RadarPoint } from "./subject-radar-spec"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

  const definition = useMemo(
    () =>
      defineChart({
        chart: ({ width }) =>
          radarSpec({
            points,
            scale,
            width,
            formatValue: (value) => format.number(value),
          }),
        focus: "nearest",
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
    [format, points, scale, t]
  )

  if (points.length < 3) return null

  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      {/* The ring is bound by the shorter side of its box, so height buys
          label room as directly as width does. */}
      <CardContent className="h-[340px] px-2 text-muted-foreground">
        <ResponsiveChart
          ariaDescription={t(
            "Comparison of the current averages for your main subjects."
          )}
          ariaLabel={title}
          definition={definition}
          height={340}
          initialWidth={360}
        />
      </CardContent>
    </Card>
  )
}
