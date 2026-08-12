import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/icon";
import {
  averageOverTime,
  consistency,
  dayRange,
  gradeRatio,
  gradeRatios,
  improvement,
  passRate,
  subjectImpact,
  trend,
} from "@avermate/core";
import { Card, Empty, Label, Loading, Row, Section } from "@/components/ui";
import {
  AverageValue,
  CoefficientTag,
  DeltaValue,
  PointsValue,
  ResultBadge,
} from "@/components/value";
import { Sparkline } from "@/components/sparkline";
import {
  TimeSeriesCard,
  TIME_SERIES_COLORS,
} from "@/components/charts/time-series-card";
import {
  averageSeriesInput,
  createSerializableTimeSeriesModel,
  gradeSeriesInputs,
} from "@/components/charts/time-series-model";
import { formatDay } from "@/components/date-field";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { timelineCutoffTimestamp } from "@/lib/timeline";
import { radius, space, type, usePalette } from "@/lib/theme";
import { chartChildren, useChartSettings } from "@/lib/chart-settings";

/**
 * One subject, in full.
 *
 * The headline is the average, but the number underneath it is the one people
 * come for: how much the general average would move if this subject vanished.
 * That is the honest measure of "does this matter", and it cannot be read off
 * a coefficient — the weighting is hierarchical.
 */
export default function SubjectDetail() {
  const palette = usePalette();
  const router = useRouter();
  const chartSettings = useChartSettings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    isLoading,
    graph,
    period,
    passingRatio,
    scale,
    timelineDate,
    now,
    year,
  } = useYear();

  const subject = graph.byId(id);

  const grades = useMemo(
    () =>
      subject
        ? graph
            .allGrades(subject.id)
            .sort((a, b) => b.passedAt.getTime() - a.passedAt.getTime())
        : [],
    [graph, subject],
  );

  const series = useMemo(() => {
    if (!subject || !year) return [];
    const from = period.startAt;
    const to = new Date(
      Math.min(
        timelineCutoffTimestamp(timelineDate) ?? now,
        period.endAt.getTime(),
      ),
    );
    if (to.getTime() <= from.getTime()) return [];
    const step = Math.max(
      1,
      Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000) / 40),
    );
    return averageOverTime(
      graph.subjects,
      dayRange(from, to, step),
      subject.id,
    );
  }, [graph, now, period, subject, timelineDate, year]);

  const children = useMemo(
    () => (subject ? [...graph.childrenOf(subject.id)] : []),
    [graph, subject],
  );

  const visibleChartChildren = useMemo(
    () => chartChildren(children, chartSettings.showSubSubjects),
    [chartSettings.showSubSubjects, children],
  );

  const averageModel = useMemo(() => {
    if (!subject || series.length === 0) {
      return createSerializableTimeSeriesModel({
        maximumScale: scale,
        series: [],
      });
    }
    const dates = series.map((point) => point.date);
    const inputs = [
      averageSeriesInput({
        color: TIME_SERIES_COLORS[0],
        id: subject.id,
        label: subject.name,
        scale,
        series,
      }),
      ...visibleChartChildren.map((child, index) =>
        averageSeriesInput({
          color:
            TIME_SERIES_COLORS[(index + 1) % TIME_SERIES_COLORS.length] ??
            TIME_SERIES_COLORS[0],
          id: child.id,
          label: child.name,
          scale,
          series: averageOverTime(graph.subjects, dates, child.id),
        }),
      ),
    ];
    return createSerializableTimeSeriesModel({
      autoZoom: chartSettings.autoZoom,
      maximumScale: scale,
      series: inputs,
    });
  }, [
    chartSettings.autoZoom,
    graph.subjects,
    scale,
    series,
    subject,
    visibleChartChildren,
  ]);

  const gradeModel = useMemo(
    () =>
      createSerializableTimeSeriesModel({
        autoZoom: chartSettings.autoZoom,
        maximumScale: scale,
        series: gradeSeriesInputs({
          colors: TIME_SERIES_COLORS,
          grades,
          scale,
          subjects: graph.subjects,
        }),
      }),
    [chartSettings.autoZoom, grades, graph.subjects, scale],
  );

  if (isLoading) return <Loading />;
  if (!subject) {
    return (
      <Empty
        icon="help-circle-outline"
        title={t("This subject is not in the current period.")}
      />
    );
  }

  const ratio = graph.ratio(subject.id);
  const impact = subjectImpact(graph, subject.id);
  const ratios = gradeRatios(graph, subject.id);
  const slope = trend(series);
  const steadiness = consistency(ratios);
  const progress = improvement(ratios);
  const pass = passRate(ratios, passingRatio);

  return (
    <>
      <Stack.Screen
        options={{
          title: subject.shortName ?? subject.name,
          headerRight: () => (
            <Pressable
              onPress={() => {
                haptic("light");
                router.push(`/subject/edit?id=${subject.id}`);
              }}
              hitSlop={10}
            >
              <Icon
                name="options-outline"
                size={20}
                color={palette.textMuted}
              />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: palette.background }}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: space.xxxl,
          gap: space.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: space.md, paddingTop: space.sm }}>
          <View style={{ gap: space.xs }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
              }}
            >
              <Label>
                {subject.kind === "category" ? t("Category") : t("Subject")}
              </Label>
              <CoefficientTag coefficient={subject.coefficient} />
            </View>
            <Text style={[type.title, { color: palette.text }]}>
              {subject.name}
            </Text>
          </View>

          <AverageValue ratio={ratio} size="hero" showScale colored />

          {series.length > 2 ? (
            <Sparkline series={series} positive={(slope ?? 0) >= 0} />
          ) : null}

          <Pressable
            onPress={() => {
              haptic("light");
              router.push(`/grade/new?subjectId=${subject.id}`);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
              minHeight: 44,
              borderRadius: radius.md,
              backgroundColor: palette.accentSoft,
            }}
          >
            <Icon name="add" size={16} color={palette.text} />
            <Text style={[type.callout, { color: palette.text }]}>
              {t("Add a grade here")}
            </Text>
          </Pressable>
        </View>

        {impact.delta !== null ? (
          <Section title={t("Effect on the general average")}>
            <Card>
              <View style={{ gap: space.sm }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <DeltaValue delta={impact.delta} size="title" />
                  <Text
                    style={[
                      type.footnote,
                      { flex: 1, color: palette.textMuted },
                    ]}
                  >
                    {impact.delta >= 0
                      ? t("Without this subject you would be lower.")
                      : t("Without this subject you would be higher.")}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <AverageValue ratio={impact.withoutValue} size="callout" />
                  <Icon
                    name="arrow-forward"
                    size={13}
                    color={palette.textFaint}
                  />
                  <AverageValue
                    ratio={impact.withValue}
                    size="callout"
                    colored
                  />
                </View>
              </View>
            </Card>
          </Section>
        ) : null}

        <Section title={t("Evolution")}>
          <TimeSeriesCard
            title={t("Average over time")}
            description={t(
              "Each visible series keeps its own nearest real result while you inspect or zoom.",
            )}
            model={averageModel}
            passingValue={passingRatio * scale}
          />
        </Section>

        <Section title={t("Results over time")}>
          <TimeSeriesCard
            title={t("Grade results")}
            description={t("Drag to pan, pinch or use the wheel to zoom.")}
            model={gradeModel}
            passingValue={passingRatio * scale}
          />
        </Section>

        {children.length > 0 ? (
          <Section title={t("Inside this one")}>
            <Card padded={false}>
              {children.map((child, index) => (
                <Row
                  key={child.id}
                  first={index === 0}
                  title={child.name}
                  muted={child.kind === "category"}
                  onPress={() => router.push(`/subject/${child.id}`)}
                  trailing={
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                      }}
                    >
                      <CoefficientTag coefficient={child.coefficient} />
                      <AverageValue
                        ratio={graph.ratio(child.id)}
                        size="callout"
                        colored
                      />
                    </View>
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={t("Grades")}>
          <Card padded={false}>
            {grades.length === 0 ? (
              <Empty
                icon="document-text-outline"
                title={t("No grade recorded here yet.")}
              />
            ) : (
              grades.map((grade, index) => (
                <Row
                  key={grade.id}
                  first={index === 0}
                  title={grade.name}
                  subtitle={formatDay(grade.passedAt)}
                  onPress={() => router.push(`/grade/${grade.id}`)}
                  trailing={
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <ResultBadge ratio={gradeRatio(grade)} />
                      <PointsValue value={grade.value} outOf={grade.outOf} />
                    </View>
                  }
                />
              ))
            )}
          </Card>
        </Section>

        {ratios.length > 1 ? (
          <Section title={t("Patterns")}>
            <Card padded={false}>
              {pass !== null ? (
                <Row
                  first
                  title={t("Pass rate")}
                  trailing={
                    <Text style={[type.body, { color: palette.text }]}>
                      {`${Math.round(pass * 100)}%`}
                    </Text>
                  }
                />
              ) : null}
              {steadiness !== null ? (
                <Row
                  title={t("Consistency")}
                  subtitle={t("How tightly your results cluster")}
                  trailing={
                    <Text style={[type.body, { color: palette.text }]}>
                      {`${Math.round(steadiness * 100)}%`}
                    </Text>
                  }
                />
              ) : null}
              {progress !== null ? (
                <Row
                  title={t("Second half vs first")}
                  trailing={<DeltaValue delta={progress} size="body" />}
                />
              ) : null}
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}
