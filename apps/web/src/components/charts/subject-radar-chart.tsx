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

/** Gap between the outer ring and a name. */
const LABEL_OFFSET = 8
/** Breathing room kept between the longest name and the edge of the card. */
const LABEL_PADDING = 6
const LABEL_FONT_SIZE = 12
/** Advance width of a character, as a fraction of the font size. */
const CHARACTER_WIDTH = 0.6

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
      chart: ({ width, height }) => {
        // The ring is the previous app's, to the number.
        const radiusRatio = width < 360 ? 0.64 : 0.72

        // The budget for a name is not. A ladder stepped by width alone does
        // not know how much room is actually left outside the ring, and the
        // ring is bound by the *shorter* side of the box — so on a card
        // narrower than the one that ladder was tuned against, every label on
        // the right ran off the edge. This measures the gap instead: labels
        // lie along the ring, so the room a name has is what the shorter side
        // has left over, and a name is cut to fit it rather than to a number.
        const half = Math.min(width, height) / 2
        const room = half - half * radiusRatio - LABEL_OFFSET - LABEL_PADDING
        const maxLength = Math.max(
          5,
          Math.floor(room / (LABEL_FONT_SIZE * CHARACTER_WIDTH))
        )

        return {
          marks: [
            polar({
              id: "main-subject-radar",
              radiusRatio,
              angle: {
                scale: scalePoint<string>().domain(domain),
                wrap: true,
              },
              radius: { scale: scaleLinear().domain([0, scale]) },
              guides: [
                // The rings carry their own values along one spoke. Without
                // them a radar is a shape with no units: you can see that one
                // subject is further out than another and not what either is.
                radialGrid({
                  values: [0, scale * 0.25, scale * 0.5, scale * 0.75, scale],
                  shape: "polygon",
                  stroke: "currentColor",
                  strokeOpacity: 0.2,
                  labels: true,
                  format: (value) => format.number(Number(value)),
                  labelAngle: 90,
                  labelOffset: 6,
                  labelFill: "currentColor",
                  labelFontSize: 10,
                  labelClassName: "opacity-60",
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
                  labelFontSize: LABEL_FONT_SIZE,
                  labelOffset: LABEL_OFFSET,
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
