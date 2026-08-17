"use client"

import Link from "next/link"
import NumberFlow, { type Format } from "@number-flow/react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  type ChartPoint,
  type ChartRendererRenderContext,
  areaY,
  barY,
  defineChart,
  dot,
  lineY,
} from "@tanstack/charts"
import { tooltip } from "@tanstack/charts/tooltip"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { curveMonotoneX } from "d3-shape"
import { FlameIcon, TrendingUpIcon } from "lucide-react"
import { useFormatter, useExtracted, useLocale } from "next-intl"
import {
  evaluateCard,
  type CardMetric,
  type CardResult,
  type CardSpec,
} from "@avermate/core"
import { AverageValue, DeltaValue, ResultBadge } from "@/components/data/value"
import { GradeResultBadge } from "@/components/grades/grade-result-badge"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { cardListCellLimit, cardListColumns, limitCardList } from "./card-list"
import { FitSingleLine } from "./fit-single-line"

/**
 * Rendering one dashboard card.
 *
 * The metric is data, so the renderer switches on the *shape* of the result
 * rather than on the metric name. Adding a metric to the engine makes it
 * appear here with no new component.
 */

/**
 * Metric names.
 *
 * A hook rather than a function taking `t`: next-intl rewrites `t("…")` calls
 * where it can see the translator being created, so a helper that receives one
 * as an argument would ship its English source strings untranslated.
 */
export function useMetricLabels(): Record<CardMetric, string> {
  const t = useExtracted()

  return {
    average: t("Average"),
    averageTrend: t("Trend"),
    projection: t("Projected average"),
    gradeCount: t("Grades recorded"),
    lastGrade: t("Latest grade"),
    bestGrade: t("Best grade"),
    worstGrade: t("Lowest grade"),
    bestSubject: t("Strongest subject"),
    worstSubject: t("Weakest subject"),
    subjectRanking: t("Subject ranking"),
    passRate: t("Pass rate"),
    median: t("Median"),
    spread: t("Spread"),
    consistency: t("Consistency"),
    improvement: t("Improvement"),
    mostImproved: t("Most improved"),
    steadiest: t("Steadiest"),
    passStreak: t("Passing streak"),
    activityStreak: t("Activity streak"),
    distribution: t("Distribution"),
    goalProgress: t("Goal"),
  }
}

export function useCardResult(spec: CardSpec, enabled = true): CardResult {
  const { graph, subjects, period, year, passingRatio, goals, resolve, now } =
    useYear()
  const { remaining } = useGoalPlans()

  return useMemo(() => {
    if (!enabled) return { kind: "empty" }
    const from = period.startAt
    const to = new Date(Math.min(now, new Date(period.endAt).getTime()))

    return evaluateCard(spec, {
      graph,
      subjects,
      scope: null,
      from: from > to ? new Date(year?.startsAt ?? from) : from,
      to,
      passingRatio,
      goals,
      remaining,
      // A card shows exactly what it is configured to show.
      resolveTarget: (target) => {
        const resolved = resolve(target)
        if (!resolved) return null
        return { ...resolved, subjects: resolved.graph.subjects }
      },
    })
  }, [
    enabled,
    spec,
    graph,
    subjects,
    period,
    year,
    passingRatio,
    goals,
    resolve,
    remaining,
    now,
  ])
}

/**
 * Type that grows with the card — one step at a time.
 *
 * The grid hands a card anything from a third of a phone to half a desktop,
 * and a number that suits one is lost in the other. Each card is its own query
 * container, so these ladders read the width this card actually got — two
 * neighbouring cards of different spans quite rightly set their figures at
 * different sizes. Two steps and no more: a wide value card gets a bigger
 * figure, not a poster.
 */
const VALUE_TEXT =
  "text-3xl font-semibold @[16rem]/card:text-4xl @[26rem]/card:text-5xl"
const NAME_TEXT =
  "text-lg leading-tight font-semibold @[16rem]/card:text-xl @[26rem]/card:text-2xl"
const SUPPORT_TEXT = "text-sm @[16rem]/card:text-base"
const FOOTNOTE_TEXT = "text-xs @[16rem]/card:text-sm"

interface SparklineDatum {
  x: number
  y: number
  ratio: number
}

/**
 * Card-level dress.
 *
 * Most cards wear the neutral shell, but a live streak changes the whole
 * card, not just its icon: a warm gradient rising from the flame's corner and
 * a ring to match. The grid and the editor preview both apply it, so the card
 * burns the same everywhere.
 */
export function cardSurface(result: {
  kind: string
  alive?: boolean
}): string | undefined {
  return result.kind === "streak" && result.alive === true
    ? "bg-linear-to-tr from-band-weak/15 via-card to-band-fair/10 ring-band-weak/25"
    : undefined
}

/**
 * The entrance: a headline figure mounts at zero and rolls up to its value.
 *
 * NumberFlow only animates *changes*, so the entry is made of one — the first
 * paint shows zero, and the real value lands a frame later on the reel. The
 * same flag drives the gauge bars, whose width transition needs a zero to
 * start from for the same reason.
 */
function useEntered(): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return entered
}

/** A plain figure on the same reel the averages already use. */
function TickNumber({
  value,
  className,
  format,
}: {
  value: number
  className?: string
  format?: Format
}) {
  const locale = useLocale()
  const entered = useEntered()
  return (
    <span className={cn("numeric", className)}>
      {/* NumberFlow paints its digits into a shadow root, which assistive
          technology and copy-paste cannot reach. The reel is decorative;
          this is the value. */}
      <span className="sr-only">{value.toLocaleString(locale, format)}</span>
      <NumberFlow
        aria-hidden
        value={entered ? value : 0}
        locales={locale}
        format={format}
      />
    </span>
  )
}

/**
 * The dot's key never changes, so the renderer moves one circle instead of
 * retiring it and minting a replacement at the new x. That is what lets the
 * CSS pulse keep its phase across a drag: a fresh node restarts every
 * animation on it from frame zero, which reads as a dot that has stopped
 * breathing.
 */
const activeDotKey = () => "active"

function Sparkline({
  points,
  positive,
  onPointFocus,
}: {
  points: Array<{ date: Date; ratio: number | null }>
  positive: boolean
  onPointFocus?: (ratio: number | null) => void
}) {
  const t = useExtracted()
  const renderContextRef =
    useRef<ChartRendererRenderContext<SparklineDatum, number, number>>(
      undefined
    )
  const [focusedPointIndex, setFocusedPointIndex] = useState<number | null>(
    null
  )
  const [isInteracting, setIsInteracting] = useState(false)
  const isInteractingRef = useRef(false)
  /** The day the last tick was spent on, so a step fires exactly one. */
  const focusedIndexRef = useRef<number | null>(null)
  const hasDefaultFocusRef = useRef(false)
  // Read through a ref so a parent that re-creates the callback each render
  // cannot re-run anything here.
  const onPointFocusRef = useRef(onPointFocus)
  useEffect(() => {
    onPointFocusRef.current = onPointFocus
  }, [onPointFocus])

  const data = useMemo(
    () =>
      points
        .filter((point) => point.ratio !== null)
        .map((point) => ({
          x: point.date.getTime(),
          y: point.ratio as number,
          ratio: point.ratio as number,
        })),
    [points]
  )

  const lastPoint = data.at(-1)

  /**
   * Timestamp → position in `data`.
   *
   * Focus reports `datumIndex` relative to whichever mark won the hit test,
   * and the marks here do not share an index space: the dot draws from a
   * one-element array, so it always reports 0. Taken at face value that clips
   * the curve back to the first day, moves the dot there, hands the next hit
   * to the full-length line, and bounces between the two until React gives up
   * with "Maximum update depth exceeded". The x value is the same on every
   * mark, so it is the one identity worth resolving against.
   */
  const indexByX = useMemo(
    () => new Map(data.map((point, index) => [point.x, index])),
    [data]
  )

  /** Parks the reading back on the newest point — the card's resting state. */
  const focusLastPoint = useCallback(() => {
    const context = renderContextRef.current
    const interaction = context?.interaction
    if (!context || !interaction || !lastPoint) return

    const { chart, scales } = context.scene
    const sceneX = scales.x?.map(lastPoint.x)
    const sceneY = scales.y?.map(lastPoint.y)
    if (!Number.isFinite(sceneX) || !Number.isFinite(sceneY)) return

    const rect = context.container.getBoundingClientRect()
    // SAFETY: `Number.isFinite` above rejects both `undefined` (absent scale)
    // and any non-finite mapping, so each is a real number past that guard.
    const resolution = interaction.resolvePointer(
      rect.left + chart.x + (sceneX as number),
      rect.top + chart.y + (sceneY as number)
    )
    if (!resolution) return
    interaction.setControlledFocus(resolution, { source: "programmatic" })
  }, [lastPoint])

  // New series, new story: drop any held reading so the card shows the newest
  // point again rather than a stale index into data that no longer exists.
  // Adjusted during render, not from an effect — a held index against a series
  // that no longer has it must never reach a paint.
  const [lastData, setLastData] = useState(data)
  if (lastData !== data) {
    setLastData(data)
    setFocusedPointIndex(null)
  }

  // The parent is told from an effect, because that is a write to another
  // component and render is not allowed to do it.
  useEffect(() => {
    hasDefaultFocusRef.current = false
    onPointFocusRef.current?.(null)
  }, [data])

  const clippedData = useMemo(() => {
    if (!isInteracting || focusedPointIndex === null) return data
    const end = Math.min(Math.max(focusedPointIndex, 0), data.length - 1)
    return data.slice(0, end + 1)
  }, [data, focusedPointIndex, isInteracting])

  const handleRender = useCallback(
    (context: ChartRendererRenderContext<SparklineDatum, number, number>) => {
      renderContextRef.current = context
      if (hasDefaultFocusRef.current || !lastPoint) return
      hasDefaultFocusRef.current = true
      focusLastPoint()
    },
    [focusLastPoint, lastPoint]
  )

  const handleFocusChange = useCallback(
    (point: ChartPoint<SparklineDatum, number, number> | null) => {
      // Hover is not inspection: only a committed drag moves the reading, so
      // the card does not flicker as the cursor crosses it on its way past.
      if (!isInteractingRef.current || !point) return
      const index = point.datum ? indexByX.get(point.datum.x) : undefined
      if (index === undefined) return
      // One faint tick per day crossed, and only when the day actually
      // changes: the reading snaps between points, so a continuous buzz would
      // describe the finger rather than the data. `selection` is the lightest
      // tone there is, which is what makes a run of them bearable — the firmer
      // one is spent once, on the drag taking hold.
      if (index !== focusedIndexRef.current) {
        focusedIndexRef.current = index
        haptic("selection")
      }
      setFocusedPointIndex((previous) =>
        previous === index ? previous : index
      )
      onPointFocusRef.current?.(data[index]?.ratio ?? null)
    },
    [data, indexByX]
  )

  const handleInspectingChange = useCallback(
    (inspecting: boolean) => {
      isInteractingRef.current = inspecting
      setIsInteracting(inspecting)
      if (inspecting) {
        // The drag has taken hold: one firmer tick, so the gesture announces
        // itself before the per-day ticks start.
        haptic("light")
        focusedIndexRef.current = null
        return
      }
      focusedIndexRef.current = null
      setFocusedPointIndex(null)
      onPointFocusRef.current?.(null)
      // After the release the marks go back to full length; the focus has to
      // be re-placed against that scene, not the clipped one still on screen.
      requestAnimationFrame(focusLastPoint)
    },
    [focusLastPoint]
  )

  const definition = useMemo(() => {
    if (data.length < 2) return null

    const xValues = data.map(({ x }) => x)
    const yValues = data.map(({ y }) => y)
    const xMinimum = Math.min(...xValues)
    const xMaximum = Math.max(...xValues)
    const yMinimum = Math.min(...yValues)
    const yMaximum = Math.max(...yValues)
    const yPadding = Math.max((yMaximum - yMinimum) * 0.05, 0.01)
    const color = positive ? "var(--positive)" : "var(--negative)"
    return defineChart({
      marks: [
        // Drawn short while a drag is in progress: the curve unwrites itself
        // back to the finger, so the card reads as the value *at* that day.
        areaY(clippedData, {
          id: "card-spark-area",
          x: "x",
          y1: yMinimum - yPadding,
          y2: "y",
          key: "x",
          curve: d3Curve(curveMonotoneX),
          fill: "url(#card-spark-fill)",
        }),
        lineY(clippedData, {
          id: "card-spark-line",
          x: "x",
          y: "y",
          key: "x",
          curve: d3Curve(curveMonotoneX),
          stroke: color,
          strokeWidth: 2,
        }),
        // Invisible twin at full length. Focus resolves against every point in
        // the series, so dragging past the clipped end still finds days the
        // drawn curve is no longer showing.
        lineY(data, {
          id: "card-spark-line-interaction",
          x: "x",
          y: "y",
          key: "x",
          curve: d3Curve(curveMonotoneX),
          stroke: "transparent",
          strokeWidth: 2,
          strokeOpacity: 0,
        }),
        // The story does not end at the card's edge: the moving point keeps
        // the reading visible while the drag walks back through the series.
        dot(clippedData.slice(-1), {
          id: "card-spark-active",
          x: "x",
          y: "y",
          key: activeDotKey,
          r: 4.5,
          fill: color,
          stroke: "transparent",
          strokeWidth: 0,
        }),
      ],
      x: {
        scale: scaleLinear().domain(
          xMinimum === xMaximum
            ? [xMinimum - 1, xMaximum + 1]
            : [xMinimum, xMaximum]
        ),
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
          id: "card-spark-fill",
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 1,
          stops: [
            { offset: 0, color, opacity: 0.28 },
            { offset: 1, color, opacity: 0 },
          ],
        },
      ],
      // Flush left and flush at the base, so the fill can pour to the card's
      // bottom edge; on the right the curve pulls up short — the dot ends it
      // with room to breathe, the way a sentence ends before the margin.
      margin: { top: 4, right: 16, bottom: 0, left: 0 },
      // No clip: the plot's clip rect ends exactly where the last point sits,
      // which halved the dot. The curve cannot overdraw its own domain, so
      // nothing else escapes.
      clip: false,
      focus: "nearest",
      // The built-in ring is a `Canvas`-filled circle sitting under the
      // primary point — white on a light card, and reading as a halo the
      // design never asked for. Off at the source; there is no element left
      // for CSS to chase.
      focusRing: false,
      keyboard: false,
    })
  }, [clippedData, data, positive])

  if (!definition) return null

  return (
    // A floor of h-14, then every pixel the row happens to have spare: the
    // curve is the one part of this card that gets better with more room,
    // and letting it drink the surplus is what keeps a chart card from
    // showing a strip of curve above a field of nothing. It bleeds through
    // the card's padding on three sides — the fill pours to the bottom
    // border — because the curve is scenery, and scenery runs to the edge.
    <div
      className={cn(
        "spark-live -mx-4 mt-2 -mb-4 min-h-14 flex-1",
        isInteracting && "spark-live--active"
      )}
    >
      <ResponsiveChart
        ariaLabel={t("Trend")}
        definition={definition}
        dragInspection
        fill
        height={56}
        initialWidth={180}
        onFocusChange={handleFocusChange}
        onInspectingChange={handleInspectingChange}
        onRender={handleRender}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </div>
  )
}

function MiniDistribution({
  ariaLabel,
  buckets,
  scale,
}: {
  ariaLabel: string
  buckets: readonly { from: number; to: number; count: number }[]
  scale: number
}) {
  const t = useExtracted()
  const format = useFormatter()
  const data = useMemo(
    () =>
      buckets.map((bucket) => ({
        label: `${Math.round(bucket.from * scale)}`,
        // The axis shows each bucket's floor; the tooltip owes the full range.
        range: `${format.number(bucket.from * scale, {
          maximumFractionDigits: 0,
        })} – ${format.number(bucket.to * scale, { maximumFractionDigits: 0 })}`,
        count: bucket.count,
      })),
    [buckets, format, scale]
  )
  const maximum = Math.max(1, ...data.map(({ count }) => count))
  const definition = defineChart({
    marks: [
      barY(data, {
        id: "card-distribution",
        x: "label",
        y: "count",
        key: "label",
        fill: "var(--chart-1)",
        radius: 4,
      }),
    ],
    x: {
      scale: scaleBand<string>()
        .domain(data.map(({ label }) => label))
        .padding(0.12),
      grid: false,
      axis: {
        line: false,
        ticks: { size: 0, padding: 6 },
        tickLabels: { fontSize: 10 },
      },
    },
    y: {
      scale: scaleLinear().domain([0, maximum]),
      grid: false,
      axis: false,
    },
    clip: true,
    focus: "nearest",
    keyboard: false,
    tooltip: {
      use: tooltip,
      placement: ["top", "bottom", "left", "right"],
      content: (focused) => {
        const point = focused[0]?.datum
        return {
          title: point?.range,
          rows: point
            ? [
                {
                  color: "var(--chart-1)",
                  label: t("Grades"),
                  value: format.number(point.count),
                },
              ]
            : [],
        }
      },
    },
  })

  return (
    // The histogram is the whole body of its card, so it takes the full
    // height the row resolves to — h-24 is only the floor it insists on.
    <div className="h-full min-h-24 text-muted-foreground">
      <ResponsiveChart
        ariaLabel={ariaLabel}
        definition={definition}
        fill
        height={96}
        initialWidth={220}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </div>
  )
}

/**
 * A ranking sized to its surface.
 *
 * Slicing every list to six rows hid the rest of the year without saying so,
 * and stacked six rows into a column even when the card was half a desktop
 * wide. This list measures the box it was actually given: columns come from
 * the width, the cell count from the height. The card itself only ever asks
 * the grid row for five rows — the ul is absolutely positioned, so revealing
 * more entries into a taller neighbour's row can never inflate that row in
 * return. What still doesn't fit is counted, out loud, by a cell that links
 * to the full ranking. Names stay complete on one line, shrinking a touch
 * when they must, rather than losing their ends to an ellipsis.
 */
const LIST_ROW_HEIGHT = 32
const LIST_ROW_GAP = 4
/** Rows the card asks the grid row for; taller neighbours reveal more. */
const LIST_NATURAL_ROWS = 5

function RankingList({
  items,
}: {
  items: ReadonlyArray<{
    id: string
    label: string
    ratio: number | null
    delta: number | null
  }>
}) {
  const t = useExtracted()
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    if (!node) return
    const measure = () => {
      const next = { width: node.clientWidth, height: node.clientHeight }
      setViewport((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next
      )
    }

    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  const columns = cardListColumns(viewport.width)
  const { visible, remaining } = limitCardList(
    items,
    cardListCellLimit(viewport)
  )

  const naturalRows = Math.min(items.length, LIST_NATURAL_ROWS)
  return (
    <div
      ref={setNode}
      className="relative h-full"
      style={{
        minHeight:
          naturalRows * LIST_ROW_HEIGHT + (naturalRows - 1) * LIST_ROW_GAP,
      }}
    >
      <ul
        className="absolute inset-0 grid content-center overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: LIST_ROW_HEIGHT,
          columnGap: 20,
          rowGap: LIST_ROW_GAP,
        }}
      >
        {visible.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Link href={`/subjects/${item.id}`} className="min-w-0 flex-1">
              <FitSingleLine className="hover:underline">
                {item.label}
              </FitSingleLine>
            </Link>
            {item.ratio !== null ? (
              <AverageValue
                ratio={item.ratio}
                animate={false}
                decimals={1}
                colored
                className="shrink-0 text-sm"
              />
            ) : (
              <DeltaValue delta={item.delta} className="shrink-0 text-sm" />
            )}
          </li>
        ))}
        {remaining > 0 ? (
          <li className="flex min-w-0 items-center text-xs text-muted-foreground">
            <Link href="/subjects" className="min-w-0 flex-1 hover:underline">
              <FitSingleLine>
                {t("+{count} more", { count: String(remaining) })}
              </FitSingleLine>
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

export function CardBody({
  spec,
  result,
}: {
  spec: CardSpec
  result: CardResult
}) {
  const t = useExtracted()
  const { scale, yearGraph } = useYear()
  const format = useFormatter()
  const entered = useEntered()
  /**
   * The reading under the finger while the sparkline is being scrubbed. The
   * chart owns it and hands it up; it resets itself when the series changes,
   * so there is nothing to clear from this side.
   */
  const [focusedRatio, setFocusedRatio] = useState<number | null>(null)
  /** Zero on the first frame, so the reels and gauges have an entrance. */
  const enter = (ratio: number | null) =>
    entered ? ratio : ratio === null ? null : 0

  switch (result.kind) {
    case "empty":
      return (
        <p className="text-sm text-muted-foreground">
          {t("Not enough data yet")}
        </p>
      )

    case "ratio":
      return (
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <AverageValue
              ratio={enter(focusedRatio ?? result.ratio)}
              showScale
              className={VALUE_TEXT}
            />
            {result.delta !== null ? (
              <DeltaValue delta={result.delta} className={SUPPORT_TEXT} />
            ) : null}
          </div>
          {result.series && spec.display !== "value" ? (
            <Sparkline
              points={result.series}
              positive={(result.delta ?? 0) >= 0}
              onPointFocus={setFocusedRatio}
            />
          ) : null}
        </div>
      )

    case "count":
      return (
        <TickNumber value={result.count} className={cn("block", VALUE_TEXT)} />
      )

    case "percent":
      return (
        <div className="flex flex-col gap-2">
          <TickNumber
            value={result.ratio ?? 0}
            className={cn("block", VALUE_TEXT)}
            format={{ style: "percent", maximumFractionDigits: 0 }}
          />
          {spec.display === "gauge" ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted @[20rem]/card:h-2">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{
                  width: `${Math.round((enter(result.ratio) ?? 0) * 100)}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      )

    case "scalar":
      return result.value === null ? (
        <p className={cn("numeric", VALUE_TEXT)}>—</p>
      ) : (
        <TickNumber
          value={result.value * (result.unit === "ratio" ? scale : 1)}
          className={cn("block", VALUE_TEXT)}
          format={{ maximumFractionDigits: 2, signDisplay: "exceptZero" }}
        />
      )

    case "subject":
      return (
        <div className="flex flex-col gap-1">
          {/* The name is the answer this card exists to give, so it wraps
              rather than truncating — "Espagnol" cut to "Espag…" reports
              nothing at all. */}
          <Link
            href={`/subjects/${result.subjectId}`}
            className={cn(NAME_TEXT, "break-words hover:underline")}
          >
            {result.name}
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <AverageValue
              ratio={result.ratio}
              showScale
              colored
              className={SUPPORT_TEXT}
            />
            <DeltaValue delta={result.delta} className={FOOTNOTE_TEXT} />
          </div>
        </div>
      )

    case "grade": {
      const grade = yearGraph
        .byId(result.subjectId)
        ?.grades.find((item) => item.id === result.gradeId)
      return (
        <div className="flex flex-col gap-1">
          <Link
            href={`/grades/${result.gradeId}`}
            className={cn(NAME_TEXT, "break-words hover:underline")}
          >
            {result.name}
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
            {grade ? (
              <GradeResultBadge grade={grade} />
            ) : (
              <ResultBadge ratio={result.ratio} />
            )}
            {/* Wraps rather than truncating: the subject is half the answer. */}
            <span className="min-w-0 break-words">{result.subjectName}</span>
          </div>
          <p className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
            {format.dateTime(result.at, { day: "numeric", month: "long" })}
          </p>
        </div>
      )
    }

    case "list":
      return <RankingList items={result.items} />

    case "distribution":
      return (
        <MiniDistribution
          ariaLabel={t("Distribution")}
          buckets={result.buckets}
          scale={scale}
        />
      )

    case "streak":
      // The streak is the one card that celebrates. A live streak burns: a
      // two-tone flame with a glow behind it, swaying over a warm wash, with
      // embers drifting off the top. A broken one goes grey and holds still —
      // the difference is the message.
      return (
        <div className="relative flex h-full items-center gap-4">
          <span className="relative flex size-14 shrink-0 items-center justify-center @[16rem]/card:size-16">
            {result.alive ? (
              <>
                <FlameIcon
                  aria-hidden
                  fill="currentColor"
                  className="animate-flame absolute size-full text-band-weak opacity-50 blur-lg"
                />
                <span
                  aria-hidden
                  className="animate-ember absolute top-0 left-[30%] size-1 rounded-full bg-band-fair"
                />
                <span
                  aria-hidden
                  className="animate-ember absolute top-1 left-[64%] size-1 rounded-full bg-band-weak"
                  style={{ animationDelay: "0.9s" }}
                />
                <span
                  aria-hidden
                  className="animate-ember absolute top-0 left-[48%] size-0.5 rounded-full bg-band-fair"
                  style={{ animationDelay: "1.7s" }}
                />
              </>
            ) : null}
            <span className={cn("relative", result.alive && "animate-flame")}>
              <FlameIcon
                aria-hidden
                fill="currentColor"
                className={cn(
                  "size-12 @[16rem]/card:size-14",
                  result.alive ? "text-band-weak" : "text-muted-foreground/50"
                )}
              />
              {result.alive ? (
                <FlameIcon
                  aria-hidden
                  fill="currentColor"
                  className="absolute bottom-[8%] left-1/2 size-5 -translate-x-1/2 text-band-fair @[16rem]/card:size-6"
                />
              ) : null}
            </span>
          </span>
          <div className="relative flex min-w-0 flex-col gap-1.5">
            <TickNumber
              value={result.current}
              className={cn(
                VALUE_TEXT,
                "leading-none",
                result.alive && "text-band-weak"
              )}
            />
            <span
              className={cn(
                "self-start rounded-full px-2 py-0.5 text-xs font-medium",
                result.alive
                  ? "bg-band-weak/15 text-band-weak"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {t("best {count}", { count: String(result.longest) })}
            </span>
          </div>
        </div>
      )

    case "goal": {
      const plan = result.plan
      const progress =
        plan.current === null || plan.target === 0
          ? 0
          : Math.min(1, plan.current / plan.target)
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <AverageValue ratio={enter(plan.current)} className={VALUE_TEXT} />
            <span className={cn(SUPPORT_TEXT, "text-muted-foreground")}>
              {t("of")}{" "}
              <AverageValue ratio={plan.target} animate={false} showScale />
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted @[20rem]/card:h-2">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                plan.status === "unreachable" ? "bg-negative" : "bg-primary"
              )}
              style={{
                width: `${Math.round((entered ? progress : 0) * 100)}%`,
              }}
            />
          </div>
          <p
            className={cn(
              FOOTNOTE_TEXT,
              "flex items-center gap-1 text-muted-foreground"
            )}
          >
            <TrendingUpIcon className="size-3.5" />
            {plan.goal.name}
          </p>
        </div>
      )
    }

    default:
      return null
  }
}
