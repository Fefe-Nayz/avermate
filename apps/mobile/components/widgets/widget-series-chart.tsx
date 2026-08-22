import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import {
  widgetMarkForRecipe,
  type WidgetDatumSlots,
  type WidgetVisualization,
} from "@avermate/core";
import { space, type, usePalette } from "@/lib/theme";
import {
  widgetColorIndex,
  widgetDatumLabel,
  widgetDatumNumber,
  widgetNumericDomain,
  type EncodedWidgetDatum,
} from "./widget-encoding";

const HEIGHT = 184;
const PAD = { top: 12, right: 12, bottom: 30, left: 40 };
const COLORS = [
  "#2563EB",
  "#16A34A",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#4D7C0F",
] as const;

function pathFor(
  points: Array<{ x: number; y: number }>,
  curve: "linear" | "monotone" | "step",
): string {
  const first = points[0];
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as { x: number; y: number };
    const current = points[index] as { x: number; y: number };
    if (curve === "step") {
      path += ` H ${(previous.x + current.x) / 2} V ${current.y} H ${current.x}`;
    } else if (curve === "monotone") {
      const middle = (previous.x + current.x) / 2;
      path += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`;
    } else {
      path += ` L ${current.x} ${current.y}`;
    }
  }
  return path;
}

function bucketValue(
  entry: EncodedWidgetDatum,
  slots: WidgetDatumSlots,
): string | number {
  const field = slots.x ?? (entry.date ? "date" : "category");
  if (field === "category") return entry.source.label;
  return (
    widgetDatumNumber(entry.source, field) ??
    widgetDatumLabel(entry.source, field)
  );
}

function bucketKey(
  entry: EncodedWidgetDatum,
  slots: WidgetDatumSlots,
): string {
  const value = bucketValue(entry, slots);
  return typeof value === "number" ? `n:${value}` : `s:${value}`;
}

function bucketLabel(
  entry: EncodedWidgetDatum,
  slots: WidgetDatumSlots,
): string {
  const field = slots.x ?? (entry.date ? "date" : "category");
  return widgetDatumLabel(entry.source, field);
}

function Legend({
  series,
  position,
}: {
  series: Array<{ label: string; color: string }>;
  position: WidgetVisualization["legend"]["position"];
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexDirection: position === "right" ? "column" : "row",
        flexWrap: "wrap",
        justifyContent: position === "right" ? "center" : "flex-start",
        gap: space.sm,
        paddingHorizontal: position === "right" ? 0 : space.xs,
      }}
    >
      {series.map((entry) => (
        <View
          key={entry.label}
          style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: entry.color,
            }}
          />
          <Text
            numberOfLines={1}
            style={[type.label, { color: palette.textMuted }]}
          >
            {entry.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function WidgetSeriesChart({
  values,
  visualization,
  slots,
  formatValue,
  formatColorValue = formatValue,
}: {
  values: EncodedWidgetDatum[];
  visualization: WidgetVisualization;
  /** Which datum slot each channel meant — see `widgetDatumSlots`. */
  slots: WidgetDatumSlots;
  formatValue: (value: number) => string;
  formatColorValue?: (value: number) => string;
}) {
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  // The shape to draw, from the recipe the document stores.
  const mark = widgetMarkForRecipe(visualization.recipe) ?? "value";
  const rows = useMemo(
    () =>
      values.filter(
        (entry): entry is EncodedWidgetDatum & { value: number } =>
          entry.value !== null,
      ),
    [values],
  );
  const colorField = slots.color ?? undefined;
  const colorValues = rows.flatMap((entry) => {
    const value = colorField
      ? widgetDatumNumber(entry.source, colorField)
      : null;
    return value === null ? [] : [value];
  });
  const colorDomain = widgetNumericDomain(colorValues, visualization.scale.y);
  const isQuantitativeColor = Boolean(
    colorField && colorField !== "category" && colorValues.length > 0,
  );
  const colorCategories =
    colorField === "category"
      ? [
          ...new Set(
            rows.map((entry) => widgetDatumLabel(entry.source, "category")),
          ),
        ]
      : [];
  const categoryColor = (label: string): string => {
    const index = Math.max(0, colorCategories.indexOf(label));
    return COLORS[index % COLORS.length] ?? palette.accent;
  };
  const quantitativeColor = (value: number): string => {
    const index = widgetColorIndex(
      value,
      colorDomain,
      visualization.scale.y.reverse,
      COLORS.length,
    );
    return COLORS[index] ?? palette.accent;
  };
  const groups = useMemo(() => {
    const mapped = new Map<string, typeof rows>();
    for (const row of rows) {
      const name = row.series ?? "Value";
      const entries = mapped.get(name);
      if (entries) entries.push(row);
      else mapped.set(name, [row]);
    }
    return [...mapped.entries()].map(([label, entries], index) => {
      return {
        label,
        color:
          colorField === "category"
            ? categoryColor(
                widgetDatumLabel(
                  entries[0]?.source ?? rows[0]!.source,
                  "category",
                ),
              )
            : (COLORS[index % COLORS.length] ?? palette.accent),
        entries,
      };
    });
  }, [colorField, palette.accent, rows]);
  const buckets = useMemo(() => {
    const map = new Map<string, EncodedWidgetDatum>();
    for (const row of rows) map.set(bucketKey(row, slots), row);
    return [...map.entries()];
  }, [rows, slots]);
  if (rows.length === 0) return <View style={{ height: HEIGHT }} />;

  const barOptions =
    visualization.options.kind === "bar" ? visualization.options : null;
  const horizontalBars = barOptions?.orientation === "horizontal";
  const stackedExtents = buckets.map(([key]) => {
    const bucketRows = rows.filter(
      (entry) => bucketKey(entry, slots) === key,
    );
    return {
      positive: bucketRows.reduce(
        (sum, entry) => sum + Math.max(0, entry.value),
        0,
      ),
      negative: bucketRows.reduce(
        (sum, entry) => sum + Math.min(0, entry.value),
        0,
      ),
    };
  });
  const valuesForDomain = barOptions?.stacked
    ? stackedExtents.flatMap((entry) => [entry.positive, entry.negative])
    : rows.map((entry) => entry.value);
  const rawMin = Math.min(...valuesForDomain);
  const rawMax = Math.max(...valuesForDomain);
  const scale = visualization.scale.y;
  const minimum = scale.min ?? (scale.zero ? Math.min(0, rawMin) : rawMin);
  const maximum = scale.max ?? (scale.zero ? Math.max(0, rawMax) : rawMax);
  const valueSpan = maximum - minimum || 1;
  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const bucketIndex = new Map(buckets.map(([key], index) => [key, index]));
  const numericX =
    ["line", "area"].includes(mark) &&
    buckets.every(
      ([, entry]) => typeof bucketValue(entry, slots) === "number",
    );
  const xNumbers = buckets.map(([, entry]) =>
    Number(bucketValue(entry, slots)),
  );
  const xMinimum = Math.min(...xNumbers);
  const xMaximum = Math.max(...xNumbers);
  const normalizedBucket = (entry: EncodedWidgetDatum) => {
    const index = bucketIndex.get(bucketKey(entry, slots)) ?? 0;
    const numeric = Number(bucketValue(entry, slots));
    const normalized = numericX
      ? xMaximum === xMinimum
        ? 0.5
        : (numeric - xMinimum) / (xMaximum - xMinimum)
      : buckets.length <= 1
        ? 0.5
        : index / (buckets.length - 1);
    return visualization.scale.x.reverse ? 1 - normalized : normalized;
  };
  const x = (entry: EncodedWidgetDatum) =>
    PAD.left + normalizedBucket(entry) * plotWidth;
  const y = (value: number) => {
    const normalized = Math.max(0, Math.min(1, (value - minimum) / valueSpan));
    const positioned = scale.reverse ? normalized : 1 - normalized;
    return PAD.top + positioned * plotHeight;
  };
  const valueX = (value: number) => {
    const normalized = Math.max(0, Math.min(1, (value - minimum) / valueSpan));
    const positioned = scale.reverse ? 1 - normalized : normalized;
    return PAD.left + positioned * plotWidth;
  };
  const categoryY = (entry: EncodedWidgetDatum) => {
    const index = bucketIndex.get(bucketKey(entry, slots)) ?? 0;
    const normalized = buckets.length <= 1 ? 0.5 : index / (buckets.length - 1);
    const positioned = visualization.scale.x.reverse
      ? 1 - normalized
      : normalized;
    return PAD.top + positioned * plotHeight;
  };
  const curve =
    visualization.options.kind === "line" ||
    visualization.options.kind === "area"
      ? visualization.options.curve
      : "linear";
  const baseline = y(Math.max(minimum, Math.min(maximum, 0)));
  const bandWidth = Math.max(
    4,
    Math.min(36, (plotWidth / Math.max(1, buckets.length)) * 0.7),
  );
  const legend =
    visualization.legend.visible &&
    (colorField === "category"
      ? colorCategories.length > 0
      : isQuantitativeColor ||
        (!colorField && Boolean(visualization.encoding.series))) &&
    groups.length > 0;
  const entryColor = (entry: EncodedWidgetDatum, fallback: string): string => {
    if (colorField === "category") {
      return categoryColor(widgetDatumLabel(entry.source, "category"));
    }
    if (colorField) {
      const value = widgetDatumNumber(entry.source, colorField);
      return value === null ? fallback : quantitativeColor(value);
    }
    return fallback;
  };

  const chart = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View
        style={{ height: HEIGHT }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {visualization.axes.y.grid
              ? [0, 0.5, 1].map((position) => (
                  <Line
                    key={`y:${position}`}
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={PAD.top + position * plotHeight}
                    y2={PAD.top + position * plotHeight}
                    stroke={palette.hairline}
                    strokeWidth={1}
                  />
                ))
              : null}
            {visualization.axes.x.grid
              ? buckets.map(([key, entry]) => (
                  <Line
                    key={`x:${key}`}
                    x1={x(entry)}
                    x2={x(entry)}
                    y1={PAD.top}
                    y2={PAD.top + plotHeight}
                    stroke={palette.hairline}
                    strokeWidth={1}
                  />
                ))
              : null}
            {visualization.thresholds.flatMap((threshold, index) => {
              const color =
                threshold.color && /^#[0-9a-f]{6}$/i.test(threshold.color)
                  ? threshold.color
                  : palette.negative;
              const line = (
                <Line
                  key={`threshold:${threshold.value}:${index}`}
                  x1={horizontalBars ? valueX(threshold.value) : PAD.left}
                  x2={
                    horizontalBars ? valueX(threshold.value) : width - PAD.right
                  }
                  y1={horizontalBars ? PAD.top : y(threshold.value)}
                  y2={
                    horizontalBars ? PAD.top + plotHeight : y(threshold.value)
                  }
                  stroke={color}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              );
              if (!threshold.label) return [line];
              return [
                line,
                <SvgText
                  key={`threshold-label:${threshold.value}:${index}`}
                  x={
                    horizontalBars
                      ? valueX(threshold.value) + 3
                      : width - PAD.right
                  }
                  y={horizontalBars ? PAD.top + 10 : y(threshold.value) - 3}
                  textAnchor={horizontalBars ? "start" : "end"}
                  fontSize={9}
                  fill={color}
                >
                  {threshold.label}
                </SvgText>,
              ];
            })}

            {mark === "area"
              ? groups.map((group) => {
                  const points = group.entries.map((entry) => ({
                    x: x(entry),
                    y: y(entry.value),
                  }));
                  const line = pathFor(points, curve);
                  const area = `${line} L ${points.at(-1)?.x ?? PAD.left} ${baseline} L ${points[0]?.x ?? PAD.left} ${baseline} Z`;
                  return (
                    <Path
                      key={`area:${group.label}`}
                      d={area}
                      fill={group.color}
                      fillOpacity={
                        visualization.options.kind === "area"
                          ? visualization.options.opacity
                          : 0.2
                      }
                    />
                  );
                })
              : null}
            {mark === "line" || mark === "area"
              ? groups.map((group) => (
                  <Path
                    key={`line:${group.label}`}
                    d={pathFor(
                      group.entries.map((entry) => ({
                        x: x(entry),
                        y: y(entry.value),
                      })),
                      curve,
                    )}
                    fill="none"
                    stroke={group.color}
                    strokeWidth={
                      visualization.options.kind === "line"
                        ? visualization.options.strokeWidth
                        : 2
                    }
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))
              : null}
            {mark === "bar"
              ? buckets.flatMap(([key, representative]) => {
                  const bucketRows = groups.flatMap((group, groupIndex) =>
                    group.entries
                      .filter(
                        (entry) => bucketKey(entry, slots) === key,
                      )
                      .map((entry) => ({ entry, group, groupIndex })),
                  );
                  let positive = 0;
                  let negative = 0;
                  return bucketRows.map(({ entry, group, groupIndex }) => {
                    const start = barOptions?.stacked
                      ? entry.value >= 0
                        ? positive
                        : negative
                      : 0;
                    const end = start + entry.value;
                    if (barOptions?.stacked) {
                      if (entry.value >= 0) positive = end;
                      else negative = end;
                    }
                    const groupedWidth = barOptions?.stacked
                      ? bandWidth
                      : bandWidth / Math.max(1, groups.length);
                    const center =
                      x(representative) +
                      (barOptions?.stacked
                        ? 0
                        : (groupIndex - (groups.length - 1) / 2) *
                          groupedWidth);
                    if (horizontalBars) {
                      const bandHeight = Math.max(
                        3,
                        Math.min(
                          26,
                          (plotHeight / Math.max(1, buckets.length)) * 0.68,
                        ),
                      );
                      const groupedHeight = barOptions?.stacked
                        ? bandHeight
                        : bandHeight / Math.max(1, groups.length);
                      const center =
                        categoryY(representative) +
                        (barOptions?.stacked
                          ? 0
                          : (groupIndex - (groups.length - 1) / 2) *
                            groupedHeight);
                      return (
                        <Rect
                          key={`bar:${group.label}:${key}`}
                          x={Math.min(valueX(start), valueX(end))}
                          y={center - groupedHeight / 2}
                          width={Math.max(
                            2,
                            Math.abs(valueX(start) - valueX(end)),
                          )}
                          height={Math.max(2, groupedHeight - 1)}
                          rx={barOptions?.cornerRadius ?? 3}
                          fill={entryColor(entry, group.color)}
                        />
                      );
                    }
                    const top = Math.min(y(start), y(end));
                    return (
                      <Rect
                        key={`bar:${group.label}:${key}`}
                        x={center - groupedWidth / 2}
                        y={top}
                        width={Math.max(2, groupedWidth - 1)}
                        height={Math.max(2, Math.abs(y(start) - y(end)))}
                        rx={barOptions?.cornerRadius ?? 3}
                        fill={entryColor(entry, group.color)}
                      />
                    );
                  });
                })
              : null}
            {mark === "dot" ||
            (visualization.options.kind === "line" &&
              visualization.options.points) ||
            (visualization.options.kind === "area" &&
              visualization.options.points) ||
            (isQuantitativeColor && (mark === "line" || mark === "area"))
              ? groups.flatMap((group) =>
                  group.entries.map((entry) => (
                    <Circle
                      key={`dot:${entry.key}`}
                      cx={x(entry)}
                      cy={y(entry.value)}
                      r={
                        visualization.options.kind === "dot"
                          ? visualization.options.size / 2
                          : 3
                      }
                      fill={entryColor(entry, group.color)}
                      stroke={palette.surface}
                      strokeWidth={1.5}
                    />
                  )),
                )
              : null}
            {visualization.axes.y.visible ? (
              <>
                <SvgText
                  x={1}
                  y={PAD.top + 4}
                  fontSize={9}
                  fill={palette.textFaint}
                >
                  {formatValue(scale.reverse ? minimum : maximum)}
                </SvgText>
                <SvgText
                  x={1}
                  y={PAD.top + plotHeight}
                  fontSize={9}
                  fill={palette.textFaint}
                >
                  {formatValue(scale.reverse ? maximum : minimum)}
                </SvgText>
              </>
            ) : null}
            {visualization.axes.x.visible && buckets.length > 0 ? (
              <>
                <SvgText
                  x={PAD.left}
                  y={HEIGHT - 8}
                  fontSize={9}
                  fill={palette.textFaint}
                >
                  {(() => {
                    const entry = (
                      visualization.scale.x.reverse
                        ? buckets.at(-1)
                        : buckets[0]
                    )?.[1];
                    return entry ? bucketLabel(entry, slots) : "";
                  })()}
                </SvgText>
                <SvgText
                  x={width - PAD.right}
                  y={HEIGHT - 8}
                  textAnchor="end"
                  fontSize={9}
                  fill={palette.textFaint}
                >
                  {(() => {
                    const entry = (
                      visualization.scale.x.reverse
                        ? buckets[0]
                        : buckets.at(-1)
                    )?.[1];
                    return entry ? bucketLabel(entry, slots) : "";
                  })()}
                </SvgText>
              </>
            ) : null}
            {visualization.axes.x.label ? (
              <SvgText
                x={PAD.left + plotWidth / 2}
                y={HEIGHT - 1}
                textAnchor="middle"
                fontSize={9}
                fill={palette.textMuted}
              >
                {visualization.axes.x.label}
              </SvgText>
            ) : null}
            {visualization.axes.y.label ? (
              <SvgText
                x={5}
                y={PAD.top + plotHeight / 2}
                textAnchor="middle"
                fontSize={9}
                fill={palette.textMuted}
                rotation={-90}
                origin={`5, ${PAD.top + plotHeight / 2}`}
              >
                {visualization.axes.y.label}
              </SvgText>
            ) : null}
          </Svg>
        ) : null}
      </View>
    </View>
  );

  if (!legend) return chart;
  const legendView = (
    <Legend
      series={
        colorField === "category"
          ? colorCategories.map((label) => ({
              label,
              color: categoryColor(label),
            }))
          : colorField && colorValues.length > 0
            ? colorDomain.maximum === colorDomain.minimum
              ? [
                  {
                    label: formatColorValue(colorDomain.minimum),
                    color: quantitativeColor(colorDomain.minimum),
                  },
                ]
              : [
                  {
                    label: formatColorValue(colorDomain.minimum),
                    color: quantitativeColor(colorDomain.minimum),
                  },
                  {
                    label: formatColorValue(colorDomain.maximum),
                    color: quantitativeColor(colorDomain.maximum),
                  },
                ]
            : groups.map(({ label, color }) => ({ label, color }))
      }
      position={visualization.legend.position}
    />
  );
  if (visualization.legend.position === "right") {
    return (
      <View
        style={{ flexDirection: "row", alignItems: "stretch", gap: space.sm }}
      >
        {chart}
        {legendView}
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {visualization.legend.position === "top" ? legendView : null}
      {chart}
      {visualization.legend.position === "bottom" ? legendView : null}
    </View>
  );
}
