"use client"

import { useMemo } from "react"
import { barX, ruleX, type DomChartDefinition } from "@tanstack/charts"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import {
  RESIDUAL_KEY,
  type ContributionStep,
  type WaterfallResult,
} from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { CardAccessibleSummary } from "./card-accessible-summary"
import { axisNameAtWidth } from "./card-figure"

/**
 * Why the average moved, as the steps that moved it.
 *
 * Horizontal, one row per cause: subject names are words, and words read across. Each
 * bar spans from where the running total stood to where that step left it, so the
 * drawing *is* the arithmetic — the bars end where the next begins and the last lands
 * on the new average.
 *
 * Three rules the honesty of the chart rests on:
 *
 * - The steps come from `contributionBreakdown`, where they are guaranteed to sum to
 *   the change. Nothing here rescales them to fit.
 * - Folding the tail into "everything else" keeps that guarantee: the folded row
 *   carries the *sum* of what it replaced, so the total is untouched and only the
 *   naming is lost.
 * - A step the decomposition could not explain is drawn as itself, labelled as
 *   unexplained, rather than quietly folded in with the rest.
 */

export interface WaterfallRow {
  key: string
  label: string
  start: number
  end: number
  delta: number
  role: ContributionStep["role"] | "total"
}

/**
 * The rows to draw: the biggest causes, the rest folded, and the two totals.
 *
 * The fold is re-chained rather than summed in place — its `start` is where the last
 * named step ended and its `end` is the final value — which is what keeps the drawing
 * continuous. `steps` counts named causes, so a fold and the totals are extra.
 */
export function waterfallRows(
  result: WaterfallResult,
  steps: number,
  showTotals: boolean,
  labels: { start: string; end: string; rest: string; unexplained: string }
): WaterfallRow[] {
  const named = result.steps.slice(0, Math.max(1, steps))
  const folded = result.steps.slice(Math.max(1, steps))
  const rows: WaterfallRow[] = []

  if (showTotals) {
    rows.push({
      key: "__start__",
      label: labels.start,
      start: 0,
      end: result.startValue,
      delta: result.startValue,
      role: "total",
    })
  }
  for (const step of named) {
    rows.push({
      key: step.key,
      label: step.key === RESIDUAL_KEY ? labels.unexplained : step.label,
      start: step.start,
      end: step.end,
      delta: step.delta,
      role: step.role,
    })
  }
  if (folded.length > 0) {
    // The sum of what it replaced, so the total survives the fold.
    const delta = folded.reduce((sum, step) => sum + step.delta, 0)
    const start = named.at(-1)?.end ?? result.startValue
    rows.push({
      key: "__rest__",
      label: labels.rest,
      start,
      end: start + delta,
      delta,
      role: delta >= 0 ? "increase" : "decrease",
    })
  }
  if (showTotals) {
    rows.push({
      key: "__end__",
      label: labels.end,
      start: 0,
      end: result.endValue,
      delta: result.endValue,
      role: "total",
    })
  }
  return rows
}

export function CardWaterfall({
  result,
  steps,
  showTotals,
  scale,
  decimals,
  ariaLabel,
}: {
  result: WaterfallResult
  steps: number
  showTotals: boolean
  scale: number
  decimals: number
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()

  const rows = useMemo(
    () =>
      waterfallRows(result, steps, showTotals, {
        start: t("Before"),
        end: t("After"),
        rest: t("Everything else"),
        unexplained: t("Unexplained"),
      }),
    [result, showTotals, steps, t]
  )
  const exactValues = rows.map((row) => {
    const step = result.steps.find((item) => item.key === row.key)
    const shown = format.number(row.delta * scale, {
      maximumFractionDigits: decimals + 1,
      signDisplay: row.role === "total" ? "auto" : "always",
    })
    const weighting =
      step && Math.abs(step.weightEffect) > 1e-9
        ? `, ${t("of which weighting")} ${format.number(
            step.weightEffect * scale,
            {
              maximumFractionDigits: decimals + 1,
              signDisplay: "always",
            }
          )}`
        : ""
    return `${row.label}: ${row.role === "total" ? t("Average") : t("Effect")} ${shown}${weighting}`
  })

  const definition = useMemo(() => {
    const values = rows.flatMap((row) => [row.start, row.end])
    const lowest = Math.min(0, ...values)
    const highest = Math.max(...values)
    const colourOf = (role: WaterfallRow["role"]) =>
      role === "total"
        ? "var(--muted-foreground)"
        : role === "residual"
          ? "var(--band-weak)"
          : role === "increase"
            ? "var(--positive)"
            : "var(--negative)"
    return waterfallChart({
      /**
       * Measured rather than static, because the label budget is a share of the
       * card's own width: a fixed character count is either a smear on a phone or
       * a needless truncation on a wide card.
       */
      chart: ({ width }: { width: number }) => ({
        marks: [
          /**
           * Where the average stood before anything moved: the line every step is read
           * against.
           *
           * `ruleX`, because this waterfall is *horizontal* — the steps run along x and the
           * y axis is a band of names. As a `ruleY` it asked a band scale of strings where
           * 0.783 sits, got nothing, and rendered `y1="NaN"`: a one-pixel line the browser
           * refused, so the baseline this card is read against was never on it.
           */
          ruleX([{ x: result.startValue }], {
            id: "card-waterfall-baseline",
            x: "x",
            stroke: "var(--border)",
            strokeWidth: 1,
            strokeDasharray: "3 3",
          }),
          barX(rows, {
            id: "card-waterfall",
            x1: "start",
            x2: "end",
            y: "label",
            key: "key",
            fill: (row: WaterfallRow) => colourOf(row.role),
            radius: 2,
            inset: 3,
          }),
        ],
        scales: {
          x: {
            scale: scaleLinear().domain([lowest, highest]),
            grid: true,
            axis: {
              line: false,
              ticks: {
                size: 0,
                padding: 6,
                format: (value: number) =>
                  format.number(value * scale, { maximumFractionDigits: 0 }),
              },
              tickLabels: { fontSize: 10 },
            },
          },
          y: {
            scale: scaleBand<string>()
              .domain(rows.map((row) => row.label))
              .padding(0.18),
            grid: false,
            axis: {
              line: false,
              // The names, cut to their share of the card — see `waterfallLabel`. Without a
              // format the axis reserves whatever the longest one needs, and one long subject
              // name takes the whole plot with it.
              ticks: {
                size: 0,
                format: (label: string) => axisNameAtWidth(label, width),
              },
              tickLabels: { fontSize: 10 },
            },
          },
        },
        clip: true,
      }),
      focus: "nearest",
      focusRing: true,
      keyboard: true,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (focused: Array<{ datum?: WaterfallRow }>) => {
          const row = focused[0]?.datum
          if (!row) return { title: "", rows: [] }
          const step = result.steps.find((item) => item.key === row.key)
          return {
            title: row.label,
            rows: [
              {
                color: colourOf(row.role),
                label: row.role === "total" ? t("Average") : t("Effect"),
                value: format.number(row.delta * scale, {
                  maximumFractionDigits: decimals + 1,
                  signDisplay: row.role === "total" ? "auto" : "always",
                }),
              },
              // The split the decomposition already carries: how much of the effect
              // was the marks moving, and how much was the weighting changing.
              ...(step && Math.abs(step.weightEffect) > 1e-9
                ? [
                    {
                      color: "var(--muted-foreground)",
                      label: t("of which weighting"),
                      value: format.number(step.weightEffect * scale, {
                        maximumFractionDigits: decimals + 1,
                        signDisplay: "always",
                      }),
                    },
                  ]
                : []),
            ],
          }
        },
      },
    })
  }, [decimals, format, result, rows, scale, t])

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  return (
    <figure className="h-full min-h-32 text-muted-foreground">
      <CardAccessibleSummary items={exactValues} />
      <ResponsiveChart
        ariaLabel={ariaLabel}
        definition={definition}
        fill
        height={180}
        initialWidth={280}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </figure>
  )
}

/**
 * The config, cast rather than inferred — the same trick, and for the same reason, as
 * `dynamicChart` in `widget-view`: the marks are built from a result at runtime, so
 * the channel generics cannot be resolved statically.
 */
function waterfallChart(
  definition: unknown
): DomChartDefinition<WaterfallRow, number, string> {
  return definition as DomChartDefinition<WaterfallRow, number, string>
}
