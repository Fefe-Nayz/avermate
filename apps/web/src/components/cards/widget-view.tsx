"use client"

import Link from "next/link"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
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
  text,
  type DomChartDefinition,
} from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { curveLinear, curveMonotoneX, curveStep } from "d3-shape"
import { useFormatter, useExtracted } from "next-intl"
import {
  widgetDatumSlots,
  widgetFrameSeries,
  widgetMarkForRecipe,
  widgetIsUntypedLabel,
  widgetStatusFromLabel,
  widgetVisualizationForPlatform,
  type WidgetDefinition,
  type WidgetEvaluationResult,
  type WidgetDatumSlots,
  type WidgetSeriesDatum,
  type WidgetValueType,
  type WidgetVisualization,
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
  axisNameAtWidth,
  BandGap,
  CardDelta,
  CardFigure,
  FOOTNOTE_TEXT,
  NAME_TEXT,
  READING_TEXT,
  SUPPORT_TEXT,
  TickNumber,
  VALUE_TEXT,
} from "./card-figure"
import { useEnterValue, useEntered } from "@/hooks/use-entered"
import { MiniDistribution } from "./card-distribution"
import { CardStrip } from "./card-strip"
import { CardTreemap } from "./card-treemap"
import { CardSunburst } from "./card-sunburst"
import { CardBand } from "./card-band"
import { CardControl } from "./card-control"
import { CardFriendCurves } from "./card-friend-curves"
import { CardSubjectComparison } from "./card-subject-comparison"
import { CardDensity } from "./card-density"
import { CardFacets } from "./card-facets"
import { CardDifference } from "./card-difference"
import { CardRadar } from "./card-radar"
import { CardRegression } from "./card-regression"
import { CardScatter } from "./card-scatter"
import { CardWaterfall } from "./card-waterfall"
import { CardHeatmap } from "./card-heatmap"
import { CardWaffle } from "./card-waffle"
import { RankingList } from "./card-ranking"
import { WidgetNumberText } from "./widget-number"
import { Sparkline } from "./widget-sparkline"
import {
  widgetColorBucketKey,
  widgetColorBuckets,
  widgetChannelValueIsDelta,
  widgetDefinitionShowsDelta,
  widgetDefinitionValueIsDelta,
  widgetMeasureValueIsDelta,
  widgetDisplayValue as displayValue,
  widgetEncodedScaleValue,
  widgetEncodedSeriesDatum,
  widgetEncodingValueType,
  widgetGaugeFillRatio,
  widgetGoalPresentation,
  widgetNumericDomain,
  widgetNumericEncodedValue,
  widgetSeriesDomainValues,
  widgetThresholdColor,
  widgetDisplayValue,
  widgetValuePresentation,
} from "./widget-view-model"
import {
  fitWidgetAspect,
  limitWidgetSeries,
  resolveWidgetResponsivePresentation,
  type WidgetGridColumns,
} from "./widget-responsive"

interface WidgetBodyProps {
  definition: WidgetDefinition
  result: WidgetEvaluationResult
  expanded?: boolean
  /** Columns the packer actually granted this card at the active grid step. */
  columns?: WidgetGridColumns
  /** Columns in that active grid step. */
  gridColumns?: WidgetGridColumns
}

const WidgetResponsiveContext = createContext({ seriesBudget: 8 })

function useShownWidgetValueFormatter(
  visualization: WidgetVisualization,
  scale: number,
  defaultDecimals: number,
  difference = false
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
      signDisplay: difference ? "exceptZero" : "auto",
    })
    if (presentation.unit === "percent") return `${number}%`
    if (presentation.unit === "days") return `${number} ${t("days")}`
    if (presentation.unit === "ratio") {
      return difference ? number : `${number} / ${format.number(scale)}`
    }
    return number
  }
}

export function WidgetBody({
  definition,
  result,
  expanded = false,
  columns,
  gridColumns,
}: WidgetBodyProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (!host || typeof ResizeObserver === "undefined") return
    let frame = 0
    const measure = () => {
      const next = { width: host.clientWidth, height: host.clientHeight }
      setBox((current) =>
        current?.width === next.width && current.height === next.height
          ? current
          : next
      )
    }
    // Observe callbacks are asynchronous, and the frame covers implementations that do
    // not deliver their first observation until the next resize.
    frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [host])

  /** Platform support first; width adaptation then follows that recipe's honest chain. */
  const platformVisualization = widgetVisualizationForPlatform(
    definition,
    "web",
    result.shape
  )
  const responsive = resolveWidgetResponsivePresentation({
    recipe: platformVisualization.recipe,
    behavior: definition.presentation.responsiveBehavior,
    resultShape: result.shape,
    width: box?.width ?? null,
    columns,
    grid: gridColumns,
  })
  const visualization =
    responsive.recipe === platformVisualization.recipe
      ? platformVisualization
      : { ...platformVisualization, recipe: responsive.recipe }
  const fitted = box
    ? fitWidgetAspect(
        box.width,
        box.height,
        result.kind === "empty" ? null : responsive.preferredAspectRatio
      )
    : null

  return (
    <WidgetResponsiveContext.Provider
      value={{ seriesBudget: responsive.seriesBudget }}
    >
      <div
        ref={setHost}
        className="flex h-full min-h-0 w-full items-center justify-center"
        data-widget-profile={responsive.profile}
        data-widget-recipe={responsive.recipe}
        data-widget-requested-recipe={definition.visualization.recipe}
        data-widget-series-budget={responsive.seriesBudget}
      >
        <div
          className="min-h-0 max-w-full"
          style={
            fitted
              ? { width: fitted.width, height: fitted.height }
              : { width: "100%", height: "100%" }
          }
        >
          <WidgetBodyContent
            definition={definition}
            result={result}
            expanded={expanded}
            visualization={visualization}
          />
        </div>
      </div>
    </WidgetResponsiveContext.Provider>
  )
}

function WidgetBodyContent({
  definition,
  result,
  expanded,
  visualization,
}: {
  definition: WidgetDefinition
  result: WidgetEvaluationResult
  expanded: boolean
  visualization: WidgetVisualization
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, decimals, passingRatio } = useYear()
  // The shape to draw, from the recipe the document stores. Derived once, so no two
  // branches of this renderer can disagree about what the card is.
  const mark = widgetMarkForRecipe(visualization.recipe) ?? "value"
  // Which slot of a plotted datum each channel meant — see `widgetDatumSlots`. Resolved
  // here so the chart components never need the analysis.
  const slots = widgetDatumSlots(definition.analysis, visualization.encoding)
  // The heatmap is its own component now, so the year's decimals travel with the
  // formatter rather than being looked up again inside it.
  const formatValue = useShownWidgetValueFormatter(
    visualization,
    scale,
    decimals
  )
  const formatDifferenceValue = useShownWidgetValueFormatter(
    visualization,
    scale,
    decimals,
    true
  )
  const showDelta = widgetDefinitionShowsDelta(definition)
  const headlineIsDifference = widgetDefinitionValueIsDelta(definition)
  // Before the early returns: a hook cannot be called conditionally, and this one
  // answers `undefined` for every reading that does not owe its sample size.
  const dispersionFooter = useDispersionFooter(result)

  if (result.kind === "empty") {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {/* Why, when the why is itself the reading: "three marks, and a middle
            half needs four" is a different sentence from "nothing here yet", and
            a card that says the second when the first is true reads as broken. */}
        {result.reason?.kind === "insufficient-sample"
          ? t("{count} of {minimum} marks needed", {
              count: String(result.reason.count),
              minimum: String(result.reason.minimum),
            })
          : result.reason?.kind === "nothing-unusual"
            ? // Looked, and found everything as usual — a reading, not a failure.
              t("Nothing out of the ordinary")
            : result.reason?.kind === "not-sharing"
              ? // The reader's own switch, so the card says what to do rather than
                // looking broken.
                t("Share your average with the group to be ranked")
              : t("Not enough data yet")}
      </p>
    )
  }

  if (result.kind === "structured") {
    return (
      <WidgetStructuredResult
        result={result.value}
        visualization={visualization}
        slots={slots}
        showDelta={showDelta}
      />
    )
  }

  if (result.kind === "distribution-set") {
    /**
     * One distribution per group — the limitation the audit called out, now drawn.
     *
     * A grouped box plot, a violin per subject and a ridgeline are the same result read three
     * ways, so they share one component: what differs is whether the shapes sit side by side
     * or stack, and whether a shape is drawn at all.
     */
    return (
      <CardDensity
        /**
         * The untyped bucket, in the reader's language.
         *
         * The same token the series path translates — core does not speak it — and the
         * same reason it is a token: a kind of assessment genuinely named "Sans type"
         * must not be mistaken for the results that have none.
         */
        groups={result.groups.map((group) =>
          widgetIsUntypedLabel(group.label)
            ? { ...group, label: t("No type") }
            : group
        )}
        mode={
          mark === "ridgeline"
            ? "ridgeline"
            : mark === "violin"
              ? "violin"
              : "boxplot"
        }
        showBox={
          visualization.options.kind === "violin"
            ? visualization.options.showBox
            : true
        }
        overlap={
          visualization.options.kind === "ridgeline"
            ? visualization.options.overlap
            : 0.35
        }
        scale={scale}
        formatValue={(ratio) =>
          format.number(ratio * scale, { maximumFractionDigits: decimals })
        }
        ariaLabel={t("Distribution")}
        tooSmallLabel={(count) =>
          t("{count} marks — too few for a shape", { count: String(count) })
        }
      />
    )
  }

  if (result.kind === "distribution") {
    if (mark === "boxplot") {
      return (
        <WidgetBoxPlot summary={result.summary} visualization={visualization} />
      )
    }
    // The dashboard's own histogram, unless the card is a study: bars on the
    // chart accent, bucket floors on the x-axis and nothing else, the full range
    // owed to the tooltip. The generic chart spells out every boundary and adds a
    // y-axis and a grid, which is a study where a shape was wanted.
    if (mark === "waffle") {
      return (
        <CardWaffle
          bands={result.buckets.map((bucket) => ({
            key: `${bucket.from}:${bucket.to}`,
            label: `${format.number(bucket.from * scale, {
              maximumFractionDigits: 0,
            })}–${format.number(bucket.to * scale, {
              maximumFractionDigits: 0,
            })}`,
            count: bucket.count,
          }))}
          visualization={visualization}
          formatCount={(count) => format.number(count)}
        />
      )
    }
    if (mark === "violin" || mark === "ridgeline") {
      // One shape, from the one distribution there is. A violin needs no grouping to mean
      // something — the outline of a term is a reading — and without this branch an
      // ungrouped violin fell through every case below and drew nothing at all.
      return (
        <CardDensity
          groups={[
            {
              key: "all",
              label: "",
              buckets: result.buckets,
              total: result.total,
              values: result.values,
              summary: result.summary,
            },
          ]}
          mode={mark === "ridgeline" ? "ridgeline" : "violin"}
          showBox={
            visualization.options.kind === "violin"
              ? visualization.options.showBox
              : true
          }
          overlap={0}
          scale={scale}
          formatValue={(ratio) =>
            format.number(ratio * scale, { maximumFractionDigits: decimals })
          }
          ariaLabel={t("Distribution")}
          tooSmallLabel={(count) =>
            t("{count} marks — too few for a shape", { count: String(count) })
          }
        />
      )
    }
    if (mark === "strip") {
      return (
        <CardStrip
          ariaLabel={t("Distribution")}
          values={result.values}
          scale={scale}
          decimals={decimals}
          tick={
            visualization.options.kind === "strip"
              ? visualization.options.tick
              : 10
          }
          showMedian={
            visualization.options.kind === "strip"
              ? visualization.options.showMedian
              : true
          }
          // The median the distribution already summarised, not one recomputed
          // here: the box plot beside it must not be able to disagree.
          median={result.summary.median}
        />
      )
    }
    if (!expanded && mark === "histogram") {
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
        visualization={visualization}
        slots={slots}
        height={expanded ? 300 : 170}
      />
    )
  }

  if (result.kind === "data-frame") {
    /**
     * The plotted rows, from the table.
     *
     * One projection for every chart below — see `widgetFrameSeries`. The frame is what a
     * grouped reading now *is*; the five-slot datum is what the marks in this file draw,
     * and this is the single line between the two. A renderer that needs the whole table —
     * the facet grid — reads `result.frame` instead.
     */
    const rows = widgetFrameSeries(result.frame, slots).map((row) => {
      // A status axis arrives as a token — see `WIDGET_STATUS_LABEL` — because core does
      // not speak the reader's language. This is where it becomes a word.
      const status = widgetStatusFromLabel(row.label)
      if (status !== null) {
        return {
          ...row,
          label:
            status === "passed"
              ? t("passed")
              : status === "failed"
                ? t("failed")
                : t("not assessed"),
        }
      }
      // The same trick for the bucket of results that carry no type — a token, so a type
      // genuinely named "Sans type" is not mistaken for it.
      return widgetIsUntypedLabel(row.label)
        ? { ...row, label: t("No type") }
        : row
    })
    if (mark === "regression") {
      /**
       * The line through the results, and how much of them it explains.
       *
       * Reads `rows` rather than the frame: a fit is one measure over one axis, which is
       * exactly what the projection carries. The fit itself lives in core — `linearFit` —
       * so the trend arrows and this card cannot disagree about a slope.
       */
      const options =
        visualization.options.kind === "regression"
          ? visualization.options
          : { showBand: true, showPoints: true, showReading: true }
      return (
        <CardRegression
          rows={rows}
          visualization={visualization}
          showBand={options.showBand}
          showPoints={options.showPoints}
          showReading={options.showReading}
          scale={scale}
          decimals={decimals}
          ariaLabel={t("The trend through your results")}
        />
      )
    }
    if (mark === "radar") {
      /**
       * One spoke per group, on the dashboard's own ring.
       *
       * The chart is `radarSpec` — the same geometry, the same names along their spokes —
       * because a second radar would be a second set of answers to where a label goes.
       * What the card adds is the bounds: see `radarAxes`.
       */
      const options =
        visualization.options.kind === "radar"
          ? visualization.options
          : { fill: true, showPoints: true }
      return (
        <CardRadar
          rows={rows}
          scale={scale}
          decimals={decimals}
          fill={options.fill}
          showPoints={options.showPoints}
          ariaLabel={t("Each group on one comparable ring")}
        />
      )
    }
    if (mark === "scatter") {
      /**
       * Two readings against each other, with the group as the point.
       *
       * Reads the frame rather than the projection, and it is the clearest case for why
       * the frame exists: a five-slot datum carries one value, so a chart whose *both*
       * axes are readings could not be expressed at all before the table.
       */
      const pair = definition.analysis.measures.slice(0, 2)
      const [first, second] = pair
      if (first === undefined || second === undefined) return null
      const options =
        visualization.options.kind === "scatter"
          ? visualization.options
          : { quadrants: true, showLabels: true, size: 8 }
      return (
        <CardScatter
          frame={result.frame}
          xMeasure={first.id}
          yMeasure={second.id}
          xLabel={first.label ?? first.id}
          yLabel={second.label ?? second.id}
          visualization={visualization}
          quadrants={options.quadrants}
          showLabels={options.showLabels}
          size={options.size}
          scale={scale}
          decimals={decimals}
          xDifference={widgetMeasureValueIsDelta(first.expression)}
          yDifference={widgetMeasureValueIsDelta(second.expression)}
          ariaLabel={t("{first} against {second}", {
            first: first.label ?? first.id,
            second: second.label ?? second.id,
          })}
        />
      )
    }
    if (mark === "difference-area") {
      /**
       * Two of the frame's measure columns, and the ground between them.
       *
       * The second renderer that reads the frame rather than the projection, and for the
       * reason the frame exists: a five-slot datum carries *one* value, so a chart about
       * two of them could not be expressed at all before the table.
       *
       * Both labels are present because the compiler insists on them once a card has two
       * measures — `measure-label` — so the id is a fallback that a compiled card never
       * reaches.
       */
      const pair = definition.analysis.measures.slice(0, 2)
      const [first, second] = pair
      if (first === undefined || second === undefined) return null
      const options =
        visualization.options.kind === "difference-area"
          ? visualization.options
          : { showLines: true, opacity: 0.22 }
      return (
        <CardDifference
          frame={result.frame}
          xMeasure={first.id}
          yMeasure={second.id}
          xLabel={first.label ?? first.id}
          yLabel={second.label ?? second.id}
          visualization={visualization}
          showLines={options.showLines}
          opacity={options.opacity}
          scale={scale}
          decimals={decimals}
          ariaLabel={t("{first} against {second}", {
            first: first.label ?? first.id,
            second: second.label ?? second.id,
          })}
        />
      )
    }
    if (mark === "facets") {
      /**
       * One panel per value of the splitting dimension.
       *
       * The first renderer that reads the *frame* rather than the projection: a facet
       * needs the whole table to work out its domain and to cut it per panel, which is
       * exactly the thing a flat list of five-slot rows could not carry.
       */
      const options =
        visualization.options.kind === "facets"
          ? visualization.options
          : { inner: "line" as const, columns: 2, sharedScale: true }
      const facetField =
        visualization.encoding.facet?.field ??
        definition.analysis.dimensions[1]?.id
      const inner = widgetVisualizationForPlatform(
        {
          analysis: definition.analysis,
          visualization: { ...visualization, recipe: options.inner },
        },
        "web",
        result.shape
      )
      return facetField === undefined ? null : (
        <CardFacets
          frame={result.frame}
          dimensionId={facetField}
          columns={options.columns}
          sharedScale={options.sharedScale}
          visualization={visualization}
          moreLabel={(count) => t("+{count} more", { count: String(count) })}
          renderPanel={(panel, domain) => (
            <WidgetSeriesChart
              values={widgetFrameSeries(panel.frame, slots)}
              valueType={result.valueType}
              visualization={
                domain === null
                  ? inner
                  : {
                      ...inner,
                      // Every panel on one scale, which is what makes them comparable.
                      scale: {
                        ...inner.scale,
                        y: { ...inner.scale.y, min: domain[0], max: domain[1] },
                      },
                      // No axes in a panel: nine copies of the same axis is furniture,
                      // and the shared domain is what the reader needs to know.
                      axes: {
                        x: { visible: false, grid: false, label: null },
                        y: { visible: false, grid: false, label: null },
                      },
                    }
              }
              slots={slots}
              height={72}
              difference={headlineIsDifference}
            />
          )}
        />
      )
    }
    if (mark === "heatmap") {
      return (
        <CardHeatmap
          values={rows}
          valueType={result.valueType}
          visualization={visualization}
          slots={slots}
          scale={scale}
          formatValue={formatValue}
        />
      )
    }
    if (mark === "table") {
      const limit =
        visualization.options.kind === "table" ||
        visualization.options.kind === "list"
          ? visualization.options.rows
          : 10
      return (
        <WidgetSeriesTable
          values={rows.slice(0, limit)}
          valueType={result.valueType}
          visualization={visualization}
          showDelta={showDelta && !headlineIsDifference}
          difference={headlineIsDifference}
        />
      )
    }
    if (mark === "list") {
      const limit =
        visualization.options.kind === "list" ? visualization.options.rows : 10
      /**
       * A ranking of subjects is the dashboard's own list: it measures the box it was
       * given — columns from the width, cells from the height — rather than stacking a
       * fixed six rows down a card half a desktop wide, and it counts what did not fit
       * out loud.
       *
       * Asked of the *recipe*, because that is what a ranking now is. Reading a resolved
       * slot instead was wrong twice over: a `list` card has no x channel at all — the
       * default encoding only fills x and y for series marks — so the slot was `null` and
       * every ranking on the dashboard silently fell through to the plain series list. The
       * recipe is the card's own answer to "what am I", and it is stored.
       */
      if (!expanded && visualization.recipe === "ranking") {
        return (
          <RankingList
            items={rows.map((item) => ({
              id: item.key,
              label: item.label,
              ratio:
                result.valueType === "ratio" && !headlineIsDifference
                  ? item.value
                  : null,
              delta: headlineIsDifference ? item.value : item.delta,
              difference: headlineIsDifference,
              // A weight is a percentage and a coverage is a count; neither is a mark, so
              // neither can be drawn by the average reel. Formatted here, where the
              // measure's type and the card's format live, and passed through as text.
              reading:
                item.value === null
                  ? null
                  : (headlineIsDifference
                      ? formatDifferenceValue
                      : formatValue)(
                      widgetDisplayValue(
                        item.value,
                        result.valueType,
                        visualization.format.unit,
                        scale
                      ),
                      result.valueType
                    ),
            }))}
          />
        )
      }
      return (
        <WidgetSeriesList
          values={rows.slice(0, limit)}
          valueType={result.valueType}
          visualization={visualization}
          showDelta={showDelta && !headlineIsDifference}
          difference={headlineIsDifference}
        />
      )
    }
    // A card that plots a value over time says what the value is. Only the
    // insights surface skips it, because there the chart *is* the subject —
    // a card is a glance, a study is a study.
    if (!expanded && rows.some((item) => item.date !== null)) {
      return (
        <WidgetTrend
          values={rows}
          valueType={result.valueType}
          visualization={visualization}
          slots={slots}
          difference={headlineIsDifference}
        />
      )
    }
    return (
      <WidgetSeriesChart
        values={rows}
        valueType={result.valueType}
        visualization={visualization}
        slots={slots}
        height={expanded ? 320 : 170}
        difference={headlineIsDifference}
      />
    )
  }

  return (
    <WidgetScalarValue
      value={result.value}
      valueType={result.valueType}
      delta={result.delta}
      visualization={visualization}
      footer={dispersionFooter}
      difference={headlineIsDifference}
    />
  )
}

/**
 * What a spread rests on, under the spread.
 *
 * Two things the audit asks for, in one line: how many marks the reading is made
 * of, and *which* estimator made it. Both matter because the four estimators
 * disagree by design — a term of fourteens with one 2/20 is volatile by its range
 * and steady by its middle half — so a card showing one of them without saying
 * which is presenting a choice of formula as a fact about the marks.
 *
 * `undefined` for every other reading: an average does not owe its sample size,
 * and a footnote under every card is a footnote nobody reads.
 */
function useDispersionFooter(
  result: WidgetEvaluationResult
): string | undefined {
  const t = useExtracted()
  // A hook rather than a helper taking `t`: extraction reads `t("…")` calls in the
  // function that called `useExtracted`, so strings in a helper handed a `t` are
  // silently left out of the catalogues.
  const sample = result.kind === "scalar" ? result.sample : undefined
  const dispersion = result.kind === "scalar" ? result.dispersion : undefined
  const named =
    dispersion === "range"
      ? t("full range")
      : dispersion === "interquartile-range"
        ? t("middle half")
        : dispersion === "median-absolute-deviation"
          ? t("typical distance from the middle")
          : t("standard deviation")
  // What the reading rests on, in its own units: a class average rests on members, and
  // "over 6 marks" under one would be describing a different number.
  const marks =
    sample?.unit === "members"
      ? t("among {count} sharing", { count: String(sample.count) })
      : t("over {count} marks", { count: String(sample?.count ?? 0) })
  if (!sample) return undefined
  return dispersion ? `${named} · ${marks}` : marks
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
function widgetIsSparkline(visualization: WidgetVisualization): boolean {
  // The recipe says so outright now — that is what a stored recipe buys. The axis checks
  // stay because a `line` recipe with every axis turned off is still scenery, and the
  // editor's own toggles can put a card there without changing the recipe.
  if (visualization.recipe === "sparkline") return true
  const mark = widgetMarkForRecipe(visualization.recipe)
  return (
    (mark === "line" || mark === "area") &&
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
  slots,
  difference,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualization
  slots: WidgetDatumSlots
  /** The plotted reading is itself a movement, so it has no “out of 20”. */
  difference: boolean
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
          difference={difference}
        />
        {!difference && delta !== null ? (
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
            slots={slots}
            height={130}
            difference={difference}
          />
        </div>
      )}
    </div>
  )
}

function WidgetStructuredResult({
  result,
  visualization,
  slots,
  showDelta,
}: {
  result: Extract<WidgetEvaluationResult, { kind: "structured" }>["value"]
  visualization: WidgetVisualization
  slots: WidgetDatumSlots
  showDelta: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const statusLabel = useStatusLabel()
  const { yearGraph, scale, decimals } = useYear()
  const entered = useEntered()
  const enter = useEnterValue()
  const mark = widgetMarkForRecipe(visualization.recipe) ?? "value"
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
      // Bands over the height the row gave the card, rather than lines at its
      // top — but only so far: see `BandGap`.
      <div className="flex h-full flex-col justify-center gap-2">
        {/* The name is the answer this card exists to give, so it wraps rather
            than truncating, and it is a way in to the grade itself. */}
        <Link
          href={`/grades/${result.gradeId}`}
          className={cn(NAME_TEXT, "break-words hover:underline")}
        >
          {result.name}
        </Link>
        <BandGap />
        <div
          className={cn(
            SUPPORT_TEXT,
            "flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground"
          )}
        >
          {grade ? (
            <GradeResultBadge grade={grade} />
          ) : (
            <ResultBadge ratio={result.ratio} />
          )}
          {/* Wraps rather than truncating: the subject is half the answer. */}
          <span className="min-w-0 break-words">{result.subjectName}</span>
        </div>
        <BandGap />
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
      <div className="flex h-full flex-col justify-center gap-2">
        <Link
          href={`/subjects/${result.subjectId}`}
          className={cn(NAME_TEXT, "break-words hover:underline")}
        >
          {result.name}
        </Link>
        <BandGap />
        {/* The average is this card's reading, so it is set as one — and the
            change reads beside it, on the same baseline, rather than under it. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <AverageValue
            ratio={result.ratio}
            showScale
            colored
            className={READING_TEXT}
          />
          <DeltaValue delta={result.delta} className={SUPPORT_TEXT} />
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
  if (result.kind === "required") {
    /**
     * The mark to get, and where.
     *
     * Three bands, and the order is the order the question is asked in: what do I
     * need, in which subject, and how far off am I. The mark is the headline
     * because it is the only part a reader can act on this afternoon.
     *
     * A required mark above the scale is shown as it is, not clamped: "you would
     * need 22 out of 20" is the honest answer to a goal that has slipped, and
     * rounding it to 20 would say the opposite. The status carries the verdict.
     */
    const next = result.next
    const unreachable =
      result.status === "unreachable" || (next !== null && !next.achievable)
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {next && !next.alreadySecured ? (
            <AverageValue
              ratio={next.requiredRatio}
              showScale
              className={cn(VALUE_TEXT, unreachable && "text-negative")}
            />
          ) : (
            <span className={cn(READING_TEXT, "text-muted-foreground")}>
              {result.status === "achieved" || next?.alreadySecured
                ? t("Nothing needed")
                : t("No route left")}
            </span>
          )}
          <span
            className={cn(
              "self-center rounded-full px-2 py-0.5 text-xs font-medium",
              unreachable
                ? "bg-negative/15 text-negative"
                : "bg-muted text-muted-foreground"
            )}
          >
            {statusLabel(result.status)}
          </span>
        </div>
        <BandGap />
        {next ? (
          <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>
            <Link
              href={`/subjects/${next.subjectId}`}
              className="hover:underline"
            >
              {next.subjectName}
            </Link>
            <span className="text-muted-foreground">
              {" · "}
              {t("coefficient {value}", {
                value: format.number(next.coefficient),
              })}
            </span>
          </p>
        ) : null}
        <BandGap />
        <p className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {result.horizon
            ? t("or {count} more at {mark}", {
                count: String(result.horizon.count),
                mark: format.number(result.horizon.requiredRatio * scale, {
                  maximumFractionDigits: 1,
                }),
              })
            : t("target {value}", {
                value: format.number(result.target * scale, {
                  maximumFractionDigits: decimals,
                }),
              })}
        </p>
      </div>
    )
  }
  if (result.kind === "control") {
    /**
     * The run of marks against the spread it has been running at.
     *
     * Its own branch rather than the projection band's: the two share a shape and make
     * different claims, and the renderer that draws "where the average could go" must not
     * be handed "where results have been" — the caption alone would be wrong.
     */
    return (
      <CardControl
        result={result}
        // `line` accepts the interval result itself. It removes the filled band but
        // keeps the observed run, centre, exact accessible values and caption.
        compact={visualization.recipe === "line"}
        showPoints={
          visualization.options.kind === "control"
            ? visualization.options.showPoints
            : true
        }
        scale={scale}
        decimals={decimals}
        ariaLabel={t("Where your ordinary results fall")}
      />
    )
  }
  if (result.kind === "band") {
    return (
      <CardBand
        ariaLabel={t("Where your average could end up")}
        result={result}
        // The shape-safe narrow fallback is the centre line. The exact low/high
        // values and the interval's meaning remain in the summary and caption.
        compact={visualization.recipe === "line"}
        opacity={
          visualization.options.kind === "band"
            ? visualization.options.opacity
            : 0.18
        }
        showCenter={
          visualization.options.kind === "band"
            ? visualization.options.showCenter
            : true
        }
        scale={scale}
        decimals={decimals}
      />
    )
  }
  if (result.kind === "waterfall") {
    if (mark === "lollipop") {
      return (
        <WidgetSeriesChart
          values={result.steps.map((step) => ({
            key: step.key,
            label: step.label,
            date: null,
            value: step.delta,
            delta: null,
            count: 0,
            series: null,
          }))}
          valueType="ratio"
          visualization={visualization}
          slots={slots}
          height={170}
        />
      )
    }
    return (
      <CardWaterfall
        ariaLabel={t("Why your average moved")}
        result={result}
        steps={
          visualization.options.kind === "waterfall"
            ? visualization.options.steps
            : 5
        }
        showTotals={
          visualization.options.kind === "waterfall"
            ? visualization.options.showTotals
            : true
        }
        scale={scale}
        decimals={decimals}
      />
    )
  }
  if (result.kind === "hierarchy") {
    // Core carries the node and not the words: it does not speak the reader's language,
    // and "Maths itself" is a sentence rather than a field. Shared by both drawings of
    // the tree, so they name a subject's own results the same way.
    const ownMarksLabel = (subject: string) =>
      t("{subject} itself", { subject })
    if (mark === "lollipop") {
      return (
        <WidgetSeriesChart
          values={result.nodes
            .filter((node) => node.parentId === null)
            .map((node) => ({
              key: node.id,
              label: node.label,
              date: null,
              value: node.value,
              delta: null,
              count: 0,
              series: null,
            }))}
          valueType="ratio"
          visualization={visualization}
          slots={slots}
          height={170}
        />
      )
    }
    // The recipe, not a derived mark: this function is handed the visualization and not
    // the mark, and a sunburst recipe is the sunburst mark — the two names coincide.
    if (visualization.recipe === "sunburst") {
      return (
        <CardSunburst
          ariaLabel={t("Weight in your average")}
          nodes={result.nodes}
          depth={
            visualization.options.kind === "sunburst"
              ? visualization.options.depth
              : 2
          }
          ringPadding={
            visualization.options.kind === "sunburst"
              ? visualization.options.ringPadding
              : 1
          }
          ownMarksLabel={ownMarksLabel}
        />
      )
    }
    return (
      <CardTreemap
        ariaLabel={t("Weight in your average")}
        nodes={result.nodes}
        depth={
          visualization.options.kind === "treemap"
            ? visualization.options.depth
            : 2
        }
        showLabels={
          visualization.options.kind === "treemap"
            ? visualization.options.showLabels
            : true
        }
        ownMarksLabel={ownMarksLabel}
      />
    )
  }
  if (result.kind === "standing") {
    /**
     * Where the reader stands in a group.
     *
     * The rank is the headline and everything else is the sentence that keeps it honest:
     * how many it is out of, how many members stayed private, and which group this even
     * is. "Third" on its own is a number a reader will carry around without any of that.
     */
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <TickNumber
            className={VALUE_TEXT}
            value={enter(result.rank ?? 0) ?? 0}
          />
          <span className={cn(SUPPORT_TEXT, "text-muted-foreground")}>
            {t("of {count}", { count: String(result.of) })}
          </span>
        </div>
        <BandGap />
        <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>
          {t("in {group}, among those sharing", { group: result.name })}
        </p>
        <p
          className={cn(
            FOOTNOTE_TEXT,
            "min-w-0 break-words text-muted-foreground"
          )}
        >
          {result.hidden > 0
            ? t(
                "{count} members keep theirs private · group average {average}",
                {
                  count: String(result.hidden),
                  average: format.number(result.groupAverage * scale, {
                    maximumFractionDigits: decimals,
                  }),
                }
              )
            : t("group average {average}", {
                average: format.number(result.groupAverage * scale, {
                  maximumFractionDigits: decimals,
                }),
              })}
        </p>
      </div>
    )
  }
  if (result.kind === "curves") {
    /**
     * Two averages over the same year.
     *
     * Both sides are already ratios, so the card hands them over as they are and only the
     * axis is turned back into marks — see `CardFriendCurves` for why plotting the raw
     * numbers would flatter whoever is marked out of the larger scale.
     */
    return (
      <CardFriendCurves
        name={result.name}
        mine={result.mine}
        theirs={result.theirs}
        scale={scale}
        decimals={decimals}
        ariaLabel={t("Your average and {name}'s", { name: result.name })}
      />
    )
  }
  if (result.kind === "subject-comparison") {
    return (
      <CardSubjectComparison
        name={result.name}
        rows={result.rows}
        hidden={result.hidden}
        scale={scale}
        decimals={decimals}
        // The same row budget a list card uses at this height: past it the table is a
        // texture rather than a reading, and the footer says how many were left out.
        limit={
          visualization.options.kind === "table"
            ? visualization.options.rows
            : 6
        }
        ariaLabel={t("Your subjects and {name}'s", { name: result.name })}
      />
    )
  }
  if (result.kind === "member") {
    /**
     * One member's average.
     *
     * The name is half the reading, so it is the line under the number rather than the
     * card's title — a card titled "Amélie" and showing 14.2 would be a card about a
     * person, and this is a card about a comparison the person agreed to.
     */
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <AverageValue ratio={enter(result.average)} className={VALUE_TEXT} />
        <BandGap />
        <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>{result.name}</p>
        <p
          className={cn(
            FOOTNOTE_TEXT,
            "min-w-0 break-words text-muted-foreground"
          )}
        >
          {result.from}
        </p>
      </div>
    )
  }
  if (result.kind === "impact") {
    /**
     * What one mark is costing, or worth.
     *
     * The *difference* is the headline, signed, because that is the surprise — "one mark
     * is costing you six tenths" — and the two averages are underneath so the reader can
     * check it. Said in the past tense throughout: the mark happened, and a card that
     * phrased this as an opportunity would be suggesting it can be undone.
     */
    const without = result.withoutMark - result.withMark
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <DeltaValue delta={without} className={VALUE_TEXT} />
          <span className={cn(SUPPORT_TEXT, "text-muted-foreground")}>
            {t("without it")}
          </span>
        </div>
        <BandGap />
        <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>
          {t("{mark} in {subject} · {before} would be {after}", {
            mark: format.number(result.ratio * scale, {
              maximumFractionDigits: decimals,
            }),
            subject: result.subjectName,
            before: format.number(result.withMark * scale, {
              maximumFractionDigits: decimals,
            }),
            after: format.number(result.withoutMark * scale, {
              maximumFractionDigits: decimals,
            }),
          })}
        </p>
        <p
          className={cn(
            FOOTNOTE_TEXT,
            "min-w-0 break-words text-muted-foreground"
          )}
        >
          {result.gradeName}
        </p>
      </div>
    )
  }
  if (result.kind === "priority") {
    /**
     * Where one more mark buys the most.
     *
     * The subject is the headline because it is the decision; the gain is the sentence
     * because it is what makes the decision worth taking. Said as a scenario — *would*
     * gain — since nothing here claims the mark will be got, and a card that promises a
     * gain is a card that will be wrong most weeks.
     */
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <p className={cn(NAME_TEXT, "min-w-0 break-words")}>
          {result.subjectName}
        </p>
        <BandGap />
        <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>
          {t("a {mark} here would add {gain} to your average", {
            mark: format.number(result.reference * scale, {
              maximumFractionDigits: decimals,
            }),
            gain: format.number(result.gain * scale, {
              maximumFractionDigits: Math.max(2, decimals),
            }),
          })}
        </p>
        <p
          className={cn(
            FOOTNOTE_TEXT,
            "min-w-0 break-words text-muted-foreground"
          )}
        >
          {t("usually {current} · {share}% of your average", {
            current: format.number((result.current ?? 0) * scale, {
              maximumFractionDigits: decimals,
            }),
            share: String(Math.round(result.leverage * 100)),
          })}
        </p>
      </div>
    )
  }
  if (result.kind === "anomaly") {
    /**
     * A recent mark that does not look like the rest.
     *
     * The mark is the headline and the distance is the sentence, in that order: a reader
     * recognises the result before they can use "two standard deviations". The sample is
     * said outright — a level measured from six marks is a different claim from one
     * measured from twenty — and the wording stays descriptive, because that is all this
     * reading is entitled to.
     */
    const below = result.deviations < 0
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <AverageValue ratio={enter(result.ratio)} className={VALUE_TEXT} />
          <span
            className={cn(
              "self-center rounded-full px-2 py-0.5 text-xs font-medium",
              below
                ? "bg-negative/15 text-negative"
                : "bg-positive/15 text-positive"
            )}
          >
            {below ? t("unusually low") : t("unusually high")}
          </span>
        </div>
        <BandGap />
        <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>
          {t(
            "{deviations} deviations from your usual {subject}, over {count} earlier marks",
            {
              deviations: format.number(Math.abs(result.deviations), {
                maximumFractionDigits: 1,
              }),
              subject: result.subjectName,
              count: String(result.sample),
            }
          )}
        </p>
        <p
          className={cn(
            FOOTNOTE_TEXT,
            "min-w-0 break-words text-muted-foreground"
          )}
        >
          {result.gradeName}
        </p>
      </div>
    )
  }
  if (result.kind === "concentration") {
    /**
     * How few subjects the average rests on.
     *
     * The share is the headline because it is the surprising half — "half of it" is what
     * makes two subjects a risk rather than an observation — and the sentence underneath
     * carries the count *and* how many subjects there are in total, without which two out
     * of three would read as alarming.
     *
     * The names are listed rather than summarised: the reading is only actionable if you
     * know which subjects they are.
     */
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <TickNumber
            className={VALUE_TEXT}
            // Mounts at zero and rolls up, like every other reading on the dashboard.
            value={enter(Math.round(result.share * 100)) ?? 0}
          />
          <span className={cn(SUPPORT_TEXT, "text-muted-foreground")}>%</span>
        </div>
        <BandGap />
        <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>
          {t("of your average rests on {count} of {total} subjects", {
            count: String(result.count),
            total: String(result.total),
          })}
        </p>
        <p
          className={cn(
            FOOTNOTE_TEXT,
            "min-w-0 break-words text-muted-foreground"
          )}
        >
          {result.subjects.map((subject) => subject.label).join(" · ")}
        </p>
      </div>
    )
  }
  if (result.kind === "margin") {
    /**
     * How much room is left, and what would take it.
     *
     * The mirror of the required mark, and the reading that matters once a goal is
     * held. Same three bands, same order: how much cushion, what spends it, and
     * against what target. The margin is signed — negative is a shortfall, and the
     * card says so in the negative colour rather than showing a cushion that is
     * not there.
     */
    const margin = result.margin
    const short = margin !== null && margin < 0
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* `DeltaValue` signs, colours and scales the number itself, so the
              raw ratio goes in rather than a scaled one. */}
          {margin === null ? (
            <span className={cn(READING_TEXT, "text-muted-foreground")}>
              {t("No data yet")}
            </span>
          ) : (
            <DeltaValue delta={margin} className={VALUE_TEXT} />
          )}
          <span
            className={cn(
              "self-center rounded-full px-2 py-0.5 text-xs font-medium",
              short
                ? "bg-negative/15 text-negative"
                : result.secured
                  ? "bg-positive/15 text-positive"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {result.secured ? t("Secured") : statusLabel(result.status)}
          </span>
        </div>
        <BandGap />
        {/* What would spend the cushion. Nothing to say when nothing remaining
            can lose the goal — a threat invented for symmetry is a lie. */}
        {result.breaking && !result.secured ? (
          <p className={cn(SUPPORT_TEXT, "min-w-0 break-words")}>
            {t("a mark under {mark} in {subject} loses it", {
              mark: format.number(result.breaking.ratio * scale, {
                maximumFractionDigits: 1,
              }),
              subject: result.breaking.subjectName,
            })}
          </p>
        ) : null}
        <BandGap />
        <p className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {t("target {value}", {
            value: format.number(result.target * scale, {
              maximumFractionDigits: decimals,
            }),
          })}
        </p>
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
      // The reading centres in the room above, the bar and its status hold the
      // bottom. Stacked at the top, this card left two thirds of a tall row blank.
      <div className="flex h-full flex-col justify-center gap-3">
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
  difference = false,
}: {
  value: number
  valueType: WidgetValueType
  delta: number | null
  visualization: WidgetVisualization
  gaugeMaximum?: number
  footer?: string
  compact?: boolean
  /** Render the headline as a signed movement, without an average denominator. */
  difference?: boolean
}) {
  const t = useExtracted()
  const { scale, decimals } = useYear()
  const gauge = widgetMarkForRecipe(visualization.recipe) === "gauge"
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
  const gaugeThickness = gaugeOptions?.thickness ?? "auto"
  const showValue = !gauge || gaugeOptions?.showValue !== false
  const showDelta = valueOptions?.showDelta === true && delta !== null
  const showTrend = valueOptions?.trendIndicator === true && delta !== null
  const threshold = [...visualization.thresholds]
    .sort((left, right) => left.value - right.value)
    .findLast((item) => value >= item.value)
  // The bar grows from nothing on the first paint, for the same reason the reels
  // start at zero: a gauge that is simply *there* at 68% never says it filled.
  const entered = useEntered()
  /**
   * The thresholds as a bullet's furniture.
   *
   * Sorted and paired into spans across the track, so `[0.5, 0.7]` becomes two
   * bands — half to seven tenths, and seven tenths to the top — rather than two
   * lines. The highest one is read as the target: it is the last thing the card
   * says it wants to clear.
   */
  const sortedThresholds = visualization.thresholds
    .map((item) => ({
      ratio: widgetGaugeFillRatio(
        item.value,
        gaugeMinimum,
        gaugeMaximum,
        visualization.scale.y.reverse
      ),
      color: item.color,
    }))
    .sort((left, right) => left.ratio - right.ratio)
  const bands = sortedThresholds.map((item, index) => ({
    key: `${index}:${item.ratio}`,
    from: item.ratio,
    to: sortedThresholds[index + 1]?.ratio ?? 1,
    color: item.color,
  }))
  const target = sortedThresholds.at(-1)?.ratio ?? null
  const figure = {
    valueType,
    format: visualization.format,
    scale,
    defaultDecimals: decimals,
    daysLabel: t("days"),
  }
  return (
    <div className="flex h-full flex-col gap-3">
      {/* The reading sits in the middle of whatever height is left over, and the
          bar and the footer below hold the bottom edge. Both used to be centred
          together, which left a gauge card with a band of nothing above the
          number and another below the bar. With neither, this is the plain
          centred figure it has always been. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">
        {showValue ? (
          <div
            className="flex items-center gap-2"
            style={{ color: threshold?.color ?? undefined }}
          >
            <CardFigure
              {...figure}
              value={value}
              difference={difference}
              className={cn(
                compact ? SUPPORT_TEXT : VALUE_TEXT,
                "font-semibold"
              )}
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
      </div>
      {gauge ? (
        // A hairline that thickens once the card is wide enough, not a pipe: the
        // number is the answer and the bar is its margin note. That is `"auto"`,
        // and it is the only way to ask for it — no stored number can describe a
        // bar that responds to the card's width. A card that named a thickness is
        // honoured literally, including when the number it named is the one this
        // renderer would have picked anyway.
        //
        // With thresholds it is a bullet: they become bands behind the fill, and
        // the highest of them becomes the target the reading is measured
        // against. Neither is a new field — a card that names where it wants to
        // get to has already said so as a threshold — and a gauge without any
        // draws exactly the bar it always did.
        <div
          className={cn(
            "relative overflow-hidden rounded-full bg-muted",
            gaugeThickness === "auto" && "h-1.5 @[20rem]/card:h-2"
          )}
          style={
            gaugeThickness === "auto" ? undefined : { height: gaugeThickness }
          }
        >
          {bands.map((band) => (
            <span
              key={band.key}
              aria-hidden
              className="absolute inset-y-0"
              style={{
                left: `${band.from * 100}%`,
                width: `${Math.max(0, band.to - band.from) * 100}%`,
                background: band.color ?? "var(--muted-foreground)",
                // Behind the reading, not competing with it: a band is context.
                opacity: 0.16,
              }}
            />
          ))}
          <div
            className="relative h-full rounded-full bg-primary transition-[width] duration-500"
            style={{
              width: `${Math.round((entered ? gaugeRatio : 0) * 100)}%`,
              backgroundColor: threshold?.color ?? undefined,
            }}
          />
          {target === null ? null : (
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 bg-foreground"
              style={{
                left: `${target * 100}%`,
                // A target on the far edge would be clipped by the rounded end.
                transform: target > 0.98 ? "translateX(-100%)" : undefined,
              }}
            />
          )}
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
  difference = false,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualization
  showDelta?: boolean
  difference?: boolean
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
                  signed={difference}
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

/**
 * The table's secondary columns, in the order they earn their width.
 *
 * A count is context and a change is a second reading; the name and the value
 * are the card's answer, and they are what a narrow card keeps. Read from the
 * card's own container, so a table in a quarter-width column behaves the same
 * whether the window is wide or not.
 */
const COUNT_COLUMN = "hidden @[15rem]/card:table-cell"
const DELTA_COLUMN = "hidden @[18rem]/card:table-cell"

function WidgetSeriesTable({
  values,
  valueType,
  visualization,
  showDelta = false,
  difference = false,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualization
  showDelta?: boolean
  difference?: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, decimals } = useYear()
  const hasDelta = showDelta && values.some((item) => item.delta !== null)
  return (
    // Still a scroller, because a name can be longer than any card — but the
    // columns drop before it comes to that. Four columns need 239px of body:
    // measured in a 154px card, where the table ran 85px past its box and the
    // reader had to drag a card sideways to read a number. Name and value fit
    // anywhere, so the two that are context rather than answer wait for the
    // width to exist.
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">{t("Name")}</th>
            <th className="pb-2 text-right font-medium">{t("Value")}</th>
            {hasDelta ? (
              <th className={cn("pb-2 text-right font-medium", DELTA_COLUMN)}>
                {t("Change")}
              </th>
            ) : null}
            <th className={cn("pb-2 text-right font-medium", COUNT_COLUMN)}>
              {t("Count")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {values.map((item) => (
            <tr key={item.key}>
              {/* `anywhere` rather than `break-words`: only the former lowers the
                  cell's min-content width, and in a table that width is what
                  sets the column. `break-words` wraps a long name and still
                  demands room for its longest word. */}
              <td className="min-w-0 py-2 pr-3 [overflow-wrap:anywhere]">
                {item.label}
              </td>
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
                    signed={difference}
                  />
                )}
              </td>
              {hasDelta ? (
                <td
                  className={cn(
                    "py-2 text-right text-muted-foreground",
                    DELTA_COLUMN
                  )}
                >
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
              <td
                className={cn(
                  "numeric py-2 text-right text-muted-foreground",
                  COUNT_COLUMN
                )}
              >
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
  visualization: WidgetVisualization
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
      className="flex h-full min-h-36 flex-col justify-center gap-4"
      aria-label={t("Box plot")}
    >
      {/* A band, not a strip: it takes a share of whatever height the row gave
          the card, with 3.5rem as the floor it insists on. */}
      <div className="relative mx-2 h-14 max-h-24 min-h-14 flex-1">
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

function WidgetSeriesChart({
  values,
  valueType,
  visualization,
  slots,
  height,
  difference = false,
}: {
  values: Array<WidgetSeriesDatum & { good?: boolean }>
  valueType: WidgetValueType
  visualization: WidgetVisualization
  /** Which slot of a datum each channel meant — resolved by the body, see `widgetDatumSlots`. */
  slots: WidgetDatumSlots
  height: number
  /** The measure's value slot is a signed distance; explicit delta slots override it. */
  difference?: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, decimals } = useYear()
  const { seriesBudget } = useContext(WidgetResponsiveContext)
  const limited = useMemo(
    () => limitWidgetSeries(values, seriesBudget),
    [seriesBudget, values]
  )
  const visibleValues = limited.values
  /**
   * The point under the pointer.
   *
   * `focusRing: false` below turns off the renderer's own halo — a Canvas-filled
   * circle that reads white on a light card — and turning it off without putting
   * anything back is what left every card chart, and every insights study, with
   * a tooltip and no sign of *which* point it described.
   *
   * Held in React and handed back to the spec, which is how the radar closes the
   * same hole: no radial mark takes a focus state, so the host reports focus and
   * React rebuilds the definition with an explicit marker. The alternative — a
   * `states` entry on the mark, the way the general-average chart does it — needs
   * a focus strategy for the condition to mean something, and these charts ask
   * for plain `"nearest"`.
   */
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const xField =
    slots.x ??
    (visibleValues.some((item) => item.date !== null) ? "date" : "category")
  const yField = slots.y ?? "value"
  const colorField = slots.color ?? null
  const yValueType = widgetEncodingValueType(yField, valueType)
  const colorValueType = colorField
    ? widgetEncodingValueType(colorField, valueType)
    : valueType
  const formatYShownValue = useShownWidgetValueFormatter(
    visualization,
    scale,
    decimals,
    widgetChannelValueIsDelta(yField, difference)
  )
  const formatColorShownValue = useShownWidgetValueFormatter(
    visualization,
    scale,
    decimals,
    widgetChannelValueIsDelta(colorField, difference)
  )
  const formatDifferenceShownValue = useShownWidgetValueFormatter(
    visualization,
    scale,
    decimals,
    true
  )
  const temporal = xField === "date"
  const numericX = xField !== "date" && xField !== "category"
  const prepared = useMemo(
    () =>
      visibleValues.flatMap((item) => {
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
    [colorField, scale, valueType, visibleValues, visualization, xField, yField]
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
  const mark = widgetMarkForRecipe(visualization.recipe) ?? "value"
  const colorRange = colorDomain.map(
    (_, index) => AVERAGE_SERIES_COLORS[index % AVERAGE_SERIES_COLORS.length]
  )
  const hasVisualColor = colorDomain.length > 0
  const stacked =
    hasSeries &&
    mark === "bar" &&
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
    // A bar and a lollipop encode magnitude from a baseline, so the baseline has
    // to be inside the plot. Left to a [min, max] domain, `mostImproved` — whose
    // values are all positive deltas — drew its bars from zero, which sat 39px
    // below the plot, and the renderer clipped them: a bar chart missing the
    // bottom of every bar. Forcing zero is also the honest reading, since a
    // truncated bar axis misstates every ratio between the bars.
    stacked ||
      visualization.scale.y.zero ||
      mark === "bar" ||
      mark === "lollipop",
    configuredMin,
    configuredMax
  )
  /**
   * Categories down the side and values across.
   *
   * A bar or a lollipop is turned on request; a slope arrow and a dumbbell are only
   * ever drawn that way — a row per category, with the movement or the pair read
   * left to right. This was missed when the slope arrow landed, and it did not fail
   * loudly: the marks placed the category on `y` while the axes were still built
   * with the category band on `x`, so every head resolved against the wrong scale,
   * fell outside the plot and was clipped. Measured on the bench: twelve lines and
   * **zero** heads on `mostImproved · slope-arrow`. A chart with no overflow and no
   * text passes a geometry sweep while drawing nothing.
   */
  const horizontal =
    mark === "slope-arrow" ||
    mark === "dumbbell" ||
    ((visualization.options.kind === "bar" ||
      visualization.options.kind === "lollipop") &&
      visualization.options.orientation === "horizontal")
  const curve =
    visualization.options.kind === "line" ||
    visualization.options.kind === "area"
      ? visualization.options.curve === "linear"
        ? curveLinear
        : visualization.options.curve === "step"
          ? curveStep
          : curveMonotoneX
      : curveLinear
  const definition = (() => {
    const seriesChannels = {
      ...(hasSeries ? { z: "series" as const } : {}),
      ...(hasVisualColor
        ? { color: colorField ? ("colorKey" as const) : ("series" as const) }
        : {}),
    }
    const constantStroke = hasVisualColor ? {} : { stroke: "var(--chart-1)" }
    const constantFill = hasVisualColor ? {} : { fill: "var(--chart-1)" }
    /**
     * A marker, not data: one constant-coloured dot over the focused point,
     * ringed in the card's own background so it reads on a line of any colour.
     */
    const focusedDatum =
      focusedKey === null
        ? null
        : (plotted.find((item) => String(item.key) === focusedKey) ?? null)
    const activePoint = focusedDatum
      ? [
          dot([focusedDatum], {
            id: "widget-active-point",
            x: "x",
            y: "y",
            key: "key",
            r: 5,
            fill: "var(--chart-1)",
            stroke: "var(--background)",
            strokeWidth: 2,
          }),
        ]
      : []

    /**
     * Every distinct x: the band's domain, and the count that decides how much air a bar
     * can spare.
     *
     * The *values*, not their string forms. A band scale looks a datum up by identity, so a
     * domain of `["1767571200000", …]` and a datum whose x is the number `1767571200000`
     * never meet: measured, every weekly bar came out with the right width and `x="NaN"`.
     * A category's x is already a string and a bucket's is a timestamp, and the scale takes
     * either.
     */
    const categoryDomain: Array<string | number> = [
      ...new Set(
        plotted.map((item) =>
          typeof item.x === "number" ? item.x : String(item.x)
        )
      ),
    ]
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
          ...activePoint,
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
          ...activePoint,
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
          ...activePoint,
        ]
      }
      if (mark === "lollipop") {
        // A stem to the baseline and a head at the reading. The head keeps a
        // point's precision where a bar's edge blurs into its neighbour, which
        // is why this is the fallback a bar narrows into.
        const head =
          visualization.options.kind === "lollipop"
            ? visualization.options.size / 2
            : 4
        return [
          ...(horizontal
            ? [
                ruleY(plotted, {
                  id: "widget-lollipop-stems",
                  y: "x",
                  x1: domain[0],
                  x2: "y",
                  key: "key",
                  ...constantStroke,
                  strokeWidth: 2,
                  strokeOpacity: 0.45,
                }),
              ]
            : [
                ruleX(plotted, {
                  id: "widget-lollipop-stems",
                  x: "x",
                  y1: domain[0],
                  y2: "y",
                  key: "key",
                  ...constantStroke,
                  strokeWidth: 2,
                  strokeOpacity: 0.45,
                }),
              ]),
          dot(plotted, {
            id: "widget-lollipop-heads",
            ...(horizontal ? { x: "y", y: "x" } : { x: "x", y: "y" }),
            key: "key",
            r: head,
            ...constantFill,
          }),
          ...activePoint,
        ]
      }
      if (mark === "slope-arrow") {
        // Where each category began and where it is now. The result carries the
        // movement as `delta`, so the start is `value - delta` — a derivation,
        // not a new channel, and it is only meaningful where a delta exists.
        const moved = plotted.flatMap((item) =>
          typeof item.delta === "number" && typeof item.y === "number"
            ? [
                {
                  ...item,
                  delta: item.delta,
                  // Both ends in the *same* units. `item.y` is the encoded value — the
                  // mark a reader sees, 15.7 rather than 0.785 — while `item.delta` is the
                  // datum's own ratio, so subtracting one from the other put the tail
                  // wherever the arithmetic landed: measured on the bench, a dumbbell of
                  // subject improvements drew its "before" end at 29.8 on a scale of 20.
                  from:
                    item.y -
                    (widgetNumericEncodedValue(
                      item,
                      "delta",
                      valueType,
                      visualization,
                      scale
                    ) ?? 0),
                },
              ]
            : []
        )
        // Split by direction rather than coloured by a callback: a rule takes a
        // constant stroke, and two marks say the same thing without asking the
        // renderer for a channel it does not offer here.
        const rising = moved.filter((item) => item.delta >= 0)
        const falling = moved.filter((item) => item.delta < 0)
        const shaft = (data: typeof moved, id: string, color: string) =>
          ruleY(data, {
            id,
            y: "x",
            x1: "from",
            x2: "y",
            key: "key",
            stroke: color,
            strokeWidth: 2,
          })
        const head = (data: typeof moved, id: string, color: string) =>
          dot(data, {
            id,
            x: "y",
            y: "x",
            key: "key",
            r: 5,
            fill: color,
            stroke: "var(--background)",
            strokeWidth: 2,
          })
        return [
          ...(rising.length
            ? [
                shaft(rising, "widget-slope-shafts-up", "var(--positive)"),
                head(rising, "widget-slope-heads-up", "var(--positive)"),
              ]
            : []),
          ...(falling.length
            ? [
                shaft(falling, "widget-slope-shafts-down", "var(--negative)"),
                head(falling, "widget-slope-heads-down", "var(--negative)"),
              ]
            : []),
          // Where it started, on every row, so the arrow has a tail to read from.
          dot(moved, {
            id: "widget-slope-starts",
            x: "from",
            y: "x",
            key: "key",
            r: 3,
            fill: "var(--muted-foreground)",
          }),
          /**
           * The movement, said as a number — `slope-arrow.showLabels`.
           *
           * Saved by the editor, read by nobody, so the toggle changed nothing. An arrow
           * carries its direction in its shape and its *size* only against an axis; the
           * label is the difference itself, which is the reading the card is about.
           */
          ...(visualization.options.kind === "slope-arrow" &&
          visualization.options.showLabels
            ? [
                text(moved, {
                  id: "widget-slope-labels",
                  x: "y",
                  y: "x",
                  key: "key",
                  text: (item: (typeof moved)[number]) =>
                    formatDifferenceShownValue(
                      widgetNumericEncodedValue(
                        item,
                        "delta",
                        valueType,
                        visualization,
                        scale
                      ) ?? 0,
                      valueType
                    ),
                  dx: 8,
                  anchor: "start",
                  fontSize: 10,
                  fill: (item: (typeof moved)[number]) =>
                    item.delta >= 0 ? "var(--positive)" : "var(--negative)",
                }),
              ]
            : []),
        ]
      }
      if (mark === "dumbbell") {
        /**
         * Two ends and the distance between them.
         *
         * The same pair a slope arrow draws — `value` and `value - delta` — read as
         * a comparison rather than as a movement. The difference is not cosmetic:
         * an arrow says *this went up*, and is right only when the pair is a before
         * and an after; a dumbbell says *these two differ by this much*, which is
         * also the honest drawing for a period against a period, a subject against
         * the general average, or a result against a target. Neither end is
         * privileged, so neither is coloured by direction — the segment carries the
         * comparison and the two heads are told apart by weight, not by hue.
         */
        const paired = plotted.flatMap((item) =>
          typeof item.delta === "number" && typeof item.y === "number"
            ? [
                {
                  ...item,
                  delta: item.delta,
                  // Both ends in the *same* units. `item.y` is the encoded value — the
                  // mark a reader sees, 15.7 rather than 0.785 — while `item.delta` is the
                  // datum's own ratio, so subtracting one from the other put the tail
                  // wherever the arithmetic landed: measured on the bench, a dumbbell of
                  // subject improvements drew its "before" end at 29.8 on a scale of 20.
                  from:
                    item.y -
                    (widgetNumericEncodedValue(
                      item,
                      "delta",
                      valueType,
                      visualization,
                      scale
                    ) ?? 0),
                },
              ]
            : []
        )
        // The card's own size, rather than the five pixels this drew whatever the document
        // said. `dumbbell.size` is a diameter, as the dot's is.
        const head =
          visualization.options.kind === "dumbbell"
            ? visualization.options.size / 2
            : 5
        return [
          ruleY(paired, {
            id: "widget-dumbbell-bars",
            y: "x",
            x1: "from",
            x2: "y",
            key: "key",
            stroke: "var(--muted-foreground)",
            strokeWidth: 2,
            strokeOpacity: 0.4,
          }),
          // The earlier end, hollow: present, and clearly not the answer.
          dot(paired, {
            id: "widget-dumbbell-from",
            x: "from",
            y: "x",
            key: "key",
            r: head,
            fill: "var(--background)",
            stroke: "var(--muted-foreground)",
            strokeWidth: 2,
          }),
          dot(paired, {
            id: "widget-dumbbell-to",
            x: "y",
            y: "x",
            key: "key",
            r: head,
            ...constantFill,
            stroke: "var(--background)",
            strokeWidth: 2,
          }),
          /**
           * Both ends, said as numbers — `dumbbell.showLabels`.
           *
           * The option was saved and read by nobody, so a card asking for its values
           * labelled got the same two circles as one that did not. A dumbbell without them
           * says *that* something moved and leaves the reader to guess the distance off an
           * axis; with them it says from what to what.
           */
          ...(visualization.options.kind === "dumbbell" &&
          visualization.options.showLabels
            ? [
                text(paired, {
                  id: "widget-dumbbell-labels-from",
                  x: "from",
                  y: "x",
                  key: "key",
                  // Already in the reader's own marks — `plotted` carries the encoded
                  // value — so scaling here would multiply by twenty twice.
                  text: (item: (typeof paired)[number]) =>
                    format.number(item.from, {
                      maximumFractionDigits: decimals,
                    }),
                  dx: -(head + 4),
                  anchor: "end",
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }),
                text(paired, {
                  id: "widget-dumbbell-labels-to",
                  x: "y",
                  y: "x",
                  key: "key",
                  text: (item: (typeof paired)[number]) =>
                    format.number(item.y as number, {
                      maximumFractionDigits: decimals,
                    }),
                  dx: head + 4,
                  anchor: "start",
                  fontSize: 10,
                  fill: "var(--foreground)",
                }),
              ]
            : []),
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
          /**
           * Breathing room, and only where there is room to breathe.
           *
           * The band's own `padding` already separates neighbours proportionally; this is
           * an extra three pixels off *each* edge, generous at five bars and ruinous at
           * twenty-three: a week's band is under ten pixels wide, so six of them left the
           * bars one pixel wide. Measured on the bench, on the cumulative card.
           */
          inset: categoryDomain.length <= 8 ? 3 : 0,
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
    // Bars are banded whatever their axis says, for the reason spelled out on the scale
    // below. Everything else keeps a linear time axis, where the distance between two
    // readings is the time between them.
    const banded = mark === "bar"
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
      /**
       * Measured, because one thing in here is a function of the card's own width:
       * how much room a category name down the side may take. A fixed character
       * count would smear on a phone and truncate needlessly on a wide card.
       */
      chart: ({ width }: { width: number }) => ({
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
              /**
               * A bar takes its thickness from a band, so a bar chart gets one.
               *
               * `barY` has no width option: the thickness comes from the band layout, and
               * on a linear scale there is no band — measured on the bench, twenty-three
               * weekly bars with correct *heights* and a width of zero, which is a chart
               * that draws its data and shows nothing. Every bar card over a time axis was
               * blank, including the cumulative one and the stacked one.
               *
               * A band is also the truer statement: a bar over a week occupies the week,
               * where a line's point marks the instant it was read at.
               */
              scale:
                (temporal || numericX) && !banded
                  ? scaleLinear().domain(xDomain)
                  : scaleBand<string | number>()
                      .domain(categoryDomain)
                      .padding(0.12),
              grid: visualization.axes.x.grid,
              reverse: visualization.scale.x.reverse,
              axis: visualization.axes.x.visible
                ? {
                    line: false,
                    label: visualization.axes.x.label ?? undefined,
                    ticks: temporal
                      ? {
                          // Banded, the tick *is* the bucket's timestamp as a string —
                          // the band's own domain value — so it is read back before it is
                          // formatted rather than being printed as a number of
                          // milliseconds.
                          format: (value: number | string) =>
                            format.dateTime(new Date(Number(value)), {
                              day: "numeric",
                              month: "short",
                            }),
                        }
                      : {
                          size: 0,
                          /**
                           * Names under the chart, cut to the same share as names beside
                           * it — see `axisNameAtWidth`.
                           *
                           * The renderer thins labels that collide, but it still reserves
                           * room for the *widest* one, and one 68-character subject name
                           * pushed the plot to x = 176 of a 228px card: six bands 0.16px
                           * wide, six bars of no width, and a chart that drew its data and
                           * showed nothing. Measured on the bench.
                           */
                          format: (value: number | string) =>
                            axisNameAtWidth(String(value), width),
                        },
                  }
                : false,
            },
        y: horizontal
          ? {
              scale: scaleBand<string | number>()
                .domain(categoryDomain)
                .padding(0.12),
              grid: false,
              reverse: visualization.scale.x.reverse,
              axis: visualization.axes.x.visible
                ? {
                    label: visualization.axes.x.label ?? undefined,
                    // Names down the left of a sideways chart, cut to their share of the
                    // card — see `axisNameAtWidth`. Unbudgeted, one long subject name
                    // reserved more width than the card had and every bar was drawn a pixel
                    // wide beyond the right edge.
                    ticks: {
                      format: (label: string) => axisNameAtWidth(label, width),
                    },
                  }
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
      }),
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
                  value: formatColorShownValue(item.colorValue, colorValueType),
                }
              : null
          return {
            title: item?.label,
            rows: item
              ? [
                  {
                    color: "var(--chart-1)",
                    label: item.series ?? t("Value"),
                    value: formatYShownValue(item.y, yValueType),
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
          ? `${formatColorShownValue(bucket.from, colorValueType)}–${formatColorShownValue(bucket.to, colorValueType)}`
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
    // `h-full`, and the chart box is `flex-1` with the old fixed height as its
    // floor. A row is as tall as its tallest card, and a chart pinned to 170px
    // spent 36% of a 477px card and left the rest blank — `ResponsiveChart`
    // already knew how to absorb a box, nothing here had ever asked it to.
    // The floor belongs to the *body*, not to the chart box. On the box it
    // ignored its own siblings: a card with a legend or a threshold list asked
    // for 170px of chart plus 39px of labels inside a 170px body, and the labels
    // fell out of the card. Asked for out here, the row grows to hold both and
    // the chart keeps a floor of its own that a legend cannot squeeze away.
    <div
      className="flex h-full flex-col gap-2 text-muted-foreground"
      style={{ minHeight: height }}
    >
      {visualization.legend.position === "top" ? legend : null}
      <div
        className={cn(
          // A flex column, so the box below it is a flex child with a definite
          // height. Left as a plain block, `flex-1` on that child was inert, its
          // height collapsed to nothing, and `fill` measured a one-pixel chart:
          // every curve was present in the DOM and flat on the screen.
          "flex min-h-0 min-w-0 flex-1 flex-col",
          "min-h-24",
          rightLegend &&
            "grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)] items-center gap-4"
        )}
      >
        {/* The renderer reports focus, and this makes sure it reports the end of
            it: a marker that outlives the pointer is worse than none, and the
            leave path is the one the renderer does not always announce. */}
        <div
          className="min-h-0 min-w-0 flex-1"
          onPointerLeave={() => setFocusedKey(null)}
        >
          <ResponsiveChart
            ariaLabel={t("Custom insight chart")}
            definition={definition}
            fill
            height={height}
            initialWidth={expandedWidth(height)}
            onFocusChange={(point) =>
              setFocusedKey(
                point?.datum
                  ? String((point.datum as { key: unknown }).key)
                  : null
              )
            }
            updateTransition={INSTANT_CHART_UPDATES}
          />
        </div>
        {rightLegend ? legend : null}
      </div>
      {visualization.legend.position === "bottom" ? legend : null}
      {limited.hiddenSeries.length > 0 ? (
        <p className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {t("{count} more not shown", {
            count: String(limited.hiddenSeries.length),
          })}
          <span className="sr-only">: {limited.hiddenSeries.join(", ")}</span>
        </p>
      ) : null}
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
