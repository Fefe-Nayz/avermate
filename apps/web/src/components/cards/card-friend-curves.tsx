"use client"

import { useMemo } from "react"
import { lineY, type DomChartDefinition } from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * Two averages over the same year.
 *
 * The comparison a single number cannot make: not who is ahead today, but whether the gap
 * has been closing. Two people can end a term at the same average having had completely
 * different years.
 *
 * **Drawn as ratios, labelled in the reader's own marks.** Two people's years need not be
 * marked out of the same number — twenty here, a hundred there — so the curves are plotted
 * on the share of full marks each one is, and only the axis is turned back into a number.
 * Plotting the raw values on one axis would make a 78/100 look like a triumph beside a
 * 15/20 that is worth more.
 *
 * A missing curve is not drawn as a flat line at zero. The friend's history is behind a
 * lock of its own, and a card that filled it in would be inventing a year.
 */

interface CurvePoint {
  key: string
  at: number
  mine: number | null
  theirs: number | null
}

/**
 * The two runs on one axis of time.
 *
 * Sampled independently — each side walks its own year — so the points do not line up.
 * They are merged by timestamp and each side keeps a hole where it has nothing, which is
 * what stops a line being drawn through a week somebody had not started yet.
 */
export function mergeCurves(
  mine: ReadonlyArray<{ at: Date; ratio: number }>,
  theirs: ReadonlyArray<{ at: Date; ratio: number }>
): CurvePoint[] {
  const points = new Map<number, CurvePoint>()
  const put = (
    entries: ReadonlyArray<{ at: Date; ratio: number }>,
    side: "mine" | "theirs"
  ) => {
    for (const entry of entries) {
      const at = entry.at.getTime()
      const existing = points.get(at) ?? {
        key: String(at),
        at,
        mine: null,
        theirs: null,
      }
      existing[side] = entry.ratio
      points.set(at, existing)
    }
  }
  put(mine, "mine")
  put(theirs, "theirs")
  return [...points.values()].sort((left, right) => left.at - right.at)
}

export function CardFriendCurves({
  name,
  mine,
  theirs,
  scale,
  decimals,
  ariaLabel,
}: {
  name: string
  mine: ReadonlyArray<{ at: Date; ratio: number }>
  theirs: ReadonlyArray<{ at: Date; ratio: number }>
  /** The reader's own scale — what the axis is labelled in. */
  scale: number
  decimals: number
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()

  const points = useMemo(() => mergeCurves(mine, theirs), [mine, theirs])

  const definition = useMemo(() => {
    const values = points.flatMap((point) =>
      [point.mine, point.theirs].filter(
        (value): value is number => value !== null
      )
    )
    const span = Math.max(...values) - Math.min(...values)
    const padding = Math.max(span * 0.12, 0.03)
    const lowest = Math.max(0, Math.min(...values) - padding)
    const highest = Math.min(1, Math.max(...values) + padding)
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })

    return curvesChart({
      marks: [
        lineY(
          points.filter((point) => point.theirs !== null),
          {
            id: "card-friend-theirs",
            x: "at",
            y: "theirs",
            key: "key",
            stroke: "var(--muted-foreground)",
            strokeWidth: 1.5,
            // Dashed and thinner: the reader's own year is the subject of the card, and
            // two identical lines would leave them hunting for which one is theirs.
            strokeDasharray: "4 3",
          }
        ),
        lineY(
          points.filter((point) => point.mine !== null),
          {
            id: "card-friend-mine",
            x: "at",
            y: "mine",
            key: "key",
            stroke: "var(--chart-1)",
            strokeWidth: 2,
          }
        ),
      ],
      x: {
        scale: scaleLinear().domain([
          points[0]?.at ?? 0,
          points[points.length - 1]?.at ?? 1,
        ]),
        grid: false,
        axis: false,
      },
      y: {
        scale: scaleLinear().domain([lowest, highest]),
        grid: true,
        axis: {
          line: false,
          ticks: { size: 0, padding: 6, format: mark },
          tickLabels: { fontSize: 10 },
        },
      },
      clip: true,
      focus: "nearest",
      focusRing: false,
      keyboard: false,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (focused: Array<{ datum?: CurvePoint }>) => {
          const point = focused[0]?.datum
          if (!point) return { title: "", rows: [] }
          return {
            title: format.dateTime(new Date(point.at), {
              day: "numeric",
              month: "short",
            }),
            rows: [
              ...(point.mine === null
                ? []
                : [
                    {
                      color: "var(--chart-1)",
                      label: t("You"),
                      value: mark(point.mine),
                    },
                  ]),
              ...(point.theirs === null
                ? []
                : [
                    {
                      color: "var(--muted-foreground)",
                      label: name,
                      value: mark(point.theirs),
                    },
                  ]),
            ],
          }
        },
      },
    })
  }, [decimals, format, name, points, scale, t])

  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  return (
    <figure className="flex h-full min-h-0 flex-col gap-1">
      <div className="min-h-16 flex-1 text-muted-foreground">
        <ResponsiveChart
          ariaLabel={ariaLabel}
          definition={definition}
          fill
          height={140}
          initialWidth={240}
          updateTransition={INSTANT_CHART_UPDATES}
        />
      </div>
      {/* Which line is whose, and — quietly — that the two are drawn as shares of full
          marks rather than as raw numbers. */}
      <figcaption
        className={cn(
          FOOTNOTE_TEXT,
          "flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground"
        )}
      >
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-0.5 w-3 shrink-0 rounded-full"
            style={{ background: "var(--chart-1)" }}
          />
          {t("You")}
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-0.5 w-3 shrink-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, var(--muted-foreground) 0 4px, transparent 4px 7px)",
            }}
          />
          <span className="line-clamp-1">{name}</span>
        </span>
      </figcaption>
    </figure>
  )
}

/** Cast for the same reason as `bandChart`: the marks are built from data. */
function curvesChart(
  definition: unknown
): DomChartDefinition<CurvePoint, number, number> {
  return definition as DomChartDefinition<CurvePoint, number, number>
}
