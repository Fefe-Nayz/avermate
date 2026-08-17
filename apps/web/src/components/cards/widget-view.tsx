"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  FlameIcon,
  MinusIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"
import {
  areaY,
  barX,
  barY,
  dot,
  group,
  lineY,
  ruleX,
  ruleY,
  stack,
  type DomChartDefinition,
} from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { curveLinear, curveMonotoneX, curveStep } from "d3-shape"
import { useFormatter, useExtracted } from "next-intl"
import {
  WIDGET_GAUGE_THICKNESS,
  type WidgetDefinitionV1,
  type WidgetEvaluationResult,
  type WidgetSeriesDatum,
  type WidgetValueType,
  type WidgetVisualizationV1,
} from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { AverageValue, DeltaValue, ResultBadge } from "@/components/data/value"
import { GradeResultBadge } from "@/components/grades/grade-result-badge"
import { useStatusLabel } from "@/components/goals/goal-strip"
import { useYear } from "@/components/year/year-provider"
import { cn } from "@/lib/utils"
import { AVERAGE_SERIES_COLORS } from "@/components/charts/multi-series-average-chart"
import {
  CardDelta,
  CardFigure,
  FOOTNOTE_TEXT,
  NAME_TEXT,
  SUPPORT_TEXT,
  TickNumber,
  useEnterValue,
  useEntered,
  VALUE_TEXT,
} from "./card-figure"
import { MiniDistribution } from "./card-distribution"
import { RankingList } from "./card-ranking"
import { WidgetNumberText } from "./widget-number"
import { Sparkline } from "./widget-sparkline"
import {
  widgetColorBucketKey,
  widgetColorBuckets,
  widgetDefinitionShowsDelta,
  widgetDisplayValue as displayValue,
  widgetEncodedScaleValue,
  widgetEncodedSeriesDatum,
  widgetEncodedThresholdColor,
  widgetEncodingValueType,
  widgetGaugeFillRatio,
  widgetGoalPresentation,
  widgetNumericDomain,
  widgetSeriesDomainValues,
  widgetThresholdColor,
  widgetValuePresentation,
} from "./widget-view-model"

function useShownWidgetValueFormatter(
  visualization: WidgetVisualizationV1,
  scale: number,
  defaultDecimals: number
) {
  const format = useFormatter()
  const t = useExtracted()

  return (shown: number, valueType: WidgetValueType) => {
    const presentation = widgetValuePresentation(
      0,
      valueType,
      visualization.format,
      scale,
      defaultDecimals
    )
    const number = format.number(shown, {
      minimumFractionDigits: presentation.decimals,
      maximumFractionDigits: presentation.decimals,
      notation: presentation.compact ? "compact" : "standard",
    })
    if (presentation.unit === "percent") return `${number}%`
    if (presentation.unit === "days") return `${number} ${t("days")}`
    if (presentation.unit === "ratio") {
      return `${number} / ${format.number(scale)}`
    }
    return number
  }
}

export function WidgetBody({
  definition,
  result,
  expanded = false,
}: {
  definition: WidgetDefinitionV1
  result: WidgetEvaluationResult
  expanded?: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, passingRatio } = useYear()
  const showDelta = widgetDefinitionShowsDelta(definition)

  if (result.kind === "empty") {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  if (result.kind === "structured") {
    return (
      <WidgetStructuredResult
        result={result.value}
        visualization={definition.visualization}
        showDelta={showDelta}
      />
    )
  }

  if (result.kind === "distribution") {
    if (definition.visualization.mark === "boxplot") {
      return (
        <WidgetBoxPlot
          summary={result.summary}
          visualization={definition.visualization}
        />
      )
    }
    // The dashboard's own histogram, unless the card is a study: bars on the
    // chart accent, bucket floors on the x-axis and nothing else, the full range
    // owed to the tooltip. The generic chart spells out every boundary and adds a
    // y-axis and a grid, which is a study where a shape was wanted.
    if (!expanded && definition.visualization.mark === "histogram") {
      return (
        <MiniDistribution
          ariaLabel={t("Distribution")}
          buckets={result.buckets}
          scale={scale}
        />
      )
    }
    const values = result.buckets.map((bucket) => ({
      key: `${bucket.from}:${bucket.to}`,
      label: `${format.number(bucket.from * scale, { maximumFractionDigits: 0 })}–${format.number(bucket.to * scale, { maximumFractionDigits: 0 })}`,
      date: null,
      value: bucket.count,
      delta: null,
      count: bucket.count,
      series: null,
      good: bucket.from >= passingRatio,
    }))
    return (
      <WidgetSeriesChart
        values={values}
        valueType="count"
        visualization={definition.visualization}
        height={expanded ? 300 : 170}
      />
    )
  }

  if (result.kind === "series") {
    if (definition.visualization.mark === "heatmap") {
      return (
        <WidgetHeatmap
          values={result.values}
          valueType={result.valueType}
          visualization={definition.visualization}
        />
      )
    }
    if (definition.visualization.mark === "table") {
      const rows =
        definition.visualization.options.kind === "table" ||
        definition.visualization.options.kind === "list"
          ? definition.visualization.options.rows
          : 10
      return (
        <WidgetSeriesTable
          values={result.values.slice(0, rows)}
          valueType={result.valueType}
          visualization={definition.visualization}
          showDelta={showDelta}
        />
      )
    }
    if (definition.visualization.mark === "list") {
      const rows =
        definition.visualization.options.kind === "list"
          ? definition.visualization.options.rows
          : 10
      // A ranking of subjects is the dashboard's list, which measures the box it
      // was given — columns from the width, cells from the height — rather than
      // stacking a fixed six rows down a card that is half a desktop wide, and
      // counts what did not fit out loud. It only stands in where the rows *are*
      // subjects, because it links each one to its page.
      if (!expanded && definition.analysis.groupBy.kind === "subject") {
        return (
          <RankingList
            items={result.values.map((item) => ({
              id: item.key,
              label: item.label,
              ratio: result.valueType === "ratio" ? item.value : null,
              delta: item.delta,
            }))}
          />
        )
      }
      return (
        <WidgetSeriesList
          values={result.values.slice(0, rows)}
          valueType={result.valueType}
          visualization={definition.visualization}
          showDelta={showDelta}
        />
      )
    }
    // A card that plots a value over time says what the value is. Only the
    // insights surface skips it, because there the chart *is* the subject —
    // a card is a glance, a study is a study.
    if (!expanded && result.values.some((item) => item.date !== null)) {
      return (
        <WidgetTrend
          values={result.values}
          valueType={result.valueType}
          visualization={definition.visualization}
        />
      )
    }
    return (
      <WidgetSeriesChart
        values={result.values}
        valueType={result.valueType}
        visualization={definition.visualization}
        height={expanded ? 320 : 170}
      />
    )
  }

  return (
    <WidgetScalarValue
      value={result.value}
      valueType={result.valueType}
      delta={result.delta}
      visualization={definition.visualization}
    />
  )
}

/**
 * A line with no axes and no grid is a sparkline, and a sparkline is scenery for
 * a reading rather than a chart in its own right.
 *
 * Read off the definition rather than carried as a separate mark: "sparkline" was
 * never a different *kind* of drawing, it was a line stripped of its apparatus,
 * and the apparatus is already in the model. So a card asks for one by turning the
 * axes off, and the editor's existing axis toggles turn a card into one either
 * way — which is a nicer thing to have discovered than a twelfth mark.
 */
function widgetIsSparkline(visualization: WidgetVisualizationV1): boolean {
  return (
    (visualization.mark === "line" || visualization.mark === "area") &&
    !visualization.axes.x.visible &&
    !visualization.axes.y.visible &&
    !visualization.axes.x.grid &&
    !visualization.axes.y.grid
  )
}

/**
 * The card the dashboard used to have: the reading, its change, and the curve
 * that got there.
 *
 * Routing these through the generic series chart lost both halves of it. The
 * chart drew axes, a y-grid and dated ticks in a 170px box — a study squeezed into
 * a glance — and, worse, dropped the number entirely, because a series result has
 * no scalar to show. A card whose whole job is to say "13.86" stopped saying it.
 *
 * So the value comes back to the top and the curve goes below it. Which curve is
 * the definition's business, not this component's: a stripped line is drawn as a
 * sparkline that takes every remaining pixel and follows the finger, and a line
 * that kept its axes is drawn as the small chart it asked to be. Either way the
 * card answers the question first.
 */
function WidgetTrend({
  values,
  valueType,
  visualization,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualizationV1
}) {
  const t = useExtracted()
  const { scale, decimals } = useYear()
  /** The reading under the finger; the chart owns it and hands it up. */
  const [focused, setFocused] = useState<number | null>(null)

  const points = useMemo(
    () =>
      values.flatMap((item) =>
        item.date ? [{ date: item.date, value: item.value }] : []
      ),
    [values]
  )
  const last = [...values].reverse().find((item) => item.value !== null)
  if (!last || last.value === null) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  const shown = focused ?? last.value
  /**
   * How far the reading has moved across the window — the current value against
   * the first point on the curve.
   *
   * Not the datum's own `delta`, which a plain series leaves null: that field is
   * filled by `analysis.comparison`, and a comparison would mean "against the
   * previous week", a different question. This is the number the card showed
   * before, to the definition: `ratio - first`.
   *
   * It stays put while the curve is dragged. The reading above it moves, because
   * that is the day under the finger; the change over the window does not, because
   * the window has not moved.
   */
  const first = values.find((item) => item.value !== null)?.value ?? null
  const delta = last.delta ?? (first === null ? null : last.value - first)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <CardFigure
          value={shown}
          valueType={valueType}
          format={visualization.format}
          scale={scale}
          defaultDecimals={decimals}
          daysLabel={t("days")}
          className={VALUE_TEXT}
        />
        {delta !== null ? (
          <CardDelta
            delta={delta}
            valueType={valueType}
            format={visualization.format}
            scale={scale}
            defaultDecimals={decimals}
            daysLabel={t("days")}
            className={SUPPORT_TEXT}
          />
        ) : null}
      </div>
      {widgetIsSparkline(visualization) ? (
        <Sparkline
          points={points}
          positive={(delta ?? 0) >= 0}
          onPointFocus={setFocused}
        />
      ) : (
        // Shorter than a chart that owns its card, because here it does not: the
        // reading above it has taken its share of the row.
        <div className="mt-2">
          <WidgetSeriesChart
            values={values}
            valueType={valueType}
            visualization={visualization}
            height={130}
          />
        </div>
      )}
    </div>
  )
}

function WidgetStructuredResult({
  result,
  visualization,
  showDelta,
}: {
  result: Extract<WidgetEvaluationResult, { kind: "structured" }>["value"]
  visualization: WidgetVisualizationV1
  showDelta: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const statusLabel = useStatusLabel()
  const { yearGraph } = useYear()
  const entered = useEntered()
  const enter = useEnterValue()
  if (result.kind === "empty") {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }
  if (result.kind === "grade") {
    const grade = yearGraph
      .byId(result.subjectId)
      ?.grades.find((item) => item.id === result.gradeId)
    return (
      <div className="flex flex-col gap-1">
        {/* The name is the answer this card exists to give, so it wraps rather
            than truncating, and it is a way in to the grade itself. */}
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
  if (result.kind === "subject") {
    if (result.ratio === null) {
      return (
        <p className="text-sm text-muted-foreground">
          {t("Not enough data yet")}
        </p>
      )
    }
    return (
      <div className="flex flex-col gap-1">
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
  }
  if (result.kind === "streak") {
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
  }
  if (result.kind === "goal") {
    const goal = widgetGoalPresentation(result.plan)
    if (!goal.hasCurrent) {
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-medium break-words">
              {result.plan.goal.name}
            </p>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {statusLabel(goal.status)}
            </span>
          </div>
          <p
            className={cn(
              FOOTNOTE_TEXT,
              "flex items-baseline gap-1.5 text-muted-foreground"
            )}
          >
            {t("target")}
            <AverageValue
              ratio={goal.target}
              animate={false}
              showScale
              className={cn(SUPPORT_TEXT, "font-medium text-foreground")}
            />
          </p>
        </div>
      )
    }
    const progress =
      result.plan.current === null || result.plan.target === 0
        ? 0
        : Math.min(1, result.plan.current / result.plan.target)
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <AverageValue ratio={enter(goal.current)} className={VALUE_TEXT} />
          <span className={cn(SUPPORT_TEXT, "text-muted-foreground")}>
            {t("of")}{" "}
            <AverageValue
              ratio={result.plan.target}
              animate={false}
              showScale
            />
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted @[20rem]/card:h-2">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              result.plan.status === "unreachable"
                ? "bg-negative"
                : "bg-primary"
            )}
            style={{ width: `${Math.round((entered ? progress : 0) * 100)}%` }}
          />
        </div>
        <p
          className={cn(
            FOOTNOTE_TEXT,
            "flex items-center gap-1 text-muted-foreground"
          )}
        >
          <TrendingUpIcon className="size-3.5" />
          {result.plan.goal.name} · {statusLabel(goal.status)}
        </p>
      </div>
    )
  }
  if (result.kind === "list") {
    return (
      <WidgetSeriesList
        values={result.items.map((item) => ({
          key: item.id,
          label: item.label,
          date: null,
          value: item.ratio ?? item.delta,
          delta: item.delta,
          count: 0,
          series: null,
        }))}
        valueType="ratio"
        visualization={visualization}
        showDelta={showDelta}
      />
    )
  }
  return null
}

function WidgetScalarValue({
  value,
  valueType,
  delta,
  visualization,
  gaugeMaximum: defaultGaugeMaximum,
  footer,
  compact = false,
}: {
  value: number
  valueType: WidgetValueType
  delta: number | null
  visualization: WidgetVisualizationV1
  gaugeMaximum?: number
  footer?: string
  compact?: boolean
}) {
  const t = useExtracted()
  const { scale, decimals } = useYear()
  const gauge = visualization.mark === "gauge"
  const gaugeMinimum = visualization.scale.y.min ?? 0
  const gaugeMaximum =
    visualization.scale.y.max ??
    defaultGaugeMaximum ??
    (valueType === "percent" || valueType === "ratio" ? 1 : Math.max(1, value))
  const gaugeRatio = widgetGaugeFillRatio(
    value,
    gaugeMinimum,
    gaugeMaximum,
    visualization.scale.y.reverse
  )
  const valueOptions =
    visualization.options.kind === "value" ? visualization.options : null
  const gaugeOptions =
    visualization.options.kind === "gauge" ? visualization.options : null
  const gaugeThickness = gaugeOptions?.thickness ?? WIDGET_GAUGE_THICKNESS
  const showValue = !gauge || gaugeOptions?.showValue !== false
  const showDelta = valueOptions?.showDelta === true && delta !== null
  const showTrend = valueOptions?.trendIndicator === true && delta !== null
  const threshold = [...visualization.thresholds]
    .sort((left, right) => left.value - right.value)
    .findLast((item) => value >= item.value)
  // The bar grows from nothing on the first paint, for the same reason the reels
  // start at zero: a gauge that is simply *there* at 68% never says it filled.
  const entered = useEntered()
  const figure = {
    valueType,
    format: visualization.format,
    scale,
    defaultDecimals: decimals,
    daysLabel: t("days"),
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      {showValue ? (
        <div
          className="flex items-center gap-2"
          style={{ color: threshold?.color ?? undefined }}
        >
          <CardFigure
            {...figure}
            value={value}
            className={cn(compact ? SUPPORT_TEXT : VALUE_TEXT, "font-semibold")}
          />
          {showTrend ? <TrendIndicator delta={delta as number} /> : null}
        </div>
      ) : null}
      {showDelta ? (
        <CardDelta
          {...figure}
          delta={delta as number}
          className={SUPPORT_TEXT}
        />
      ) : null}
      {threshold?.label ? (
        <p className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {threshold.label}
        </p>
      ) : null}
      {gauge ? (
        // A hairline that thickens once the card is wide enough, not a pipe: the
        // number is the answer and the bar is its margin note. A card that asked
        // for a particular thickness is honoured literally; the default value
        // means "the card's own bar", which no single number could say.
        <div
          className={cn(
            "overflow-hidden rounded-full bg-muted",
            gaugeThickness === WIDGET_GAUGE_THICKNESS &&
              "h-1.5 @[20rem]/card:h-2"
          )}
          style={
            gaugeThickness === WIDGET_GAUGE_THICKNESS
              ? undefined
              : { height: gaugeThickness }
          }
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{
              width: `${Math.round((entered ? gaugeRatio : 0) * 100)}%`,
              backgroundColor: threshold?.color ?? undefined,
            }}
          />
        </div>
      ) : null}
      {footer ? (
        <p className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>{footer}</p>
      ) : null}
    </div>
  )
}

function WidgetSeriesList({
  values,
  valueType,
  visualization,
  showDelta = false,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualizationV1
  showDelta?: boolean
}) {
  const t = useExtracted()
  const { scale, decimals } = useYear()
  const showValues =
    visualization.options.kind !== "list" || visualization.options.showValues
  return (
    <ul className="divide-y">
      {values.map((item) => (
        <li
          key={item.key}
          className="flex min-h-10 items-center gap-3 py-2 text-sm"
          style={{
            color:
              item.value === null
                ? undefined
                : (widgetThresholdColor(item.value, visualization.thresholds) ??
                  undefined),
          }}
        >
          <span className="min-w-0 flex-1 break-words">{item.label}</span>
          {showValues &&
          (item.value !== null || (showDelta && item.delta !== null)) ? (
            <span className="flex shrink-0 items-baseline gap-2">
              {item.value !== null ? (
                <WidgetNumberText
                  value={item.value}
                  valueType={valueType}
                  format={visualization.format}
                  scale={scale}
                  defaultDecimals={decimals}
                  daysLabel={t("days")}
                  className="font-medium"
                />
              ) : null}
              {showDelta && item.delta !== null ? (
                <WidgetNumberText
                  value={item.delta}
                  valueType={valueType}
                  format={visualization.format}
                  scale={scale}
                  defaultDecimals={decimals}
                  daysLabel={t("days")}
                  signed
                  className="text-xs text-muted-foreground"
                />
              ) : null}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function WidgetSeriesTable({
  values,
  valueType,
  visualization,
  showDelta = false,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualizationV1
  showDelta?: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, decimals } = useYear()
  const hasDelta = showDelta && values.some((item) => item.delta !== null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">{t("Name")}</th>
            <th className="pb-2 text-right font-medium">{t("Value")}</th>
            {hasDelta ? (
              <th className="pb-2 text-right font-medium">{t("Change")}</th>
            ) : null}
            <th className="pb-2 text-right font-medium">{t("Count")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {values.map((item) => (
            <tr key={item.key}>
              <td className="min-w-0 py-2 pr-3">{item.label}</td>
              <td
                className="numeric py-2 text-right font-medium"
                style={{
                  color:
                    item.value === null
                      ? undefined
                      : (widgetThresholdColor(
                          item.value,
                          visualization.thresholds
                        ) ?? undefined),
                }}
              >
                {item.value === null ? (
                  "-"
                ) : (
                  <WidgetNumberText
                    value={item.value}
                    valueType={valueType}
                    format={visualization.format}
                    scale={scale}
                    defaultDecimals={decimals}
                    daysLabel={t("days")}
                  />
                )}
              </td>
              {hasDelta ? (
                <td className="py-2 text-right text-muted-foreground">
                  {item.delta === null ? (
                    "-"
                  ) : (
                    <WidgetNumberText
                      value={item.delta}
                      valueType={valueType}
                      format={visualization.format}
                      scale={scale}
                      defaultDecimals={decimals}
                      daysLabel={t("days")}
                      signed
                    />
                  )}
                </td>
              ) : null}
              <td className="numeric py-2 text-right text-muted-foreground">
                {format.number(item.count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TrendIndicator({ delta }: { delta: number }) {
  const t = useExtracted()
  const Icon =
    delta > 0 ? TrendingUpIcon : delta < 0 ? TrendingDownIcon : MinusIcon
  return (
    <Icon
      className="size-5 shrink-0 text-muted-foreground"
      aria-label={
        delta > 0
          ? t("Trending up")
          : delta < 0
            ? t("Trending down")
            : t("No change")
      }
    />
  )
}

function WidgetBoxPlot({
  summary,
  visualization,
}: {
  summary: {
    min: number
    q1: number
    median: number
    q3: number
    max: number
    outliers: number[]
  }
  visualization: WidgetVisualizationV1
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale } = useYear()
  const shown = {
    min: displayValue(summary.min, "ratio", visualization.format.unit, scale),
    q1: displayValue(summary.q1, "ratio", visualization.format.unit, scale),
    median: displayValue(
      summary.median,
      "ratio",
      visualization.format.unit,
      scale
    ),
    q3: displayValue(summary.q3, "ratio", visualization.format.unit, scale),
    max: displayValue(summary.max, "ratio", visualization.format.unit, scale),
  }
  const configuredMin =
    visualization.scale.y.min === null
      ? null
      : displayValue(
          visualization.scale.y.min,
          "ratio",
          visualization.format.unit,
          scale
        )
  const configuredMax =
    visualization.scale.y.max === null
      ? null
      : displayValue(
          visualization.scale.y.max,
          "ratio",
          visualization.format.unit,
          scale
        )
  const [minimum, maximum] = widgetNumericDomain(
    [shown.min, shown.max],
    visualization.scale.y.zero,
    configuredMin,
    configuredMax
  )
  const range = Math.max(Number.EPSILON, maximum - minimum)
  const offset = (value: number) => {
    const ratio = Math.max(0, Math.min(1, (value - minimum) / range))
    return `${(visualization.scale.y.reverse ? 1 - ratio : ratio) * 100}%`
  }
  const boxStart = Number.parseFloat(offset(shown.q1))
  const boxEnd = Number.parseFloat(offset(shown.q3))
  const decimals = visualization.format.decimals ?? 2
  const showOutliers =
    visualization.options.kind === "boxplot" &&
    visualization.options.showOutliers

  return (
    <figure
      className="flex min-h-36 flex-col justify-center gap-4"
      aria-label={t("Box plot")}
    >
      <div className="relative mx-2 h-14">
        <div className="absolute top-1/2 right-0 left-0 h-px bg-border" />
        {visualization.axes.y.grid
          ? [0.25, 0.5, 0.75].map((position) => (
              <span
                key={position}
                className="absolute top-0 bottom-0 border-l border-dashed border-border"
                style={{ left: `${position * 100}%` }}
              />
            ))
          : null}
        {visualization.thresholds.map((threshold, index) => {
          const value = displayValue(
            threshold.value,
            "ratio",
            visualization.format.unit,
            scale
          )
          return (
            <span
              key={`${threshold.value}:${index}`}
              className="absolute top-0 bottom-0 border-l border-dashed"
              style={{
                left: offset(value),
                borderColor: threshold.color ?? "var(--muted-foreground)",
              }}
              title={threshold.label ?? undefined}
            />
          )
        })}
        {[shown.min, shown.max].map((value, index) => (
          <span
            key={index}
            className="absolute top-3 bottom-3 w-px bg-muted-foreground"
            style={{ left: offset(value) }}
          />
        ))}
        <span
          className="absolute top-2 bottom-2 rounded border border-primary bg-primary/20"
          style={{
            left: `${Math.min(boxStart, boxEnd)}%`,
            width: `${Math.abs(boxEnd - boxStart)}%`,
          }}
        />
        <span
          className="absolute top-1 bottom-1 w-0.5 bg-primary"
          style={{ left: offset(shown.median) }}
        />
        {showOutliers
          ? summary.outliers.map((value, index) => (
              <span
                key={`${value}:${index}`}
                className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive"
                style={{
                  left: offset(
                    displayValue(
                      value,
                      "ratio",
                      visualization.format.unit,
                      scale
                    )
                  ),
                }}
              />
            ))
          : null}
      </div>
      {visualization.axes.y.visible ? (
        <figcaption className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
          <span>
            {t("Minimum")}{" "}
            {format.number(shown.min, { maximumFractionDigits: decimals })}
          </span>
          <span>
            {visualization.axes.y.label ?? t("Median")}{" "}
            {format.number(shown.median, { maximumFractionDigits: decimals })}
          </span>
          <span>
            {t("Maximum")}{" "}
            {format.number(shown.max, { maximumFractionDigits: decimals })}
          </span>
        </figcaption>
      ) : null}
    </figure>
  )
}

function WidgetHeatmap({
  values,
  valueType,
  visualization,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualizationV1
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, decimals } = useYear()
  const xField = visualization.encoding.x?.field ?? "date"
  const yField = visualization.encoding.y?.field ?? "value"
  const colorField = visualization.encoding.color?.field ?? yField
  const yValueType = widgetEncodingValueType(yField, valueType)
  const colorValueType = widgetEncodingValueType(colorField, valueType)
  const formatShownValue = useShownWidgetValueFormatter(
    visualization,
    scale,
    decimals
  )
  const cells = values.flatMap((item) => {
    const encoded = widgetEncodedSeriesDatum(
      item,
      xField,
      yField,
      colorField,
      valueType,
      visualization,
      scale
    )
    if (!encoded) return []
    return [
      {
        ...item,
        x: encoded.x,
        shownValue: encoded.y,
        colorValue: encoded.colorValue,
      },
    ]
  })
  const ordered = [...cells].sort((left, right) =>
    typeof left.x === "number" && typeof right.x === "number"
      ? left.x - right.x
      : String(left.x).localeCompare(String(right.x))
  )
  if (visualization.scale.x.reverse) ordered.reverse()
  const numericColors = ordered.flatMap((item) =>
    typeof item.colorValue === "number" ? [item.colorValue] : []
  )
  const colorBuckets = widgetColorBuckets(numericColors)
  const categoryDomain = [
    ...new Set(
      ordered.flatMap((item) =>
        typeof item.colorValue === "string" ? [item.colorValue] : []
      )
    ),
  ]
  const colorDomain =
    colorBuckets.length > 0
      ? colorBuckets.map((bucket) => bucket.key)
      : categoryDomain
  const colorRange = colorDomain.map(
    (_, index) => AVERAGE_SERIES_COLORS[index % AVERAGE_SERIES_COLORS.length]
  )
  const [configuredMin, configuredMax] = widgetNumericDomain(
    numericColors,
    visualization.scale.y.zero,
    visualization.scale.y.min === null
      ? null
      : widgetEncodedScaleValue(
          visualization.scale.y.min,
          colorField,
          valueType,
          visualization,
          scale
        ),
    visualization.scale.y.max === null
      ? null
      : widgetEncodedScaleValue(
          visualization.scale.y.max,
          colorField,
          valueType,
          visualization,
          scale
        )
  )
  const colorSpan = Math.max(Number.EPSILON, configuredMax - configuredMin)
  const semantic =
    visualization.options.kind === "heatmap"
      ? visualization.options.colorScheme
      : "semantic"
  const legend =
    visualization.legend.visible && colorDomain.length > 0 ? (
      <ul
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
        aria-label={t("Legend")}
      >
        {colorDomain.map((key, index) => {
          const bucket = colorBuckets[index]
          const label = bucket
            ? `${formatShownValue(bucket.from, colorValueType)}–${formatShownValue(bucket.to, colorValueType)}`
            : key
          return (
            <li key={key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: colorRange[index] }}
              />
              <span>{label}</span>
            </li>
          )
        })}
      </ul>
    ) : null

  return (
    <figure className="flex min-h-36 flex-col gap-2" aria-label={t("Heatmap")}>
      {visualization.legend.position === "top" ? legend : null}
      <div
        className={cn(
          "min-w-0",
          visualization.legend.position === "right" &&
            legend &&
            "grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)] items-center gap-3"
        )}
      >
        <div className="min-w-0">
          {visualization.axes.y.visible && visualization.axes.y.label ? (
            <p className="mb-1 text-xs text-muted-foreground">
              {visualization.axes.y.label}
            </p>
          ) : null}
          <div
            className={cn(
              "grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))]",
              visualization.axes.x.grid || visualization.axes.y.grid
                ? "gap-1"
                : "gap-0.5"
            )}
          >
            {ordered.map((item) => {
              const normalized = Math.max(
                0,
                Math.min(
                  1,
                  (Number(item.colorValue) - configuredMin) / colorSpan
                )
              )
              const intensity = Math.max(
                0.12,
                visualization.scale.y.reverse ? 1 - normalized : normalized
              )
              const categoryIndex =
                typeof item.colorValue === "string"
                  ? categoryDomain.indexOf(item.colorValue)
                  : -1
              const bucketIndex =
                typeof item.colorValue === "number"
                  ? colorBuckets.findIndex(
                      (bucket) =>
                        widgetColorBucketKey(
                          item.colorValue as number,
                          colorBuckets
                        ) === bucket.key
                    )
                  : -1
              const encodedColor =
                colorRange[Math.max(categoryIndex, bucketIndex)]
              const background =
                widgetEncodedThresholdColor(
                  item.shownValue,
                  yField,
                  valueType,
                  visualization,
                  scale
                ) ??
                (typeof item.colorValue === "string"
                  ? encodedColor
                  : semantic === "diverging"
                    ? item.shownValue >= 0
                      ? `color-mix(in oklab, var(--band-good) ${Math.round(intensity * 100)}%, var(--muted))`
                      : `color-mix(in oklab, var(--destructive) ${Math.round(intensity * 100)}%, var(--muted))`
                    : semantic === "sequential"
                      ? `color-mix(in oklab, var(--chart-1) ${Math.round(intensity * 100)}%, var(--muted))`
                      : `color-mix(in oklab, var(--band-good) ${Math.round(intensity * 100)}%, var(--muted))`)
              const xLabel =
                item.date && xField === "date"
                  ? format.dateTime(item.date, {
                      day: "numeric",
                      month: "short",
                    })
                  : String(item.x)
              return (
                <div
                  key={item.key}
                  className={cn(
                    "aspect-square min-w-0 rounded-sm border border-foreground/5",
                    visualization.axes.x.grid &&
                      "outline outline-1 outline-border"
                  )}
                  style={{ background }}
                  title={`${xLabel}: ${formatShownValue(item.shownValue, yValueType)}`}
                />
              )
            })}
          </div>
          {visualization.axes.x.visible ? (
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">
              {visualization.axes.x.label ?? t("Date")}
            </figcaption>
          ) : null}
        </div>
        {visualization.legend.position === "right" ? legend : null}
      </div>
      {visualization.legend.position === "bottom" ? legend : null}
    </figure>
  )
}

function WidgetSeriesChart({
  values,
  valueType,
  visualization,
  height,
}: {
  values: Array<WidgetSeriesDatum & { good?: boolean }>
  valueType: WidgetValueType
  visualization: WidgetVisualizationV1
  height: number
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, decimals } = useYear()
  const xField =
    visualization.encoding.x?.field ??
    (values.some((item) => item.date !== null) ? "date" : "category")
  const yField = visualization.encoding.y?.field ?? "value"
  const colorField = visualization.encoding.color?.field ?? null
  const yValueType = widgetEncodingValueType(yField, valueType)
  const colorValueType = colorField
    ? widgetEncodingValueType(colorField, valueType)
    : valueType
  const formatShownValue = useShownWidgetValueFormatter(
    visualization,
    scale,
    decimals
  )
  const temporal = xField === "date"
  const numericX = xField !== "date" && xField !== "category"
  const prepared = useMemo(
    () =>
      values.flatMap((item) => {
        const encoded = widgetEncodedSeriesDatum(
          item,
          xField,
          yField,
          colorField,
          valueType,
          visualization,
          scale
        )
        return encoded ? [{ ...item, ...encoded }] : []
      }),
    [colorField, scale, valueType, values, visualization, xField, yField]
  )
  const quantitativeColor = colorField !== null && colorField !== "category"
  const colorBuckets = widgetColorBuckets(
    quantitativeColor
      ? prepared.flatMap((item) =>
          typeof item.colorValue === "number" ? [item.colorValue] : []
        )
      : []
  )
  const plotted = prepared.map((item) => ({
    ...item,
    colorKey:
      quantitativeColor && typeof item.colorValue === "number"
        ? widgetColorBucketKey(item.colorValue, colorBuckets)
        : item.colorValue,
  }))
  const series = [
    ...new Set(plotted.flatMap((item) => (item.series ? [item.series] : []))),
  ]
  const hasSeries = series.length > 1
  const colorDomain = colorField
    ? [
        ...new Set(
          plotted.flatMap((item) =>
            item.colorKey === null ? [] : [item.colorKey]
          )
        ),
      ]
    : series
  const colorRange = colorDomain.map(
    (_, index) => AVERAGE_SERIES_COLORS[index % AVERAGE_SERIES_COLORS.length]
  )
  const hasVisualColor = colorDomain.length > 0
  const stacked =
    hasSeries &&
    visualization.mark === "bar" &&
    visualization.options.kind === "bar" &&
    visualization.options.stacked
  const verticalValues = widgetSeriesDomainValues(plotted, stacked)
  const configuredMin =
    visualization.scale.y.min === null
      ? null
      : widgetEncodedScaleValue(
          visualization.scale.y.min,
          yField,
          valueType,
          visualization,
          scale
        )
  const configuredMax =
    visualization.scale.y.max === null
      ? null
      : widgetEncodedScaleValue(
          visualization.scale.y.max,
          yField,
          valueType,
          visualization,
          scale
        )
  const domain = widgetNumericDomain(
    verticalValues,
    stacked || visualization.scale.y.zero,
    configuredMin,
    configuredMax
  )
  const horizontal =
    visualization.options.kind === "bar" &&
    visualization.options.orientation === "horizontal"
  const curve =
    visualization.options.kind === "line" ||
    visualization.options.kind === "area"
      ? visualization.options.curve === "linear"
        ? curveLinear
        : visualization.options.curve === "step"
          ? curveStep
          : curveMonotoneX
      : curveLinear
  const mark = visualization.mark
  const definition = (() => {
    const seriesChannels = {
      ...(hasSeries ? { z: "series" as const } : {}),
      ...(hasVisualColor
        ? { color: colorField ? ("colorKey" as const) : ("series" as const) }
        : {}),
    }
    const constantStroke = hasVisualColor ? {} : { stroke: "var(--chart-1)" }
    const constantFill = hasVisualColor ? {} : { fill: "var(--chart-1)" }
    const marks = (() => {
      if (mark === "line") {
        return [
          lineY(plotted, {
            id: "widget-line",
            x: "x",
            y: "y",
            key: "key",
            ...seriesChannels,
            curve: d3Curve(curve),
            ...constantStroke,
            strokeWidth:
              visualization.options.kind === "line"
                ? visualization.options.strokeWidth
                : 2,
          }),
          ...(visualization.options.kind === "line" &&
          (visualization.options.points || quantitativeColor)
            ? [
                dot(plotted, {
                  id: "widget-points",
                  x: "x",
                  y: "y",
                  key: "key",
                  ...seriesChannels,
                  r: 3.5,
                  ...constantFill,
                }),
              ]
            : []),
        ]
      }
      if (mark === "area") {
        return [
          areaY(plotted, {
            id: "widget-area",
            x: "x",
            y1: domain[0],
            y2: "y",
            key: "key",
            ...seriesChannels,
            curve: d3Curve(curve),
            ...constantFill,
            fillOpacity:
              visualization.options.kind === "area"
                ? visualization.options.opacity
                : 0.22,
          }),
          lineY(plotted, {
            id: "widget-area-line",
            x: "x",
            y: "y",
            key: "key",
            ...seriesChannels,
            curve: d3Curve(curve),
            ...constantStroke,
            strokeWidth: 2,
          }),
          ...((visualization.options.kind === "area" &&
            visualization.options.points) ||
          quantitativeColor
            ? [
                dot(plotted, {
                  id: "widget-area-points",
                  x: "x",
                  y: "y",
                  key: "key",
                  ...seriesChannels,
                  r: 3.5,
                  ...constantFill,
                }),
              ]
            : []),
        ]
      }
      if (mark === "dot") {
        return [
          dot(plotted, {
            id: "widget-dots",
            x: "x",
            y: "y",
            key: "key",
            ...seriesChannels,
            r:
              visualization.options.kind === "dot"
                ? visualization.options.size / 2
                : 4,
            ...constantFill,
          }),
        ]
      }
      if (horizontal) {
        return [
          barX(plotted, {
            id: "widget-bars-horizontal",
            x: "y",
            y: "x",
            key: "key",
            ...seriesChannels,
            layout: hasSeries
              ? visualization.options.kind === "bar" &&
                visualization.options.stacked
                ? stack()
                : group({ padding: 0.08 })
              : undefined,
            ...constantFill,
            radius:
              visualization.options.kind === "bar"
                ? visualization.options.cornerRadius
                : 4,
          }),
        ]
      }
      return [
        barY(plotted, {
          id: "widget-bars",
          x: "x",
          y: "y",
          key: "key",
          ...seriesChannels,
          layout: hasSeries
            ? visualization.options.kind === "bar" &&
              visualization.options.stacked
              ? stack()
              : group({ padding: 0.08 })
            : undefined,
          ...(hasVisualColor
            ? {}
            : {
                fill: (item: (typeof plotted)[number]) =>
                  item.good === false ? "var(--band-weak)" : "var(--chart-1)",
              }),
          radius:
            visualization.options.kind === "bar"
              ? visualization.options.cornerRadius
              : 4,
          inset: 3,
        }),
      ]
    })()
    const thresholds = visualization.thresholds.map((threshold, index) => {
      const value = widgetEncodedScaleValue(
        threshold.value,
        yField,
        valueType,
        visualization,
        scale
      )
      const datum = [{ value }]
      return horizontal
        ? ruleX(datum, {
            id: `widget-threshold-${index}`,
            x: "value",
            stroke: threshold.color ?? "var(--muted-foreground)",
            strokeDasharray: "4 3",
          })
        : ruleY(datum, {
            id: `widget-threshold-${index}`,
            y: "value",
            stroke: threshold.color ?? "var(--muted-foreground)",
            strokeDasharray: "4 3",
          })
    })
    const categoryDomain = [...new Set(plotted.map((item) => String(item.x)))]
    const xNumbers = plotted
      .map((item) => Number(item.x))
      .filter(Number.isFinite)
    const xMinimum = Math.min(...xNumbers)
    const xMaximum = Math.max(...xNumbers)
    const xDomain: [number, number] =
      xMinimum === xMaximum
        ? [xMinimum - 1, xMaximum + 1]
        : [xMinimum, xMaximum]
    return dynamicChart({
      marks: [...marks, ...thresholds],
      x: horizontal
        ? {
            scale: scaleLinear().domain(domain),
            reverse: visualization.scale.y.reverse,
            grid: visualization.axes.y.grid,
            axis: visualization.axes.y.visible
              ? { label: visualization.axes.y.label ?? undefined }
              : false,
          }
        : {
            scale:
              temporal || numericX
                ? scaleLinear().domain(xDomain)
                : scaleBand<string>().domain(categoryDomain).padding(0.12),
            grid: visualization.axes.x.grid,
            reverse: visualization.scale.x.reverse,
            axis: visualization.axes.x.visible
              ? {
                  line: false,
                  label: visualization.axes.x.label ?? undefined,
                  ticks: temporal
                    ? {
                        format: (value: number) =>
                          format.dateTime(new Date(value), {
                            day: "numeric",
                            month: "short",
                          }),
                      }
                    : { size: 0 },
                }
              : false,
          },
      y: horizontal
        ? {
            scale: scaleBand<string>().domain(categoryDomain).padding(0.12),
            grid: false,
            reverse: visualization.scale.x.reverse,
            axis: visualization.axes.x.visible
              ? { label: visualization.axes.x.label ?? undefined }
              : false,
          }
        : {
            scale: scaleLinear().domain(domain),
            grid: visualization.axes.y.grid,
            reverse: visualization.scale.y.reverse,
            axis: visualization.axes.y.visible
              ? { label: visualization.axes.y.label ?? undefined }
              : false,
          },
      color: hasVisualColor
        ? {
            domain: colorDomain,
            range: colorRange,
          }
        : undefined,
      clip: true,
      focus: "nearest",
      // The renderer's built-in focus ring is a `Canvas`-filled circle under
      // the primary point — white on a light card, and reading as a halo the
      // design never asked for. Off everywhere, not just on the sparkline.
      focusRing: false,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "right", "left"],
        content: (points: Array<{ datum?: (typeof plotted)[number] }>) => {
          const item = points[0]?.datum
          const colorRow =
            item &&
            quantitativeColor &&
            colorField !== null &&
            colorField !== yField &&
            typeof item.colorValue === "number"
              ? {
                  color: "var(--chart-2)",
                  label: t("Colour"),
                  value: formatShownValue(item.colorValue, colorValueType),
                }
              : null
          return {
            title: item?.label,
            rows: item
              ? [
                  {
                    color: "var(--chart-1)",
                    label: item.series ?? t("Value"),
                    value: formatShownValue(item.y, yValueType),
                  },
                  ...(colorRow ? [colorRow] : []),
                ]
              : [],
          }
        },
      },
      svgAnimation: {
        duration: 220,
        easing: "ease-out",
        respectReducedMotion: true,
        resize: false,
      },
    })
  })()

  if (plotted.length === 0) return null
  const showLegend = hasVisualColor && visualization.legend.visible
  const rightLegend = showLegend && visualization.legend.position === "right"
  const legend = showLegend ? (
    <ul
      className={cn(
        "text-xs text-muted-foreground",
        rightLegend
          ? "flex max-w-36 flex-col gap-2"
          : "flex flex-wrap gap-x-3 gap-y-1"
      )}
      aria-label={t("Legend")}
    >
      {colorDomain.map((value, index) => {
        const bucket = quantitativeColor ? colorBuckets[index] : null
        const label = bucket
          ? `${formatShownValue(bucket.from, colorValueType)}–${formatShownValue(bucket.to, colorValueType)}`
          : String(value)
        return (
          <li key={String(value)} className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: colorRange[index] }}
            />
            <span className="min-w-0 break-words">{label}</span>
          </li>
        )
      })}
    </ul>
  ) : null
  return (
    <div
      className={cn(
        "flex min-h-36 flex-col gap-2 text-muted-foreground",
        height > 200 && "min-h-64"
      )}
    >
      {visualization.legend.position === "top" ? legend : null}
      <div
        className={cn(
          "min-w-0",
          rightLegend &&
            "grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)] items-center gap-4"
        )}
      >
        <div className="min-w-0">
          <ResponsiveChart
            ariaLabel={t("Custom insight chart")}
            definition={definition}
            height={height}
            initialWidth={expandedWidth(height)}
            updateTransition={INSTANT_CHART_UPDATES}
          />
        </div>
        {rightLegend ? legend : null}
      </div>
      {visualization.legend.position === "bottom" ? legend : null}
      {visualization.thresholds.some((threshold) => threshold.label) ? (
        <ul
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
          aria-label={t("Thresholds")}
        >
          {visualization.thresholds.flatMap((threshold, index) =>
            threshold.label
              ? [
                  <li
                    key={`${threshold.value}:${index}`}
                    className="flex items-center gap-1.5"
                  >
                    <span
                      className="h-px w-3"
                      style={{
                        background:
                          threshold.color ?? "var(--muted-foreground)",
                      }}
                    />
                    {threshold.label}
                  </li>,
                ]
              : []
          )}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * TanStack Charts normally infers one static mark tuple. This definition is
 * assembled from a user-authored mark at runtime, so its union cannot be
 * represented by that tuple type. Keep the assertion at this single boundary;
 * every datum and option above remains fully typed.
 */
function dynamicChart(
  definition: unknown
): DomChartDefinition<unknown, string | number, string | number> {
  return definition as DomChartDefinition<
    unknown,
    string | number,
    string | number
  >
}

function expandedWidth(height: number): number {
  return height > 200 ? 720 : 360
}
