import { useMemo } from "react";
import { Pressable } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Column } from "@expo/ui";
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
import {
  Button,
  Empty,
  Grouped,
  Label,
  Line,
  Loading,
  Row,
  Section,
  Text,
} from "@/components/native";
import {
  AverageValue,
  CoefficientTag,
  DeltaValue,
  PercentValue,
  PointsValue,
  ResultBadge,
} from "@/components/value";
import { Sparkline } from "@/components/chart";
import { Sign } from "@/components/icon";
import { formatDay } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * One subject, in full.
 *
 * The headline is the average, but the number underneath it is the one people
 * come for: how much the general average would move if this subject vanished.
 * That is the honest measure of "does this matter", and it cannot be read off
 * a coefficient — the weighting is hierarchical.
 */
export default function SubjectDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoading, graph, period, passingRatio, year } = useYear();

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
    const to = new Date(Math.min(Date.now(), period.endAt.getTime()));
    if (to.getTime() <= from.getTime()) return [];
    const step = Math.max(
      1,
      Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000) / 40),
    );
    return averageOverTime(graph.subjects, dayRange(from, to, step), subject.id);
  }, [graph, subject, period, year]);

  const children = useMemo(
    () => (subject ? [...graph.childrenOf(subject.id)] : []),
    [graph, subject],
  );

  if (isLoading) return <Loading />;
  if (!subject) {
    return (
      <Empty glyph="help" title={t("This subject is not in the current period.")} />
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
              <Sign glyph="settings" size={20} />
            </Pressable>
          ),
        }}
      />
      <Grouped
        footer={
          <Button
            label={t("Add a grade here")}
            onPress={() => router.push(`/grade/new?subjectId=${subject.id}`)}
          />
        }
      >
        <Section>
          <Column spacing={space.md}>
            <Row spacing={space.sm}>
              <Label>
                {subject.kind === "category" ? t("Category") : t("Subject")}
              </Label>
              <CoefficientTag coefficient={subject.coefficient} />
            </Row>
            <AverageValue ratio={ratio} size="hero" showScale colored />
            {series.length > 2 ? (
              <Sparkline series={series} positive={(slope ?? 0) >= 0} />
            ) : null}
          </Column>
        </Section>

        {impact.delta !== null ? (
          <Section title={t("Effect on the general average")}>
            <Column spacing={space.sm}>
              <Row spacing={space.sm}>
                <DeltaValue delta={impact.delta} size="title" />
                <Text size="footnote" tone="muted">
                  {impact.delta >= 0
                    ? t("Without this subject you would be lower.")
                    : t("Without this subject you would be higher.")}
                </Text>
              </Row>
              <Row spacing={space.sm}>
                <AverageValue ratio={impact.withoutValue} size="callout" />
                <Sign glyph="arrowRight" size={13} tone="faint" />
                <AverageValue ratio={impact.withValue} size="callout" colored />
              </Row>
            </Column>
          </Section>
        ) : null}

        {children.length > 0 ? (
          <Section title={t("Inside this one")}>
            {children.map((child) => (
              <Line
                key={child.id}
                title={child.name}
                onPress={() => router.push(`/subject/${child.id}`)}
                trailing={
                  <Row spacing={space.sm}>
                    <CoefficientTag coefficient={child.coefficient} />
                    <AverageValue
                      ratio={graph.ratio(child.id)}
                      size="callout"
                      colored
                    />
                  </Row>
                }
              />
            ))}
          </Section>
        ) : null}

        <Section title={t("Grades")}>
          {grades.length === 0 ? (
            <Empty glyph="grade" title={t("No grade recorded here yet.")} />
          ) : (
            grades.map((grade) => (
              <Line
                key={grade.id}
                title={grade.name}
                detail={formatDay(grade.passedAt)}
                onPress={() => router.push(`/grade/${grade.id}`)}
                trailing={
                  <Row spacing={space.sm}>
                    <PointsValue value={grade.value} outOf={grade.outOf} />
                    <ResultBadge ratio={gradeRatio(grade)} />
                  </Row>
                }
              />
            ))
          )}
        </Section>

        {ratios.length > 1 ? (
          <Section title={t("Patterns")}>
            <Line title={t("Pass rate")} trailing={<PercentValue ratio={pass} />} />
            {steadiness !== null ? (
              <Line
                title={t("Consistency")}
                detail={t("How tightly your results cluster")}
                trailing={<PercentValue ratio={steadiness} />}
              />
            ) : null}
            {progress !== null ? (
              <Line
                title={t("Second half vs first")}
                trailing={<DeltaValue delta={progress} size="body" />}
              />
            ) : null}
          </Section>
        ) : null}
      </Grouped>
    </>
  );
}
