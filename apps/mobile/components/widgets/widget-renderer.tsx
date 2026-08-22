import { Text, View } from "react-native";
import {
  widgetCapability,
  widgetDatumSlots,
  widgetFrameSeries,
  widgetMeasureId,
  type CardResult,
  type WidgetDatumSlots,
  type WidgetDefinition,
  type WidgetEvaluationResult,
  type WidgetSeriesDatum,
  type WidgetValueType,
  widgetPrimaryMeasure,
} from "@avermate/core";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/goal-status";
import { Card, Row } from "@/components/ui";
import { locale, t } from "@/lib/i18n";
import { numeric, space, type, usePalette } from "@/lib/theme";
import { useYear } from "@/components/year-provider";
import { widgetMessage } from "./widget-messages";
import { WidgetSeriesChart } from "./widget-series-chart";
import {
  encodeWidgetSeries,
  widgetColorIndex,
  widgetDatumLabel,
  widgetDatumNumber,
  widgetNumericDomain,
  type EncodedWidgetDatum,
} from "./widget-encoding";
import type { WidgetCardModel } from "@/components/use-cards";
import {
  widgetDistributionBarVisualization,
  widgetDistributionPresentation,
  widgetGoalPresentation,
  widgetRecordScalar,
  widgetScalarPresentation,
  widgetSeriesColumnVisibility,
  widgetStreakScalar,
  widgetThreshold,
} from "./widget-presentation";

const HEATMAP_COLORS = [
  "#2563EB",
  "#16A34A",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
] as const;

const HEATMAP_SEQUENTIAL_COLORS = [
  "#172554",
  "#1E3A8A",
  "#1E40AF",
  "#1D4ED8",
  "#2563EB",
  "#0369A1",
] as const;

const HEATMAP_DIVERGING_COLORS = [
  "#7F1D1D",
  "#B91C1C",
  "#DC2626",
  "#15803D",
  "#166534",
  "#14532D",
] as const;

function valueLabel(
  value: number,
  valueType: WidgetValueType,
  definition: WidgetDefinition,
  scale: number,
  defaultDecimals: number,
): string {
  const format = definition.visualization.format;
  const unit = format.unit === "auto" ? valueType : format.unit;
  const decimals =
    format.decimals ??
    (unit === "ratio" ? defaultDecimals : unit === "number" ? 2 : 0);
  const displayed =
    unit === "ratio" ? value * scale : unit === "percent" ? value * 100 : value;
  const suffix =
    unit === "percent" ? "%" : unit === "days" ? ` ${t("days")}` : "";
  return `${displayed.toLocaleString(locale() === "fr" ? "fr-FR" : "en-GB", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
    notation: format.compact ? "compact" : "standard",
  })}${suffix}`;
}

function SeriesRows({
  values,
  formatValue,
  showValues = true,
  showCount = true,
  table = false,
  definition,
}: {
  values: WidgetSeriesDatum[];
  formatValue: (value: number) => string;
  showValues?: boolean;
  showCount?: boolean;
  table?: boolean;
  definition: WidgetDefinition;
}) {
  const palette = usePalette();
  const columns = widgetSeriesColumnVisibility(definition, values, {
    table,
    showValues,
    countMaterialized: showCount,
  });
  const countLabel = (value: number) =>
    value.toLocaleString(locale() === "fr" ? "fr-FR" : "en-GB");

  if (table) {
    return (
      <View>
        <View
          style={{
            minHeight: 34,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.lg,
            borderBottomWidth: 1,
            borderBottomColor: palette.hairline,
          }}
        >
          <Text style={[type.label, { flex: 1, color: palette.textFaint }]}>
            {t("Category")}
          </Text>
          {columns.showValue ? (
            <Text
              style={[
                type.label,
                { width: 72, textAlign: "right", color: palette.textFaint },
              ]}
            >
              {t("Value")}
            </Text>
          ) : null}
          {columns.showDelta ? (
            <Text
              style={[
                type.label,
                { width: 66, textAlign: "right", color: palette.textFaint },
              ]}
            >
              {t("Change")}
            </Text>
          ) : null}
          {columns.showCount ? (
            <Text
              style={[
                type.label,
                { width: 48, textAlign: "right", color: palette.textFaint },
              ]}
            >
              {t("Count")}
            </Text>
          ) : null}
        </View>
        {values.map((entry, index) => {
          const threshold =
            entry.value === null ? null : thresholdFor(entry.value, definition);
          return (
            <View
              key={entry.key}
              style={{
                minHeight: 46,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.lg,
                paddingVertical: space.sm,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: palette.hairline,
              }}
            >
              <Text style={[type.body, { flex: 1, color: palette.text }]}>
                {entry.label}
              </Text>
              {columns.showValue ? (
                <Text
                  style={[
                    type.callout,
                    numeric,
                    {
                      width: 72,
                      textAlign: "right",
                      color: threshold?.color ?? palette.text,
                    },
                  ]}
                >
                  {entry.value === null ? "—" : formatValue(entry.value)}
                </Text>
              ) : null}
              {columns.showDelta ? (
                <Text
                  style={[
                    type.label,
                    numeric,
                    { width: 66, textAlign: "right", color: palette.textMuted },
                  ]}
                >
                  {entry.delta === null
                    ? "—"
                    : `${entry.delta >= 0 ? "+" : ""}${formatValue(entry.delta)}`}
                </Text>
              ) : null}
              {columns.showCount ? (
                <Text
                  style={[
                    type.label,
                    numeric,
                    { width: 48, textAlign: "right", color: palette.textMuted },
                  ]}
                >
                  {countLabel(entry.count)}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      {values.map((entry, index) => {
        const threshold =
          entry.value === null ? null : thresholdFor(entry.value, definition);
        return (
          <Row
            key={entry.key}
            first={index === 0}
            title={entry.label}
            subtitle={threshold?.label ?? undefined}
            trailing={
              columns.showValue ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: space.sm,
                  }}
                >
                  {entry.value !== null ? (
                    <Text
                      style={[
                        type.heading,
                        numeric,
                        { color: threshold?.color ?? palette.text },
                      ]}
                    >
                      {formatValue(entry.value)}
                    </Text>
                  ) : null}
                  {columns.showDelta && entry.delta !== null ? (
                    <Text
                      style={[
                        type.label,
                        numeric,
                        { color: palette.textMuted },
                      ]}
                    >
                      {`${entry.delta >= 0 ? "+" : ""}${formatValue(entry.delta)}`}
                    </Text>
                  ) : null}
                </View>
              ) : undefined
            }
          />
        );
      })}
    </View>
  );
}

function safeColor(value: string | null | undefined): string | null {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function thresholdFor(value: number, definition: WidgetDefinition) {
  const threshold = widgetThreshold(value, definition);
  return threshold ? { ...threshold, color: safeColor(threshold.color) } : null;
}

function ThresholdLabels({
  visualization,
}: {
  visualization: WidgetDefinition["visualization"];
}) {
  const palette = usePalette();
  const labelled = visualization.thresholds.filter(
    (threshold) => threshold.label,
  );
  if (labelled.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {labelled.map((threshold, index) => (
        <Text
          key={`${threshold.value}:${index}`}
          style={[
            type.label,
            { color: safeColor(threshold.color) ?? palette.textMuted },
          ]}
        >
          {threshold.label}
        </Text>
      ))}
    </View>
  );
}

function BoxPlot({
  result,
  formatValue,
  showOutliers,
  definition,
  domain,
}: {
  result: Extract<WidgetEvaluationResult, { kind: "distribution" }>;
  formatValue: (value: number) => string;
  showOutliers: boolean;
  definition: WidgetDefinition;
  domain?: { min: number; max: number };
}) {
  const palette = usePalette();
  const summary = widgetDistributionPresentation(result).summary;
  const { min: rawMin, q1, median, q3, max: rawMax } = summary;
  const scale = definition.visualization.scale.y;
  const min =
    scale.min ??
    (scale.zero ? Math.min(0, domain?.min ?? rawMin) : (domain?.min ?? rawMin));
  const max =
    scale.max ??
    (scale.zero ? Math.max(0, domain?.max ?? rawMax) : (domain?.max ?? rawMax));
  const span = max - min || 1;
  const positionNumber = (value: number) => {
    const normalized = Math.max(0, Math.min(1, (value - min) / span));
    return (scale.reverse ? 1 - normalized : normalized) * 100;
  };
  const position = (value: number) => `${positionNumber(value)}%` as const;
  return (
    <View style={{ gap: space.md }}>
      <View style={{ height: 54, justifyContent: "center" }}>
        <View style={{ height: 2, backgroundColor: palette.textFaint }} />
        {definition.visualization.axes.y.grid
          ? [0.25, 0.5, 0.75].map((point) => (
              <View
                key={point}
                style={{
                  position: "absolute",
                  left: `${point * 100}%`,
                  width: 1,
                  height: 46,
                  backgroundColor: palette.hairline,
                }}
              />
            ))
          : null}
        <View
          style={{
            position: "absolute",
            left: `${Math.min(positionNumber(q1), positionNumber(q3))}%`,
            width: `${Math.abs(positionNumber(q3) - positionNumber(q1))}%`,
            height: 30,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: palette.accent,
            backgroundColor: palette.accentSoft,
          }}
        />
        {showOutliers
          ? summary.outliers.map((outlier, index) => (
              <View
                key={`${outlier}:${index}`}
                style={{
                  position: "absolute",
                  left: position(outlier),
                  width: 7,
                  height: 7,
                  marginLeft: -3.5,
                  borderRadius: 4,
                  backgroundColor: palette.negative,
                }}
              />
            ))
          : null}
        <View
          style={{
            position: "absolute",
            left: position(median),
            width: 2,
            height: 38,
            backgroundColor: palette.accent,
          }}
        />
        {definition.visualization.thresholds.map((threshold, index) => (
          <View
            key={`${threshold.value}:${index}`}
            style={{
              position: "absolute",
              left: position(threshold.value),
              width: 1,
              height: 48,
              backgroundColor: safeColor(threshold.color) ?? palette.negative,
            }}
          />
        ))}
      </View>
      {definition.visualization.axes.y.visible ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[type.label, numeric, { color: palette.textMuted }]}>
            {formatValue(scale.reverse ? max : min)}
          </Text>
          <Text style={[type.label, numeric, { color: palette.text }]}>
            {formatValue(median)}
          </Text>
          <Text style={[type.label, numeric, { color: palette.textMuted }]}>
            {formatValue(scale.reverse ? min : max)}
          </Text>
        </View>
      ) : null}
      {definition.visualization.axes.y.label ? (
        <Text
          style={[
            type.label,
            { color: palette.textMuted, textAlign: "center" },
          ]}
        >
          {definition.visualization.axes.y.label}
        </Text>
      ) : null}
      <ThresholdLabels visualization={definition.visualization} />
    </View>
  );
}

function DistributionSet({
  result,
  definition,
  formatValue,
}: {
  result: Extract<WidgetEvaluationResult, { kind: "distribution-set" }>;
  definition: WidgetDefinition;
  formatValue: (value: number) => string;
}) {
  const palette = usePalette();
  const domain = {
    min: Math.min(...result.groups.map((group) => group.summary.min)),
    max: Math.max(...result.groups.map((group) => group.summary.max)),
  };
  const showOutliers =
    definition.visualization.options.kind === "boxplot" &&
    definition.visualization.options.showOutliers;

  return (
    <View style={{ gap: space.lg }}>
      {result.groups.map((group) => {
        const distribution: Extract<
          WidgetEvaluationResult,
          { kind: "distribution" }
        > = {
          kind: "distribution",
          shape: "distribution",
          buckets: group.buckets,
          total: group.total,
          values: group.values,
          summary: group.summary,
        };
        return (
          <View key={group.key} style={{ gap: space.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: space.sm,
              }}
            >
              <Text style={[type.body, { flex: 1, color: palette.text }]}>
                {group.label}
              </Text>
              <Text style={[type.label, numeric, { color: palette.textMuted }]}>
                {t("{count} grades", { count: group.total })}
              </Text>
            </View>
            <BoxPlot
              result={distribution}
              definition={definition}
              domain={domain}
              showOutliers={showOutliers}
              formatValue={formatValue}
            />
          </View>
        );
      })}
    </View>
  );
}

function Histogram({
  result,
  definition,
  formatValue,
  formatBucket,
}: {
  result: Extract<WidgetEvaluationResult, { kind: "distribution" }>;
  definition: WidgetDefinition;
  formatValue: (value: number) => string;
  formatBucket: (value: number) => string;
}) {
  const palette = usePalette();
  const scale = definition.visualization.scale.y;
  const distribution = widgetDistributionPresentation(result);
  const magnitudes = distribution.buckets.map((bucket) => bucket.magnitude);
  const rawMin = magnitudes.length > 0 ? Math.min(...magnitudes) : 0;
  const rawMax = magnitudes.length > 0 ? Math.max(...magnitudes) : 1;
  const min = scale.min ?? (scale.zero ? Math.min(0, rawMin) : rawMin);
  const max = scale.max ?? (scale.zero ? Math.max(0, rawMax) : rawMax);
  const span = max - min || 1;
  const options = definition.visualization.options;
  const horizontal =
    options.kind === "bar" && options.orientation === "horizontal";
  const radius = options.kind === "bar" ? options.cornerRadius : 4;
  const normalized = (value: number) =>
    Math.max(0, Math.min(1, (value - min) / span));
  const bars = (
    <View
      style={{
        height: horizontal ? undefined : 116,
        minHeight: horizontal ? 100 : undefined,
        flexDirection: horizontal ? "column" : "row",
        alignItems: horizontal
          ? "stretch"
          : scale.reverse
            ? "flex-start"
            : "flex-end",
        gap: 5,
      }}
    >
      {result.buckets.map((bucket, index) => {
        const magnitude = magnitudes[index] ?? 0;
        const size = normalized(magnitude);
        const threshold = thresholdFor(magnitude, definition);
        return horizontal ? (
          <View
            key={bucket.from}
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Text
              style={[
                type.label,
                numeric,
                { width: 34, color: palette.textFaint },
              ]}
            >
              {formatBucket(bucket.from)}
            </Text>
            <View
              style={{
                flex: 1,
                height: 18,
                overflow: "hidden",
                borderRadius: radius,
                backgroundColor: palette.accentSoft,
              }}
            >
              <View
                style={{
                  width: `${(scale.reverse ? 1 - size : size) * 100}%`,
                  height: "100%",
                  borderRadius: radius,
                  backgroundColor: threshold?.color ?? palette.accent,
                }}
              />
            </View>
          </View>
        ) : (
          <View
            key={bucket.from}
            style={{
              flex: 1,
              height: `${Math.max(0.025, scale.reverse ? 1 - size : size) * 100}%`,
              borderRadius: radius,
              backgroundColor: threshold?.color ?? palette.accent,
            }}
          />
        );
      })}
    </View>
  );
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ position: "relative" }}>
        {definition.visualization.axes.y.grid && !horizontal ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              inset: 0,
              justifyContent: "space-between",
            }}
          >
            {[0, 1, 2].map((line) => (
              <View
                key={line}
                style={{ height: 1, backgroundColor: palette.hairline }}
              />
            ))}
          </View>
        ) : null}
        {bars}
      </View>
      {definition.visualization.axes.y.visible ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[type.label, numeric, { color: palette.textFaint }]}>
            {formatValue(scale.reverse ? max : min)}
          </Text>
          <Text style={[type.label, numeric, { color: palette.textFaint }]}>
            {formatValue(scale.reverse ? min : max)}
          </Text>
        </View>
      ) : null}
      {definition.visualization.axes.y.label ? (
        <Text
          style={[
            type.label,
            { color: palette.textMuted, textAlign: "center" },
          ]}
        >
          {definition.visualization.axes.y.label}
        </Text>
      ) : null}
      <Text
        style={[
          type.footnote,
          { color: palette.textMuted, textAlign: "right" },
        ]}
      >
        {t("{count} grades", { count: result.total })}
      </Text>
      <ThresholdLabels visualization={definition.visualization} />
    </View>
  );
}

/** A definition's own value type: the formula's, or the metric's capability. */
function measureValueType(definition: WidgetDefinition): WidgetValueType {
  const measure = widgetPrimaryMeasure(definition.analysis);
  return measure.kind === "formula"
    ? measure.valueType
    : widgetCapability(measure.metric).valueType;
}

function Heatmap({
  values,
  visualization,
  slots,
  formatValue,
  formatColor,
}: {
  values: EncodedWidgetDatum[];
  visualization: WidgetDefinition["visualization"];
  slots: WidgetDatumSlots;
  formatValue: (value: number) => string;
  formatColor: (value: number) => string;
}) {
  const palette = usePalette();
  const colorField = slots.color ?? slots.y ?? "value";
  const rows = values.filter(
    (entry): entry is EncodedWidgetDatum & { value: number } =>
      entry.value !== null,
  );
  if (rows.length === 0) {
    return (
      <Text style={[type.footnote, { color: palette.textFaint }]}>
        {t("Nothing to show yet")}
      </Text>
    );
  }
  const categoryLabels =
    colorField === "category"
      ? [
          ...new Set(
            rows.map((entry) => widgetDatumLabel(entry.source, "category")),
          ),
        ]
      : [];
  const categoryColor = (label: string) => {
    const index = Math.max(0, categoryLabels.indexOf(label));
    return HEATMAP_COLORS[index % HEATMAP_COLORS.length] ?? palette.accent;
  };
  const colorValues = rows.flatMap((entry) => {
    const value = widgetDatumNumber(entry.source, colorField);
    return value === null ? [] : [value];
  });
  const yDomain = widgetNumericDomain(
    rows.map((entry) => entry.value),
    visualization.scale.y,
  );
  const colorDomain = widgetNumericDomain(colorValues, visualization.scale.y);
  const scheme =
    visualization.options.kind === "heatmap"
      ? visualization.options.colorScheme
      : "sequential";
  const quantitativeColors =
    scheme === "sequential"
      ? HEATMAP_SEQUENTIAL_COLORS
      : HEATMAP_DIVERGING_COLORS;
  const colorFor = (entry: (typeof rows)[number]) => {
    if (colorField === "category") {
      return categoryColor(widgetDatumLabel(entry.source, "category"));
    }
    const encoded = widgetDatumNumber(entry.source, colorField) ?? 0;
    return (
      quantitativeColors[
        widgetColorIndex(
          encoded,
          colorDomain,
          visualization.scale.y.reverse,
          quantitativeColors.length,
        )
      ] ?? palette.accent
    );
  };
  // The evaluator owns ordering so sort transforms remain visible.
  const orderedRows = [...rows];
  const cells = (
    <View
      style={{
        flexDirection: visualization.scale.x.reverse ? "row-reverse" : "row",
        flexWrap: "wrap",
        gap: visualization.axes.x.grid || visualization.axes.y.grid ? 2 : 4,
      }}
    >
      {orderedRows.map((entry) => {
        const encoded = widgetDatumNumber(entry.source, colorField) ?? 0;
        const threshold = [...visualization.thresholds]
          .sort((left, right) => left.value - right.value)
          .filter((item) => encoded >= item.value)
          .at(-1);
        return (
          <View
            key={entry.key}
            accessibilityLabel={`${entry.label}: ${formatValue(entry.value)}`}
            style={{
              width: 44,
              height: 34,
              borderRadius: 4,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                threshold?.color && /^#[0-9a-f]{6}$/i.test(threshold.color)
                  ? threshold.color
                  : colorFor(entry),
              borderWidth:
                visualization.axes.x.grid || visualization.axes.y.grid ? 1 : 0,
              borderColor: palette.border,
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                type.label,
                { color: palette.accentText, paddingHorizontal: 2 },
              ]}
            >
              {formatValue(entry.value)}
            </Text>
          </View>
        );
      })}
    </View>
  );
  const legend =
    visualization.legend.visible &&
    (colorField === "category"
      ? categoryLabels.length > 0
      : colorValues.length > 0) ? (
      <View style={{ gap: space.xs }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          {colorField === "category" ? (
            categoryLabels.map((label) => (
              <View
                key={label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                }}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    backgroundColor: categoryColor(label),
                  }}
                />
                <Text style={[type.label, { color: palette.textMuted }]}>
                  {label}
                </Text>
              </View>
            ))
          ) : (
            <>
              <View
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor:
                    quantitativeColors[
                      widgetColorIndex(
                        colorDomain.minimum,
                        colorDomain,
                        visualization.scale.y.reverse,
                        quantitativeColors.length,
                      )
                    ],
                }}
              />
              <Text style={[type.label, { color: palette.textMuted }]}>
                {formatColor(colorDomain.minimum)}
              </Text>
              {colorDomain.maximum !== colorDomain.minimum ? (
                <>
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      backgroundColor:
                        quantitativeColors[
                          widgetColorIndex(
                            colorDomain.maximum,
                            colorDomain,
                            visualization.scale.y.reverse,
                            quantitativeColors.length,
                          )
                        ],
                    }}
                  />
                  <Text style={[type.label, { color: palette.textMuted }]}>
                    {formatColor(colorDomain.maximum)}
                  </Text>
                </>
              ) : null}
            </>
          )}
          {visualization.thresholds.flatMap((threshold, index) => {
            const color = safeColor(threshold.color);
            if (!color) return [];
            return [
              <View
                key={`threshold:${threshold.value}:${index}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                }}
              >
                <View
                  style={{ width: 12, height: 12, backgroundColor: color }}
                />
                <Text style={[type.label, { color: palette.textMuted }]}>
                  {threshold.label ?? formatColor(threshold.value)}
                </Text>
              </View>,
            ];
          })}
        </View>
      </View>
    ) : null;
  return (
    <View
      style={{
        flexDirection:
          visualization.legend.position === "right" ? "row" : "column",
        gap: space.sm,
      }}
    >
      {visualization.legend.position === "top" ? legend : null}
      <View style={{ flex: 1, gap: space.xs }}>
        {visualization.axes.y.label ? (
          <Text style={[type.label, { color: palette.textMuted }]}>
            {visualization.axes.y.label}
          </Text>
        ) : null}
        {visualization.axes.y.visible ? (
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Text style={[type.label, { color: palette.textFaint }]}>
              {formatValue(
                visualization.scale.y.reverse
                  ? yDomain.maximum
                  : yDomain.minimum,
              )}
            </Text>
            <Text style={[type.label, { color: palette.textFaint }]}>
              {formatValue(
                visualization.scale.y.reverse
                  ? yDomain.minimum
                  : yDomain.maximum,
              )}
            </Text>
          </View>
        ) : null}
        {cells}
        {visualization.axes.x.visible && rows.length > 0 ? (
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Text style={[type.label, { color: palette.textFaint }]}>
              {orderedRows[0]
                ? widgetDatumLabel(orderedRows[0].source, slots.x ?? undefined)
                : ""}
            </Text>
            <Text style={[type.label, { color: palette.textFaint }]}>
              {orderedRows.at(-1)
                ? widgetDatumLabel(
                    orderedRows.at(-1)!.source,
                    slots.x ?? undefined,
                  )
                : ""}
            </Text>
          </View>
        ) : null}
        {visualization.axes.x.label ? (
          <Text
            style={[
              type.label,
              { color: palette.textMuted, textAlign: "center" },
            ]}
          >
            {visualization.axes.x.label}
          </Text>
        ) : null}
        <ThresholdLabels visualization={visualization} />
      </View>
      {visualization.legend.position === "right" ||
      visualization.legend.position === "bottom"
        ? legend
        : null}
    </View>
  );
}

function ScalarChart({
  definition,
  result,
  formatValue,
}: {
  definition: WidgetDefinition;
  result: Extract<WidgetEvaluationResult, { kind: "scalar" }>;
  formatValue: (value: number) => string;
}) {
  const repeated =
    definition.visualization.recipe === "line" ||
    definition.visualization.recipe === "area";
  const now = new Date();
  const values: WidgetSeriesDatum[] = (repeated ? [0, 1] : [0]).map(
    (offset) => ({
      key: `value:${offset}`,
      label: offset === 0 ? t("Value") : t("Current"),
      date: new Date(now.getTime() + offset * 86_400_000),
      value: result.value,
      delta: result.delta,
      count: 1,
      series: null,
    }),
  );
  return (
    <WidgetSeriesChart
      values={encodeWidgetSeries(
        values,
        definition.visualization,
        widgetDatumSlots(
          definition.analysis,
          definition.visualization.encoding,
        ),
      )}
      visualization={definition.visualization}
      slots={widgetDatumSlots(
        definition.analysis,
        definition.visualization.encoding,
      )}
      formatValue={formatValue}
    />
  );
}

/**
 * A result the V1 union does not model as a number or a series — a record, a
 * streak, a goal. Named for the shape it draws, not for a migration: the V1
 * evaluator returns these itself, under `kind: "structured"`.
 */
function StructuredResult({
  definition,
  value,
  formatValue,
}: {
  definition: WidgetDefinition;
  value: CardResult;
  formatValue: (value: number, valueType?: WidgetValueType) => string;
}) {
  const palette = usePalette();
  if (value.kind === "grade" || value.kind === "subject") {
    const ratio = value.ratio;
    const name = value.name;
    const subtitle = value.kind === "grade" ? value.subjectName : undefined;
    if (
      definition.visualization.recipe === "table" ||
      definition.visualization.recipe === "list"
    ) {
      const row: WidgetSeriesDatum = {
        key: value.kind === "grade" ? value.gradeId : value.subjectId,
        label: name,
        date: value.kind === "grade" ? value.at : null,
        value: ratio,
        delta: value.kind === "subject" ? value.delta : null,
        count: 1,
        series: null,
      };
      return (
        <SeriesRows
          values={[row]}
          definition={definition}
          table={definition.visualization.recipe === "table"}
          showValues={
            definition.visualization.options.kind !== "list" ||
            definition.visualization.options.showValues
          }
          showCount={false}
          formatValue={(entry) => formatValue(entry, "ratio")}
        />
      );
    }
    return (
      <View style={{ gap: space.xs }}>
        <Text numberOfLines={2} style={[type.heading, { color: palette.text }]}>
          {name}
        </Text>
        {subtitle ? (
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
        {(() => {
          const scalar = widgetRecordScalar(value);
          return scalar ? (
            <WidgetResultRenderer definition={definition} result={scalar} />
          ) : null;
        })()}
      </View>
    );
  }
  if (value.kind === "list") {
    const rows: WidgetSeriesDatum[] = value.items.map((item) => ({
      key: item.id,
      label: item.label,
      date: null,
      value: item.ratio ?? item.delta,
      delta: item.delta,
      count: 1,
      series: null,
    }));
    const limit =
      definition.visualization.options.kind === "table" ||
      definition.visualization.options.kind === "list"
        ? definition.visualization.options.rows
        : rows.length;
    return (
      <SeriesRows
        values={rows.slice(0, limit)}
        definition={definition}
        table={definition.visualization.recipe === "table"}
        showValues={
          definition.visualization.options.kind !== "list" ||
          definition.visualization.options.showValues
        }
        showCount={false}
        formatValue={(entry) => formatValue(entry, "ratio")}
      />
    );
  }
  if (value.kind === "streak") {
    return (
      <View style={{ gap: space.xs }}>
        <WidgetResultRenderer
          definition={definition}
          result={widgetStreakScalar(definition, value)}
        />
        <Text style={[type.footnote, numeric, { color: palette.textMuted }]}>
          {t("Best this year: {count}", { count: value.longest })}
        </Text>
      </View>
    );
  }
  if (value.kind === "goal") {
    const plan = value.plan;
    const goal = widgetGoalPresentation(value);
    if (definition.visualization.recipe === "line") {
      const now = new Date();
      const rows: WidgetSeriesDatum[] = [
        ["current", t("Current"), plan.current, 0],
        ["projection", t("Projection"), plan.projection, 1],
        ["target", t("Target"), plan.target, 2],
      ].flatMap(([key, label, ratio, offset]) =>
        typeof ratio === "number"
          ? [
              {
                key: String(key),
                label: String(label),
                date: new Date(now.getTime() + Number(offset) * 86_400_000),
                value: ratio,
                delta: null,
                count: 1,
                series: null,
              },
            ]
          : [],
      );
      return (
        <WidgetSeriesChart
          values={encodeWidgetSeries(
            rows,
            definition.visualization,
            widgetDatumSlots(
              definition.analysis,
              definition.visualization.encoding,
            ),
          )}
          visualization={definition.visualization}
          slots={widgetDatumSlots(
            definition.analysis,
            definition.visualization.encoding,
          )}
          formatValue={(entry) => formatValue(entry, "ratio")}
        />
      );
    }
    if (!goal.scalar) {
      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
          }}
        >
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={[type.label, { color: palette.textFaint }]}>
              {t("Target")}
            </Text>
            <Text style={[type.heading, numeric, { color: palette.text }]}>
              {formatValue(goal.target, "ratio")}
            </Text>
          </View>
          <StatusPill status={goal.status} />
        </View>
      );
    }
    const goalDefinition: WidgetDefinition =
      definition.visualization.recipe === "gauge"
        ? {
            ...definition,
            visualization: {
              ...definition.visualization,
              scale: {
                ...definition.visualization.scale,
                y: {
                  ...definition.visualization.scale.y,
                  min: definition.visualization.scale.y.min ?? 0,
                  max: definition.visualization.scale.y.max ?? plan.target,
                },
              },
            },
          }
        : definition;
    return (
      <WidgetResultRenderer definition={goalDefinition} result={goal.scalar} />
    );
  }
  return (
    <Text style={[type.footnote, { color: palette.textMuted }]}>
      {t("Nothing to show yet")}
    </Text>
  );
}

export function WidgetResultRenderer({
  definition,
  result,
}: {
  definition: WidgetDefinition;
  result: WidgetEvaluationResult | undefined;
}) {
  const palette = usePalette();
  const { scale, decimals } = useYear();
  const formatValue = (value: number, valueType?: WidgetValueType) =>
    valueLabel(
      value,
      valueType ?? measureValueType(definition),
      definition,
      scale,
      decimals,
    );

  if (!result || result.kind === "empty") {
    return (
      <Text style={[type.footnote, { color: palette.textFaint }]}>
        {t("Nothing to show yet")}
      </Text>
    );
  }
  if (result.kind === "scalar") {
    const presentation = widgetScalarPresentation(definition, result);
    if (
      ["line", "area", "bar", "dot"].includes(definition.visualization.recipe)
    ) {
      return (
        <ScalarChart
          definition={definition}
          result={result}
          formatValue={(value) => formatValue(value, result.valueType)}
        />
      );
    }
    const threshold = presentation.threshold
      ? {
          ...presentation.threshold,
          color: safeColor(presentation.threshold.color),
        }
      : null;
    return (
      <View style={{ gap: space.sm }}>
        {presentation.showValue ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: space.sm,
            }}
          >
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={[
                type.display,
                numeric,
                { flexShrink: 1, color: threshold?.color ?? palette.text },
              ]}
            >
              {formatValue(result.value, result.valueType)}
            </Text>
            {presentation.showDelta ? (
              <Text
                style={[
                  type.callout,
                  numeric,
                  {
                    color:
                      result.delta === null
                        ? palette.textFaint
                        : result.delta >= 0
                          ? palette.positive
                          : palette.negative,
                    paddingBottom: 5,
                  },
                ]}
              >
                {result.delta === null
                  ? "—"
                  : `${result.delta >= 0 ? "+" : ""}${formatValue(result.delta, result.valueType)}`}
              </Text>
            ) : null}
            {presentation.trendIndicator ? (
              <View style={{ paddingBottom: 5 }}>
                <Icon
                  name={
                    result.delta === null
                      ? "remove-outline"
                      : result.delta >= 0
                        ? "trending-up-outline"
                        : "trending-down-outline"
                  }
                  size={18}
                  color={
                    result.delta === null
                      ? palette.textFaint
                      : result.delta >= 0
                        ? palette.positive
                        : palette.negative
                  }
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {definition.visualization.recipe === "gauge" ? (
          <View
            style={{
              height: presentation.gaugeThickness,
              borderRadius: 999,
              backgroundColor: palette.accentSoft,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${presentation.progress * 100}%`,
                height: "100%",
                borderRadius: 999,
                backgroundColor: threshold?.color ?? palette.accent,
              }}
            />
          </View>
        ) : null}
        {threshold?.label ? (
          <Text
            style={[
              type.label,
              { color: threshold.color ?? palette.textMuted },
            ]}
          >
            {threshold.label}
          </Text>
        ) : null}
      </View>
    );
  }
  if (result.kind === "data-frame") {
    const limit =
      definition.visualization.options.kind === "table" ||
      definition.visualization.options.kind === "list"
        ? definition.visualization.options.rows
        : result.frame.rows.length;
    const slots = widgetDatumSlots(
      definition.analysis,
      definition.visualization.encoding,
    );
    const values = encodeWidgetSeries(
      // The frame, as the rows this renderer draws — the same projection the web uses.
      widgetFrameSeries(result.frame, slots).slice(0, limit),
      definition.visualization,
      slots,
    );
    const yField = slots.y ?? "value";
    const seriesValue = (value: number) =>
      yField === "date"
        ? new Date(value).toLocaleDateString(
            locale() === "fr" ? "fr-FR" : "en-GB",
          )
        : formatValue(value, yField === "count" ? "count" : result.valueType);
    const colorField = slots.color ?? undefined;
    const seriesColorValue = (value: number) =>
      colorField === "date"
        ? new Date(value).toLocaleDateString(
            locale() === "fr" ? "fr-FR" : "en-GB",
          )
        : formatValue(
            value,
            colorField === "count" ? "count" : result.valueType,
          );
    if (
      definition.visualization.recipe === "table" ||
      definition.visualization.recipe === "list"
    ) {
      return (
        <SeriesRows
          values={values}
          definition={definition}
          table={definition.visualization.recipe === "table"}
          showValues={
            definition.visualization.options.kind !== "list" ||
            definition.visualization.options.showValues
          }
          formatValue={seriesValue}
        />
      );
    }
    if (definition.visualization.recipe === "heatmap") {
      const heatmapColorField = slots.color ?? slots.y ?? "value";
      return (
        <Heatmap
          values={values}
          visualization={definition.visualization}
          slots={slots}
          formatValue={seriesValue}
          formatColor={(value) =>
            formatValue(
              value,
              heatmapColorField === "count" ? "count" : result.valueType,
            )
          }
        />
      );
    }
    return (
      <WidgetSeriesChart
        values={values}
        visualization={definition.visualization}
        slots={slots}
        formatValue={seriesValue}
        formatColorValue={seriesColorValue}
      />
    );
  }
  if (result.kind === "distribution-set") {
    return (
      <DistributionSet
        result={result}
        definition={definition}
        formatValue={(value) => formatValue(value, "ratio")}
      />
    );
  }
  if (result.kind === "distribution") {
    const distribution = widgetDistributionPresentation(result);
    const distributionCount = (value: number) => formatValue(value, "count");
    const distributionRatio = (value: number) => formatValue(value, "ratio");
    if (definition.visualization.recipe === "bar") {
      const visualization = widgetDistributionBarVisualization(
        definition.visualization,
      );
      // A distribution's bars are its buckets: the category on x, the count on y. The
      // synthetic visualization above has no channels of its own, so the slots are
      // stated rather than resolved from an analysis that never declared them.
      const distributionSlots: WidgetDatumSlots = {
        x: "category",
        y: "value",
        color: null,
        series: null,
        facet: null,
      };
      const rows: WidgetSeriesDatum[] = distribution.buckets.map((bucket) => ({
        key: `${bucket.from}:${bucket.to}`,
        label: `${formatValue(bucket.from, "ratio")} - ${formatValue(bucket.to, "ratio")}`,
        date: null,
        value: bucket.magnitude,
        delta: null,
        count: bucket.count,
        series: null,
      }));
      return (
        <WidgetSeriesChart
          values={encodeWidgetSeries(rows, visualization, distributionSlots)}
          visualization={visualization}
          slots={distributionSlots}
          formatValue={distributionCount}
        />
      );
    }
    return definition.visualization.recipe === "boxplot" ? (
      <BoxPlot
        result={result}
        definition={definition}
        showOutliers={
          definition.visualization.options.kind === "boxplot" &&
          definition.visualization.options.showOutliers
        }
        formatValue={distributionRatio}
      />
    ) : (
      <Histogram
        result={result}
        definition={definition}
        formatValue={distributionCount}
        formatBucket={distributionRatio}
      />
    );
  }

  return (
    <StructuredResult
      definition={definition}
      value={result.value}
      formatValue={formatValue}
    />
  );
}

export function widgetCardTitle(
  card: Pick<WidgetCardModel, "title" | "definition">,
): string {
  if (card.title) return card.title;
  if (!card.definition) return t("Unavailable card");
  const capability = widgetCapability(
    widgetMeasureId(widgetPrimaryMeasure(card.definition.analysis)),
  );
  return widgetMessage(capability.messageKey);
}

export function WidgetCardView({
  card,
  // Passed separately from `card` because the model's definition is nullable and
  // a prop cannot be narrowed by the caller's check. The grid draws an
  // `UnreadableCard` for the null case rather than a second kind of real card.
  definition,
  result,
}: {
  card: WidgetCardModel;
  definition: WidgetDefinition;
  result: WidgetEvaluationResult | undefined;
}) {
  const palette = usePalette();
  const listy =
    result?.kind === "data-frame" &&
    ["list", "table"].includes(definition.visualization.recipe);
  const accent =
    card.accent && /^#[0-9a-f]{6}$/i.test(card.accent) ? card.accent : null;
  return (
    <Card
      padded={!listy}
      style={{
        minHeight: 132,
        ...(accent ? { borderTopWidth: 3, borderTopColor: accent } : {}),
      }}
    >
      <View style={{ gap: space.md }}>
        <Text
          numberOfLines={2}
          style={[
            type.callout,
            {
              color: palette.text,
              fontWeight: "600",
              paddingHorizontal: listy ? space.lg : 0,
              paddingTop: listy ? space.lg : 0,
            },
          ]}
        >
          {widgetCardTitle(card)}
        </Text>
        <WidgetResultRenderer definition={definition} result={result} />
      </View>
    </Card>
  );
}
