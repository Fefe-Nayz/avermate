"use client"

import { defineChart } from "@tanstack/charts"
import {
  angleGrid,
  polar,
  radialArea,
  radialGrid,
} from "@tanstack/charts/polar"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { scalePoint } from "@tanstack/charts/scales/point"
import { tooltip } from "@tanstack/charts/tooltip"
import { curveLinearClosed } from "d3-shape"
import { useExtracted, useFormatter } from "next-intl"
import { useMemo } from "react"
import { ResponsiveChart } from "./responsive-chart"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useYear } from "@/components/year/year-provider"

interface RadarPoint {
  subject: string
  value: number
}

/**
 * Turn a label to lie along the ring rather than across it.
 *
 * Straight from the previous app, unchanged: the two folds keep every name
 * the right way up, so nothing on the left half reads upside down.
 */
function labelRotation(angle: number) {
  let rotation = (angle * 180) / Math.PI
  if (rotation > 180) rotation -= 360
  if (rotation > 90) rotation -= 180
  else if (rotation < -90) rotation += 180
  return rotation
}

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

  const definition = useMemo(() => {
    const domain = points.map((point) => point.subject)

    return defineChart({
      chart: ({ width }) => {
        // The label treatment is the previous app's, kept to the number: a
        // ring that gives up a little radius on a narrow card, a character
        // budget stepped by width, and the tangential rotation above. Deriving
        // the radius from the longest name instead — which is what this did —
        // bought a few characters and cost the shape most of its size, and the
        // shape is the reason a radar is here rather than a list.
        const maxLength = width < 300 ? 5 : width < 440 ? 9 : 12
        return {
          marks: [
            polar({
              id: "main-subject-radar",
              radiusRatio: width < 360 ? 0.64 : 0.72,
              angle: {
                scale: scalePoint<string>().domain(domain),
                wrap: true,
              },
              radius: { scale: scaleLinear().domain([0, scale]) },
              guides: [
                radialGrid({
                  values: [scale * 0.25, scale * 0.5, scale * 0.75, scale],
                  shape: "polygon",
                  stroke: "currentColor",
                  strokeOpacity: 0.2,
                }),
                angleGrid({
                  labels: true,
                  format: (value) => {
                    const label = String(value)
                    return label.length > maxLength
                      ? `${label.slice(0, maxLength)}…`
                      : label
                  },
                  labelFill: "currentColor",
                  labelFontSize: 12,
                  labelOffset: 8,
                  labelRotate: ({ angle }) => labelRotation(angle),
                  stroke: "currentColor",
                  strokeOpacity: 0.2,
                }),
              ],
              marks: [
                radialArea(points, {
                  angle: "subject",
                  radius: "value",
                  key: "subject",
                  curve: curveLinearClosed,
                  fill: "var(--chart-1)",
                  fillOpacity: 0.1,
                  stroke: "var(--chart-1)",
                  strokeWidth: 2,
                }),
              ],
            }),
          ],
        }
      },
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
    })
  }, [format, points, scale, t])

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
