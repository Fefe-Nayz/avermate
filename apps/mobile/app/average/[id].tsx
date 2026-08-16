import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/icon";
import { averageEventDates, averageOverTime, gradeRatio } from "@avermate/core";
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
import { ScopeBar } from "@/components/scope-bar";
import {
  Button,
  Card,
  Empty,
  Label,
  Loading,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import {
  AverageValue,
  CoefficientTag,
  DeltaValue,
  ResultBadge,
} from "@/components/value";
import { useYear } from "@/components/year-provider";
import { useChartSettings } from "@/lib/chart-settings";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { timelineCutoffTimestamp } from "@/lib/timeline";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

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

  // The web samples the curve at grade events, not on a calendar grid: an
  // average is a step function of grades, and inventing days between them
  // smoothed steps that never happened.
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
    return averageOverTime(
      analytics.resolvedGraph.subjects,
      averageEventDates(analytics.resolvedGraph.subjects, from, to),
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
          action={
            <Button
              label={t("Back to custom averages")}
              variant="outline"
              onPress={() => router.push("/settings/averages")}
            />
          }
        />
      </Screen>
    );
  }

  const title = analytics.custom?.name ?? t("General average");
  const localeTag = locale() === "fr" ? "fr-FR" : "en-GB";
  const percent = (value: number | null) =>
    value === null
      ? "—"
      : value.toLocaleString(localeTag, {
          style: "percent",
          maximumFractionDigits: 0,
        });
  const stats = [
    {
      label: t("Median"),
      value:
        analytics.median === null
          ? "—"
          : (analytics.median * scale).toLocaleString(localeTag, {
              maximumFractionDigits: 2,
            }),
    },
    { label: t("Pass rate"), value: percent(analytics.passRate) },
    { label: t("Consistency"), value: percent(analytics.consistency) },
    { label: t("Grades"), value: String(analytics.grades.length) },
  ];
  // The impact grid only shows readings that have something to compare.
  const impacts = analytics.impacts.filter(
    (item) =>
      item.impact.withValue !== null || item.impact.withoutValue !== null,
  );
  const chartPoints = chartModel.series.reduce(
    (total, item) => total + item.points.length,
    0,
  );

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: analytics.custom
            ? () => (
                <Pressable
                  accessibilityLabel={t("Edit")}
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
                    name="pencil-outline"
                    size={20}
                    color={palette.textMuted}
                  />
                </Pressable>
              )
            : undefined,
        }}
      />
      <Screen>
        <ScopeBar />

        <Card>
          <View style={{ gap: space.xs }}>
            <Label>{t("Average")}</Label>
            <AverageValue
              ratio={analytics.ratio}
              size="display"
              showScale
              colored
            />
          </View>
        </Card>

        {chartPoints < 2 ? (
          <Card>
            <View style={{ gap: space.xs }}>
              <Text selectable style={[type.heading, { color: palette.text }]}>
                {t("Over time")}
              </Text>
              <Text
                selectable
                style={[
                  type.footnote,
                  {
                    color: palette.textMuted,
                    paddingVertical: space.xxl,
                    textAlign: "center",
                  },
                ]}
              >
                {t("Record a few grades and the curve will appear here.")}
              </Text>
            </View>
          </Card>
        ) : (
          <TimeSeriesCard
            title={t("Over time")}
            model={chartModel}
            passingValue={passingRatio * scale}
            zoomPresets
          />
        )}

        {analytics.composition.length > 0 ? (
          <Section title={t("Subjects")}>
            <Card padded={false}>
              {analytics.composition.map((item, index) => (
                <Row
                  key={item.subject.id}
                  first={index === 0}
                  title={item.subject.name}
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

        <View style={{ flexDirection: "row", gap: space.sm }}>
          {stats.map((stat) => (
            <View
              key={stat.label}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: space.sm,
                paddingVertical: 10,
                borderRadius: radius.xl,
                borderCurve: "continuous",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              }}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
                  numeric,
                  {
                    fontSize: 18,
                    lineHeight: 24,
                    fontWeight: "600",
                    color: palette.text,
                  },
                ]}
              >
                {stat.value}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  lineHeight: 14,
                  marginTop: 2,
                  color: palette.textMuted,
                  textAlign: "center",
                }}
              >
                {stat.label}
              </Text>
            </View>
          ))}
        </View>

        {impacts.length > 0 ? (
          <Section title={t("Impact by subject")}>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}
            >
              {impacts.map((item) => (
                <Pressable
                  key={item.subject.id}
                  accessibilityRole="button"
                  onPress={() => {
                    haptic("selection");
                    router.push(`/subject/${item.subject.id}`);
                  }}
                  style={({ pressed }) => ({
                    flexBasis: "47%",
                    flexGrow: 1,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Card>
                    <View style={{ gap: space.xs }}>
                      <Text
                        numberOfLines={1}
                        style={[type.label, { color: palette.textFaint }]}
                      >
                        {item.subject.name}
                      </Text>
                      <DeltaValue delta={item.impact.delta} size="title" />
                      <View
                        accessibilityLabel={t(
                          "Average without and with this value",
                        )}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.xs,
                        }}
                      >
                        <AverageValue
                          ratio={item.impact.withoutValue}
                          size="footnote"
                          decimals={2}
                          style={{ color: palette.textMuted }}
                        />
                        <Text
                          style={[type.footnote, { color: palette.textMuted }]}
                        >
                          →
                        </Text>
                        <AverageValue
                          ratio={item.impact.withValue}
                          size="footnote"
                          decimals={2}
                          style={{ color: palette.textMuted }}
                        />
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        <Section title={t("Grades")}>
          <Card padded={false}>
            {analytics.grades.length === 0 ? (
              <Text
                style={[
                  type.footnote,
                  {
                    color: palette.textMuted,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.xl,
                    textAlign: "center",
                  },
                ]}
              >
                {t("No grade recorded here yet.")}
              </Text>
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
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                      }}
                    >
                      <CoefficientTag coefficient={grade.coefficient} />
                      <ResultBadge ratio={gradeRatio(grade)} />
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
