import type {
  WidgetDatumSlotName,
  WidgetDatumSlots,
  WidgetScaleSpec,
  WidgetSeriesDatum,
  WidgetVisualization,
} from "@avermate/core";

export interface WidgetNumericDomain {
  minimum: number;
  maximum: number;
}

/** Resolves one quantitative domain exactly once for marks, cells and legends. */
export function widgetNumericDomain(
  values: readonly number[],
  scale: WidgetScaleSpec,
): WidgetNumericDomain {
  const rawMinimum = values.length > 0 ? Math.min(...values) : 0;
  const rawMaximum = values.length > 0 ? Math.max(...values) : 1;
  const minimum =
    scale.min ?? (scale.zero ? Math.min(0, rawMinimum) : rawMinimum);
  const maximum =
    scale.max ?? (scale.zero ? Math.max(0, rawMaximum) : rawMaximum);
  return { minimum, maximum };
}

export function widgetColorIndex(
  value: number,
  domain: WidgetNumericDomain,
  reverse: boolean,
  colorCount: number,
): number {
  if (colorCount <= 1) return 0;
  const span = domain.maximum - domain.minimum;
  if (span <= Number.EPSILON) return Math.floor((colorCount - 1) / 2);
  const normalized = Math.max(0, Math.min(1, (value - domain.minimum) / span));
  const positioned = reverse ? 1 - normalized : normalized;
  return Math.round(positioned * (colorCount - 1));
}

export function widgetDatumNumber(
  datum: WidgetSeriesDatum,
  field: WidgetDatumSlotName | undefined,
): number | null {
  switch (field ?? "value") {
    case "value":
      return datum.value;
    case "delta":
      return datum.delta;
    case "count":
      return datum.count;
    case "date":
      return datum.date?.getTime() ?? null;
    case "category":
      return null;
  }
}

export function widgetDatumLabel(
  datum: WidgetSeriesDatum,
  field: WidgetDatumSlotName | undefined,
): string {
  switch (field ?? "category") {
    case "date":
      return datum.date?.toISOString().slice(0, 10) ?? datum.label;
    case "category":
      return datum.series ?? datum.label;
    case "value":
      return datum.value === null ? "Empty" : String(datum.value);
    case "delta":
      return datum.delta === null ? "No comparison" : String(datum.delta);
    case "count":
      return String(datum.count);
  }
}

export interface EncodedWidgetDatum extends WidgetSeriesDatum {
  /** Original values remain available to the x/color channels. */
  source: WidgetSeriesDatum;
}

/** Applies the y and series channels while preserving the evaluator row. */
export function encodeWidgetSeries(
  values: WidgetSeriesDatum[],
  visualization: WidgetVisualization,
  /** Which datum slot each channel meant — resolved by the caller from the analysis. */
  slots: WidgetDatumSlots,
): EncodedWidgetDatum[] {
  const yField = slots.y ?? "value";
  const seriesField = slots.series ?? undefined;
  const categories = new Map<string, number>();
  if (yField === "category") {
    for (const value of values) {
      const label = widgetDatumLabel(value, "category");
      if (!categories.has(label)) categories.set(label, categories.size);
    }
  }
  return values.map((source) => ({
    ...source,
    source,
    value:
      yField === "category"
        ? (categories.get(widgetDatumLabel(source, "category")) ?? 0)
        : widgetDatumNumber(source, yField),
    series: seriesField ? widgetDatumLabel(source, seriesField) : source.series,
  }));
}
