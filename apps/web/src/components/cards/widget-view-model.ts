import {
  widgetCapability,
  widgetMeasureHasIntrinsicDelta,
  widgetPrimaryMeasure,
  widgetMeasureId,
  type GoalPlan,
  type WidgetDefinition,
  type WidgetDatumSlotName,
  type WidgetSeriesDatum,
  type WidgetValueType,
  type WidgetVisualization,
} from "@avermate/core"

export function widgetGoalPresentation(
  plan: Pick<GoalPlan, "current" | "target" | "status">
) {
  if (plan.current === null) {
    return {
      current: null,
      target: plan.target,
      status: plan.status,
      hasCurrent: false,
    } as const
  }
  return {
    current: plan.current,
    target: plan.target,
    status: plan.status,
    hasCurrent: true,
  } as const
}

export function widgetDefinitionValueType(
  definition: WidgetDefinition
): WidgetValueType {
  const measure = widgetPrimaryMeasure(definition.analysis)
  return measure.kind === "formula"
    ? measure.valueType
    : widgetCapability(widgetMeasureId(measure)).valueType
}

export function widgetDefinitionShowsDelta(
  definition: WidgetDefinition
): boolean {
  return (
    definition.analysis.comparison.kind !== "none" ||
    widgetMeasureHasIntrinsicDelta(widgetPrimaryMeasure(definition.analysis))
  )
}

/** Whether the headline is itself a signed movement rather than a level. */
export function widgetMeasureValueIsDelta(
  measure: WidgetDefinition["analysis"]["measures"][number]["expression"]
): boolean {
  return (
    measure.kind === "metric" &&
    (measure.metric === "averageTrend" ||
      measure.metric === "improvement" ||
      measure.metric === "mostImproved" ||
      measure.metric === "cohortGap")
  )
}

export function widgetDefinitionValueIsDelta(
  definition: WidgetDefinition
): boolean {
  return widgetMeasureValueIsDelta(widgetPrimaryMeasure(definition.analysis))
}

/** Whether one rendered channel carries a signed movement rather than a level. */
export function widgetChannelValueIsDelta(
  slot: WidgetDatumSlotName | null,
  measureValueIsDelta: boolean
): boolean {
  return slot === "delta" || (slot === "value" && measureValueIsDelta)
}

export function widgetDisplayValue(
  value: number,
  valueType: WidgetValueType,
  unit: WidgetVisualization["format"]["unit"],
  scale: number
): number {
  const resolved = unit === "auto" ? valueType : unit
  if (resolved === "ratio") return value * scale
  if (resolved === "percent") return value * 100
  return value
}

export function widgetEncodingValueType(
  field: WidgetDatumSlotName,
  resultValueType: WidgetValueType
): WidgetValueType {
  if (field === "count") return "count"
  if (field === "date") return "number"
  return resultValueType
}

export function widgetEncodedScaleValue(
  value: number,
  field: WidgetDatumSlotName,
  resultValueType: WidgetValueType,
  visualization: WidgetVisualization,
  scale: number
): number {
  return widgetDisplayValue(
    value,
    widgetEncodingValueType(field, resultValueType),
    visualization.format.unit,
    scale
  )
}

export function widgetResolvedUnit(
  valueType: WidgetValueType,
  unit: WidgetVisualization["format"]["unit"]
): WidgetValueType | Exclude<WidgetVisualization["format"]["unit"], "auto"> {
  return unit === "auto" ? valueType : unit
}

export interface WidgetValuePresentation {
  displayed: number
  decimals: number
  compact: boolean
  unit: ReturnType<typeof widgetResolvedUnit>
}

export function widgetValuePresentation(
  value: number,
  valueType: WidgetValueType,
  format: WidgetVisualization["format"],
  scale: number,
  defaultDecimals: number
): WidgetValuePresentation {
  const unit = widgetResolvedUnit(valueType, format.unit)
  const decimals =
    format.decimals ??
    (unit === "ratio" ? defaultDecimals : unit === "number" ? 2 : 0)

  return {
    displayed: widgetDisplayValue(value, valueType, format.unit, scale),
    decimals,
    compact: format.compact,
    unit,
  }
}

export function widgetNumericDomain(
  values: readonly number[],
  zero: boolean,
  configuredMinimum: number | null,
  configuredMaximum: number | null
): [number, number] {
  const finite = values.filter(Number.isFinite)
  const inferredMinimum = finite.length > 0 ? Math.min(...finite) : 0
  const inferredMaximum = finite.length > 0 ? Math.max(...finite) : 1
  const minimum =
    configuredMinimum ?? (zero ? Math.min(0, inferredMinimum) : inferredMinimum)
  const maximum =
    configuredMaximum ?? (zero ? Math.max(0, inferredMaximum) : inferredMaximum)

  if (minimum !== maximum) return [minimum, maximum]
  const padding = Math.max(1, Math.abs(minimum) * 0.05)
  return [minimum - padding, maximum + padding]
}

export function widgetSeriesDomainValues(
  values: ReadonlyArray<{ x: string | number; y: number }>,
  stacked: boolean
): number[] {
  if (!stacked) return values.map((item) => item.y)

  const totals = new Map<string, { positive: number; negative: number }>()
  for (const item of values) {
    const key = `${typeof item.x}:${String(item.x)}`
    const total = totals.get(key) ?? { positive: 0, negative: 0 }
    if (item.y >= 0) total.positive += item.y
    else total.negative += item.y
    totals.set(key, total)
  }
  return [...totals.values()].flatMap((total) => [
    total.negative,
    total.positive,
  ])
}

export function widgetGaugeFillRatio(
  value: number,
  minimum: number,
  maximum: number,
  reverse: boolean
): number {
  const range = Math.max(Number.EPSILON, maximum - minimum)
  const ratio = Math.max(0, Math.min(1, (value - minimum) / range))
  return reverse ? 1 - ratio : ratio
}

export function widgetNumericEncodedValue(
  item: WidgetSeriesDatum,
  field: WidgetDatumSlotName,
  valueType: WidgetValueType,
  visualization: WidgetVisualization,
  scale: number
): number | null {
  if (field === "count") return item.count
  if (field === "delta") {
    if (item.delta === null) return null
    return widgetEncodedScaleValue(
      item.delta,
      field,
      valueType,
      visualization,
      scale
    )
  }
  if (field === "date") return item.date?.getTime() ?? null
  if (item.value === null) return null
  return widgetEncodedScaleValue(
    item.value,
    field,
    valueType,
    visualization,
    scale
  )
}

export function widgetEncodedValue(
  item: WidgetSeriesDatum,
  field: WidgetDatumSlotName,
  valueType: WidgetValueType,
  visualization: WidgetVisualization,
  scale: number
): string | number | null {
  if (field === "date") return item.date?.getTime() ?? null
  if (field === "category") return item.label
  return widgetNumericEncodedValue(item, field, valueType, visualization, scale)
}

export function widgetThresholdColor(
  value: number,
  thresholds: WidgetVisualization["thresholds"]
): string | null {
  return (
    [...thresholds]
      .sort((left, right) => left.value - right.value)
      .findLast((threshold) => value >= threshold.value)?.color ?? null
  )
}

export function widgetEncodedThresholdColor(
  shownValue: number,
  field: WidgetDatumSlotName,
  resultValueType: WidgetValueType,
  visualization: WidgetVisualization,
  scale: number
): string | null {
  return (
    [...visualization.thresholds]
      .sort((left, right) => left.value - right.value)
      .findLast(
        (threshold) =>
          shownValue >=
          widgetEncodedScaleValue(
            threshold.value,
            field,
            resultValueType,
            visualization,
            scale
          )
      )?.color ?? null
  )
}

export function widgetColorValue(
  item: WidgetSeriesDatum,
  field: WidgetDatumSlotName,
  valueType: WidgetValueType,
  visualization: WidgetVisualization,
  scale: number
): string | number | null {
  if (field === "category") return item.series ?? item.label
  return widgetNumericEncodedValue(item, field, valueType, visualization, scale)
}

export function widgetEncodedSeriesDatum(
  item: WidgetSeriesDatum,
  xField: WidgetDatumSlotName,
  yField: WidgetDatumSlotName,
  colorField: WidgetDatumSlotName | null,
  valueType: WidgetValueType,
  visualization: WidgetVisualization,
  scale: number
): {
  x: string | number
  y: number
  colorValue: string | number | null
} | null {
  const x = widgetEncodedValue(item, xField, valueType, visualization, scale)
  const y = widgetNumericEncodedValue(
    item,
    yField,
    valueType,
    visualization,
    scale
  )
  const colorValue = colorField
    ? widgetColorValue(item, colorField, valueType, visualization, scale)
    : null

  if (
    x === null ||
    y === null ||
    (colorField !== null && colorValue === null)
  ) {
    return null
  }
  return { x, y, colorValue }
}

export interface WidgetColorBucket {
  key: string
  from: number
  to: number
}

/** A small quantized palette stays legible in compact dashboard cards. */
export function widgetColorBuckets(
  values: readonly number[]
): WidgetColorBucket[] {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return []
  const minimum = Math.min(...finite)
  const maximum = Math.max(...finite)
  if (minimum === maximum) {
    return [{ key: `${minimum}:${maximum}`, from: minimum, to: maximum }]
  }
  const count = Math.min(5, Math.max(2, new Set(finite).size))
  const step = (maximum - minimum) / count
  return Array.from({ length: count }, (_, index) => ({
    key: `${minimum + step * index}:${index === count - 1 ? maximum : minimum + step * (index + 1)}`,
    from: minimum + step * index,
    to: index === count - 1 ? maximum : minimum + step * (index + 1),
  }))
}

export function widgetColorBucketKey(
  value: number,
  buckets: readonly WidgetColorBucket[]
): string | null {
  if (buckets.length === 0 || !Number.isFinite(value)) return null
  return (
    buckets.find(
      (bucket, index) =>
        value >= bucket.from &&
        (index === buckets.length - 1 ? value <= bucket.to : value < bucket.to)
    )?.key ??
    buckets.at(-1)?.key ??
    null
  )
}
