import { Text, View } from "react-native";
import { Card } from "@/components/ui";
import { t, locale } from "@/lib/i18n";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { space, type, usePalette } from "@/lib/theme";
import TimeSeriesChartDom from "./time-series-chart-dom";
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
  height = 278,
  model,
  passingValue,
  title,
}: {
  description?: string;
  height?: number;
  model: SerializableTimeSeriesModel;
  passingValue?: number;
  title: string;
}) {
  const palette = usePalette();
  const { reduceMotion } = useInteractionPreferences();
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
        <TimeSeriesChartDom
          model={model}
          locale={locale()}
          passingValue={passingValue}
          reducedMotion={reduceMotion}
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
          dom={{
            contentInsetAdjustmentBehavior: "never",
            scrollEnabled: false,
            style: { height, width: "100%" },
          }}
        />
      )}
    </Card>
  );
}
