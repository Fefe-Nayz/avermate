import { Text, View } from "react-native";
import { Card } from "@/components/ui";
import { t, locale } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";
import { TimeSeriesChart } from "./time-series-chart";
import type { SerializableTimeSeriesModel } from "./time-series-model";
import { useChartSettings } from "@/lib/chart-settings";

export const TIME_SERIES_COLORS = [
  "#5B8FF9",
  "#61DDAA",
  "#F6BD16",
  "#E8684A",
  "#6DC8EC",
  "#9270CA",
  "#FF9D4D",
  "#269A99",
] as const;

export function TimeSeriesCard({
  description,
  height = 240,
  model,
  passingValue,
  title,
}: {
  description?: string;
  /** Plot height. The series legend is drawn above it and adds its own. */
  height?: number;
  model: SerializableTimeSeriesModel;
  passingValue?: number;
  title: string;
}) {
  const palette = usePalette();
  const { showPoints } = useChartSettings();
  const points = model.series.reduce(
    (total, series) => total + series.points.length,
    0,
  );

  return (
    <Card style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
      <View style={{ gap: space.xs, paddingHorizontal: space.lg }}>
        <Text selectable style={[type.heading, { color: palette.text }]}>
          {title}
        </Text>
        {description ? (
          <Text
            selectable
            style={[type.footnote, { color: palette.textMuted }]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {points < 2 ? (
        <Text
          selectable
          style={[
            type.footnote,
            {
              color: palette.textMuted,
              paddingHorizontal: space.lg,
              paddingVertical: space.xxl,
              textAlign: "center",
            },
          ]}
        >
          {t("Not enough data yet")}
        </Text>
      ) : (
        <TimeSeriesChart
          height={height}
          locale={locale()}
          model={model}
          passingValue={passingValue}
          showPoints={showPoints}
          strings={{
            hideSeries: t("Hide {name}"),
            reset: t("Reset chart view"),
            showSeries: t("Show {name}"),
            values: t("Relevant values"),
            visibleRange: t("Visible chart range"),
          }}
          theme={{
            background: palette.surface,
            border: palette.border,
            grid: palette.hairline,
            muted: palette.textMuted,
            text: palette.text,
            tooltip: palette.surfaceRaised,
          }}
        />
      )}
    </Card>
  );
}
