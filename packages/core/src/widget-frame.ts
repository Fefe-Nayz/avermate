import {
  widgetMeasureValueType,
  type WidgetDatumSlots,
} from "./widget-registry";
import { widgetAxisType } from "./widget-types";
import type {
  WidgetDataFrame,
  WidgetDataFrameRow,
  WidgetDatumSlotName,
  WidgetDimension,
  WidgetMeasureEntry,
  WidgetSeriesDatum,
} from "./widget-types";

/**
 * The table a grouped reading comes out as, and the projection renderers read it through.
 *
 * Two jobs, deliberately in one file because they are inverses of each other:
 *
 * - `widgetFrameFromSeries` assembles the frame from the per-measure walks the evaluator
 *   already does. One walk per measure, merged by row key, so a card asking for "current
 *   and target" is two passes rather than a special path.
 * - `widgetFrameSeries` projects it back into the five-slot datums every chart in this
 *   app draws. That projection is the only place the old vocabulary survives, and it is
 *   what let the frame land without rewriting eleven renderers.
 *
 * The column names are the ones a channel may say — `sales`, `sales.delta`, `sales.count`
 * — so a channel that compiles names a column that exists. That is checked by
 * `widgetChannelFields` on the way in and by `widgetFrameColumn` on the way out.
 */

/** The delta column for a measure id, spelled as a channel would name it. */
export function widgetFrameDeltaColumn(measureId: string): string {
  return `${measureId}.delta`;
}

/** The count column for a measure id. */
export function widgetFrameCountColumn(measureId: string): string {
  return `${measureId}.count`;
}

/**
 * One measure's walk over the buckets, as the evaluator produced it.
 *
 * The datums still carry `series` — the label of the splitting dimension — because that
 * is what the walk knows. Turning it into a dimension column is this file's job.
 */
export interface WidgetMeasureWalk {
  measure: WidgetMeasureEntry;
  values: readonly WidgetSeriesDatum[];
}

/**
 * The frame for a grouped reading.
 *
 * `dimensions` is the analysis's own list: the first is the axis the walk bucketed by, the
 * second — when there is one — is the split whose label each datum carries. Rows are keyed
 * by the walk's key, which already includes the split, so merging the measures is a lookup
 * rather than a join.
 *
 * Rows are the union of every walk. A secondary measure may legitimately materialise a
 * bucket the primary does not (a count has a calendar zero where an average is absent,
 * for example); using only the first walk silently erased that reading.
 */
export function widgetFrameFromSeries(
  walks: readonly WidgetMeasureWalk[],
  dimensions: readonly WidgetDimension[],
): WidgetDataFrame {
  const axis = dimensions[0];
  const split = dimensions[1];
  const axisType = axis ? widgetAxisType(axis) : null;
  const datums = new Map<string, WidgetSeriesDatum>();
  for (const walk of walks) {
    for (const datum of walk.values) {
      if (!datums.has(datum.key)) datums.set(datum.key, datum);
    }
  }
  const rows: WidgetDataFrameRow[] = [...datums.values()].map((datum) => {
    const dimensionValues: Record<string, string | number | null> = {};
    const labels: Record<string, string> = {};
    if (axis) {
      dimensionValues[axis.id] =
        axisType === "time" && datum.date !== null
          ? datum.date.getTime()
          : datum.label;
      labels[axis.id] = datum.label;
    }
    if (split) {
      dimensionValues[split.id] = datum.series;
      labels[split.id] = datum.series ?? "";
    }
    return {
      key: datum.key,
      dimensions: dimensionValues,
      labels,
      measures: {},
    };
  });

  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const walk of walks) {
    for (const datum of walk.values) {
      const row = byKey.get(datum.key);
      if (!row) continue;
      row.measures[walk.measure.id] = datum.value;
      row.measures[widgetFrameDeltaColumn(walk.measure.id)] = datum.delta;
      row.measures[widgetFrameCountColumn(walk.measure.id)] = datum.count;
    }
  }

  return {
    schema: {
      dimensions: dimensions.map((dimension) => ({
        id: dimension.id,
        type: widgetAxisType(dimension),
      })),
      measures: walks.flatMap((walk) => {
        // The measure's own reading, from its capability. A count column is a count
        // whatever the measure is, which is why it does not inherit.
        const valueType = widgetMeasureValueType(walk.measure.expression);
        return [
          { id: walk.measure.id, type: "number" as const, valueType },
          {
            id: widgetFrameDeltaColumn(walk.measure.id),
            type: "number" as const,
            valueType,
          },
          {
            id: widgetFrameCountColumn(walk.measure.id),
            type: "number" as const,
            valueType: "count" as const,
          },
        ];
      }),
    },
    rows,
  };
}

/**
 * The frame as the datums a chart plots.
 *
 * Which column lands in which slot is the caller's decision, arrived at once from the
 * encoding — see `widgetDatumSlots`. Everything a renderer needs is here, so no renderer
 * reads the frame directly unless it needs the whole table, which only the facet grid and
 * the stacked marks do.
 *
 * `series` comes from the *split* dimension rather than from a channel: a row belongs to
 * one series because of what it is, not because of how it is drawn. A card with no split
 * has one series, which is `null` — exactly as before.
 */
export function widgetFrameSeries(
  frame: WidgetDataFrame,
  slots: WidgetDatumSlots,
  options: { measureId?: string } = {},
): WidgetSeriesDatum[] {
  const axis = frame.schema.dimensions[0];
  const split = frame.schema.dimensions[1];
  const measureId =
    options.measureId ?? frame.schema.measures[0]?.id ?? "measure";
  const value = (row: WidgetDataFrameRow, slot: WidgetDatumSlotName | null) => {
    if (slot === "delta") {
      return row.measures[widgetFrameDeltaColumn(measureId)] ?? null;
    }
    if (slot === "count") {
      return row.measures[widgetFrameCountColumn(measureId)] ?? null;
    }
    return row.measures[measureId] ?? null;
  };

  return frame.rows.map((row) => {
    const axisValue = axis ? row.dimensions[axis.id] : null;
    return {
      key: row.key,
      label: axis ? (row.labels[axis.id] ?? String(axisValue ?? "")) : "",
      // A time axis carries a timestamp; anything else has no date, and a renderer that
      // asked for one gets `null` rather than a date invented from a category's position.
      date:
        axis?.type === "time" && typeof axisValue === "number"
          ? new Date(axisValue)
          : null,
      value: value(row, slots.y),
      delta: row.measures[widgetFrameDeltaColumn(measureId)] ?? null,
      count: row.measures[widgetFrameCountColumn(measureId)] ?? 0,
      series: split ? (row.labels[split.id] ?? null) : null,
    };
  });
}

/** Every distinct value of one dimension, in the order the rows first present it. */
export function widgetFrameDomain(
  frame: WidgetDataFrame,
  dimensionId: string,
): Array<{ value: string | number | null; label: string }> {
  const seen = new Map<
    string,
    { value: string | number | null; label: string }
  >();
  for (const row of frame.rows) {
    const value = row.dimensions[dimensionId] ?? null;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.set(key, { value, label: row.labels[dimensionId] ?? key });
  }
  return [...seen.values()];
}

/**
 * The frame narrowed to one value of one dimension.
 *
 * What a facet panel draws: the same table with one column pinned. The column stays in the
 * schema on purpose — a panel still knows which value it is showing, which is what its
 * title says.
 */
export function widgetFrameWhere(
  frame: WidgetDataFrame,
  dimensionId: string,
  value: string | number | null,
): WidgetDataFrame {
  return {
    schema: frame.schema,
    rows: frame.rows.filter(
      (row) => (row.dimensions[dimensionId] ?? null) === value,
    ),
  };
}
