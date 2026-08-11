"use client"

import { useMemo } from "react"
import { areaY, defineChart, lineY } from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { curveMonotoneX } from "d3-shape"
import { useExtracted } from "next-intl"
import { SubjectGraph, type Grade, type Subject } from "@avermate/core"
import { ResponsiveChart } from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"

/**
 * A worked example on the landing page.
 *
 * Built from the real engine rather than mocked-up pixels: what a visitor sees
 * here is arithmetically what they would get, which is the only honest way to
 * demonstrate a calculator.
 */

const SCALE = 20

function grade(
  subjectId: string,
  value: number,
  day: number,
  coefficient = 1
): Grade {
  const passedAt = new Date(2025, 8, 1)
  passedAt.setDate(passedAt.getDate() + day)
  return {
    id: `${subjectId}-${day}`,
    name: "",
    value,
    outOf: 20,
    coefficient,
    passedAt,
    createdAt: passedAt,
    subjectId,
    periodId: null,
    components: [],
  }
}

function subject(
  id: string,
  name: string,
  coefficient: number,
  parentId: string | null,
  kind: Subject["kind"],
  grades: Grade[]
): Subject {
  return {
    id,
    name,
    shortName: null,
    parentId,
    coefficient,
    kind,
    isMain: false,
    sortOrder: 0,
    grades,
  }
}

function LandingSparkline({
  ariaLabel,
  data,
}: {
  ariaLabel: string
  data: readonly { x: number; y: number }[]
}) {
  if (data.length < 2) return null

  const xMinimum = Math.min(...data.map(({ x }) => x))
  const xMaximum = Math.max(...data.map(({ x }) => x))
  const yMinimum = Math.min(...data.map(({ y }) => y))
  const yMaximum = Math.max(...data.map(({ y }) => y))
  const yPadding = Math.max((yMaximum - yMinimum) * 0.05, 0.1)
  const definition = defineChart({
    marks: [
      areaY(data, {
        id: "landing-preview-area",
        x: "x",
        y1: yMinimum - yPadding,
        y2: "y",
        key: "x",
        curve: d3Curve(curveMonotoneX),
        fill: "url(#landing-fill)",
      }),
      lineY(data, {
        id: "landing-preview-line",
        x: "x",
        y: "y",
        key: "x",
        curve: d3Curve(curveMonotoneX),
        stroke: "var(--chart-1)",
        strokeWidth: 2,
      }),
    ],
    x: {
      scale: scaleLinear().domain([xMinimum, xMaximum]),
      grid: false,
      axis: false,
    },
    y: {
      scale: scaleLinear().domain([yMinimum - yPadding, yMaximum + yPadding]),
      grid: false,
      axis: false,
    },
    gradients: [
      {
        id: "landing-fill",
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 1,
        stops: [
          { offset: 0, color: "var(--chart-1)", opacity: 0.3 },
          { offset: 1, color: "var(--chart-1)", opacity: 0 },
        ],
      },
    ],
    margin: 0,
    clip: true,
    focus: false,
    keyboard: false,
    pointer: false,
  })

  return (
    <ResponsiveChart
      ariaLabel={ariaLabel}
      definition={definition}
      height={56}
      initialWidth={160}
    />
  )
}

export function LandingPreview() {
  const t = useExtracted()

  const { graph, series } = useMemo(() => {
    const subjects: Subject[] = [
      subject("science", t("Sciences"), 1, null, "category", []),
      subject("maths", t("Maths"), 5, "science", "subject", [
        grade("maths", 14, 12),
        grade("maths", 16, 40, 2),
        grade("maths", 13, 78),
      ]),
      subject("physics", t("Physics"), 3, "science", "subject", [
        grade("physics", 11, 20),
        grade("physics", 15, 62),
      ]),
      subject("languages", t("Languages"), 1, null, "category", []),
      subject("english", t("English"), 2, "languages", "subject", [
        grade("english", 17, 30),
        grade("english", 15, 70),
      ]),
      subject("sport", t("Sport"), 1, null, "subject", [
        grade("sport", 18, 55),
      ]),
    ]

    const graph = new SubjectGraph(subjects)

    const points: Array<{ x: number; y: number }> = []
    for (let day = 10; day <= 90; day += 5) {
      const cutoff = new Date(2025, 8, 1)
      cutoff.setDate(cutoff.getDate() + day)
      const snapshot = subjects.map((item) => ({
        ...item,
        grades: item.grades.filter(
          (candidate) => candidate.passedAt.getTime() <= cutoff.getTime()
        ),
      }))
      const ratio = new SubjectGraph(snapshot).ratio(null)
      if (ratio !== null) points.push({ x: day, y: ratio * SCALE })
    }

    return { graph, series: points }
  }, [t])

  const rows = graph
    .flatten()
    .map((item) => ({ subject: item, ratio: graph.ratio(item.id) }))

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <div>
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("General average")}
          </p>
          <p className="numeric text-3xl font-semibold">
            {((graph.ratio(null) ?? 0) * SCALE).toFixed(2)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              / {SCALE}
            </span>
          </p>
        </div>
        <div aria-hidden="true" className="ml-auto h-14 w-40">
          <LandingSparkline ariaLabel={t("General average")} data={series} />
        </div>
      </div>

      <ul>
        {rows.map(({ subject: item, ratio }, index) => {
          const isCategory = item.kind === "category"
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-3 px-5 py-2.5",
                index > 0 && "border-t",
                isCategory && "bg-muted/40"
              )}
              style={{
                paddingInlineStart: `${1.25 + graph.depthOf(item.id) * 1}rem`,
              }}
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  isCategory
                    ? "text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    : "text-sm"
                )}
              >
                {item.name}
              </span>
              {!isCategory && item.coefficient !== 1 ? (
                <span className="numeric rounded border border-dashed px-1 text-[11px] text-muted-foreground">
                  ×{item.coefficient}
                </span>
              ) : null}
              <span className="numeric text-sm font-medium">
                {ratio === null ? "—" : (ratio * SCALE).toFixed(2)}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        {t(
          "Sciences is a category: Maths and Physics are weighed one by one at the top, not averaged together first."
        )}
      </p>
    </section>
  )
}
