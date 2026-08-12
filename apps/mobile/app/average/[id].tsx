import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/icon";
import { averageOverTime, dayRange, gradeRatio } from "@avermate/core";
import { averageAnalytics } from "@/components/averages/average-analytics";
import {
  TimeSeriesCard,
  TIME_SERIES_COLORS,
} from "@/components/charts/time-series-card";
import {
  averageSeriesInput,
  createSerializableTimeSeriesModel,
} from "@/components/charts/time-series-model";
import { formatDay } from "@/components/format";
import { Card, Empty, Loading, Row, Screen, Section } from "@/components/ui";
import {
  AverageValue,
  CoefficientTag,
  DeltaValue,
  PercentValue,
  PointsValue,
  ResultBadge,
} from "@/components/value";
import { useYear } from "@/components/year-provider";
import { useChartSettings } from "@/lib/chart-settings";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { timelineCutoffTimestamp } from "@/lib/timeline";
import { space, type, usePalette } from "@/lib/theme";

/** General and custom averages share one analytical destination on mobile. */
export default function AverageDetail() {
  const palette = usePalette();
  const router = useRouter();
  const chartSettings = useChartSettings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    customAverages,
    graph,
    isLoading,
    now,
    passingRatio,
    period,
    scale,
    timelineDate,
    year,
  } = useYear();

  const analytics = useMemo(
    () => averageAnalytics(graph, id, customAverages, passingRatio),
    [customAverages, graph, id, passingRatio],
  );

  const series = useMemo(() => {
    if (!analytics || !year) return [];
    const from = new Date(
      Math.max(period.startAt.getTime(), year.startsAt.getTime()),
    );
    const to = new Date(
      Math.min(
        timelineCutoffTimestamp(timelineDate) ?? now,
        period.endAt.getTime(),
        year.endsAt.getTime(),
      ),
    );
    if (to.getTime() <= from.getTime()) return [];
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    return averageOverTime(
      analytics.resolvedGraph.subjects,
      dayRange(from, to, Math.max(1, Math.ceil(days / 60))),
      null,
      analytics.scope,
    );
  }, [analytics, now, period, timelineDate, year]);

  const chartModel = useMemo(
    () =>
      createSerializableTimeSeriesModel({
        autoZoom: chartSettings.autoZoom,
        maximumScale: scale,
        series: analytics
          ? [
              averageSeriesInput({
                color: TIME_SERIES_COLORS[0],
                id: id === "general" ? "general" : id,
                label:
                  id === "general"
                    ? t("General average")
                    : (analytics.custom?.name ?? t("Average")),
                scale,
                series,
              }),
            ]
          : [],
      }),
    [analytics, chartSettings.autoZoom, id, scale, series],
  );

  if (isLoading) return <Loading />;
  if (!analytics) {
    return (
      <Screen>
        <Empty
          icon="help-circle-outline"
          title={t("Average not found")}
          body={t("It may have been deleted, or it belongs to another year.")}
        />
      </Screen>
    );
  }

  const title = analytics.custom?.name ?? t("General average");

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: analytics.custom
            ? () => (
                <Pressable
                  accessibilityLabel={t("Edit custom average")}
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => {
                    haptic("light");
                    router.push(
                      `/settings/average-edit?id=${analytics.custom?.id}`,
                    );
                  }}
                >
                  <Icon
                    name="options-outline"
                    size={20}
                    color={palette.textMuted}
                  />
                </Pressable>
              )
            : undefined,
        }}
      />
      <Screen>
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <Text style={[type.title, { color: palette.text }]}>{title}</Text>
            {analytics.custom?.isMain ? (
              <Icon name="star" size={19} color={palette.accent} />
            ) : null}
          </View>
          {analytics.custom?.isMain ? (
            <Text style={[type.footnote, { color: palette.textMuted }]}>
              {t("Headline average")}
            </Text>
          ) : null}
        </View>

        <Card>
          <View style={{ gap: space.xs }}>
            <Text style={[type.label, { color: palette.textFaint }]}>
              {t("Average")}
            </Text>
            <AverageValue
              ratio={analytics.ratio}
              size="display"
              showScale
              colored
            />
          </View>
        </Card>

        <Section title={t("Evolution")}>
          <TimeSeriesCard
            title={t("Average over time")}
            description={t("Drag to pan, pinch or use the wheel to zoom.")}
            model={chartModel}
            passingValue={passingRatio * scale}
          />
        </Section>

        {analytics.composition.length > 0 ? (
          <Section title={t("Composition")}>
            <Card padded={false}>
              {analytics.composition.map((item, index) => (
                <Row
                  key={item.subject.id}
                  first={index === 0}
                  title={item.subject.name}
                  muted={item.subject.kind === "category"}
                  onPress={() => router.push(`/subject/${item.subject.id}`)}
                  trailing={
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                      }}
                    >
                      <CoefficientTag coefficient={item.coefficient} />
                      <AverageValue ratio={item.ratio} size="callout" colored />
                    </View>
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={t("Statistics")}>
          <Card padded={false}>
            <Row
              first
              title={t("Median")}
              trailing={<AverageValue ratio={analytics.median} size="body" />}
            />
            <Row
              title={t("Pass rate")}
              trailing={<PercentValue ratio={analytics.passRate} />}
            />
            <Row
              title={t("Consistency")}
              trailing={<PercentValue ratio={analytics.consistency} />}
            />
            <Row
              title={t("Grades")}
              trailing={
                <Text style={[type.body, { color: palette.text }]}>
                  {analytics.grades.length}
                </Text>
              }
            />
          </Card>
        </Section>

        {analytics.impacts.length > 0 ? (
          <Section title={t("Impact by subject")}>
            <Card padded={false}>
              {analytics.impacts.map((item, index) => (
                <Row
                  key={item.subject.id}
                  first={index === 0}
                  title={item.subject.name}
                  subtitle={t("Effect on this average")}
                  onPress={() => router.push(`/subject/${item.subject.id}`)}
                  trailing={
                    <DeltaValue delta={item.impact.delta} size="body" />
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={t("Grades")}>
          <Card padded={false}>
            {analytics.grades.length === 0 ? (
              <Empty
                icon="document-text-outline"
                title={t("No grade recorded here yet.")}
              />
            ) : (
              analytics.grades.map((grade, index) => (
                <Row
                  key={grade.id}
                  first={index === 0}
                  title={grade.name}
                  subtitle={`${
                    analytics.resolvedGraph.byId(grade.subjectId)?.name ?? ""
                  } · ${formatDay(grade.passedAt)}`}
                  onPress={() => router.push(`/grade/${grade.id}`)}
                  trailing={
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <ResultBadge ratio={gradeRatio(grade)} />
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                        }}
                      >
                        <CoefficientTag coefficient={grade.coefficient} />
                        <PointsValue value={grade.value} outOf={grade.outOf} />
                      </View>
                    </View>
                  }
                />
              ))
            )}
          </Card>
        </Section>
      </Screen>
    </>
  );
}
