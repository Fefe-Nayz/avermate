import { useMemo } from "react";
import { useRouter } from "expo-router";
import { Column, Spacer } from "@expo/ui";
import {
  averageOverTime,
  dayRange,
  gradeImpact,
  gradeRatio,
  gradeRatios,
  passRate,
  rankSubjects,
  trend,
} from "@avermate/core";
import {
  Button,
  Card,
  Empty,
  Grouped,
  Label,
  Line,
  Loading,
  Row,
  Section,
  Text,
} from "@/components/native";
import { AverageValue, DeltaValue, PercentValue, ResultBadge } from "@/components/value";
import { ProgressBar, Sparkline } from "@/components/chart";
import { ScopeRow } from "@/components/scope-bar";
import { formatDay } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { useGoalPlans } from "@/components/use-goal-plans";
import { useCards } from "@/components/use-cards";
import { CardView } from "@/components/card-view";
import { useSession } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * The dashboard.
 *
 * One number owns the screen, and everything under it exists to explain that
 * number: where it came from (the line), what just moved it (the latest
 * results), and where it is going (the goals). Nothing here is a widget for its
 * own sake — if a card cannot finish the sentence "your average is X because…",
 * it does not belong.
 */
export default function Dashboard() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isLoading, year, graph, subjects, period, passingRatio } = useYear();
  const plans = useGoalPlans();
  const cards = useCards("overview");

  const general = graph.ratio(null);

  // The running average, day by day, so the line is the year as it was lived
  // rather than a smoothing of the final numbers.
  const series = useMemo(() => {
    if (!year) return [];
    const from = period.startAt;
    const to = new Date(Math.min(Date.now(), period.endAt.getTime()));
    if (to.getTime() <= from.getTime()) return [];
    const span = to.getTime() - from.getTime();
    const step = Math.max(1, Math.round(span / (24 * 60 * 60 * 1000) / 60));
    return averageOverTime(graph.subjects, dayRange(from, to, step));
  }, [graph, period, year]);

  const recent = useMemo(
    () =>
      graph
        .allGrades()
        .sort((a, b) => b.passedAt.getTime() - a.passedAt.getTime())
        .slice(0, 5),
    [graph],
  );

  const ranked = useMemo(() => rankSubjects(graph), [graph]);
  const ratios = useMemo(() => gradeRatios(graph), [graph]);
  const slope = useMemo(() => trend(series), [series]);

  const mainSubjects = useMemo(
    () => subjects.filter((subject) => subject.isMain && graph.has(subject.id)),
    [subjects, graph],
  );

  if (isLoading) return <Loading />;

  const pass = passRate(ratios, passingRatio);
  const best = ranked[0];
  const worst = ranked.at(-1);
  const pinned = plans.filter((plan) => plan.goal.isPinned).slice(0, 2);
  const firstName = session?.user.name?.split(" ")[0];

  return (
    <Grouped>
      <Section>
        <Column spacing={space.md}>
          <Row>
            <Text size="footnote" tone="muted">
              {firstName ? t("Hello, {name}", { name: firstName }) : t("Hello")}
            </Text>
            <Spacer flexible />
            <ScopeRow />
          </Row>

          <Column spacing={space.xs}>
            <Label>{t("General average")}</Label>
            <AverageValue ratio={general} size="hero" showScale colored />
            {slope !== null ? (
              // The fitted change across the whole window, not since yesterday:
              // one result should not be able to rewrite the headline.
              <Row spacing={space.xs}>
                <DeltaValue
                  delta={slope * Math.max(1, series.length - 1)}
                  size="footnote"
                />
                <Text size="footnote" tone="muted">
                  {t("over this period")}
                </Text>
              </Row>
            ) : null}
          </Column>

          {series.length > 2 ? (
            <Sparkline series={series} positive={(slope ?? 0) >= 0} />
          ) : null}

          <Button
            label={t("Add grade")}
            onPress={() => router.push("/grade/new")}
          />
        </Column>
      </Section>

      {cards.specs.map((spec) => (
        <CardView key={spec.id} spec={spec} result={cards.results.get(spec.id)} />
      ))}

      {pinned.length > 0 ? (
        <Section title={t("Goals")}>
          {pinned.map((plan) => (
            <Line
              key={plan.goal.id}
              leading="goals"
              title={plan.goal.name}
              onPress={() => router.push(`/goal/${plan.goal.id}`)}
              trailing={
                <Row spacing={space.xs}>
                  <AverageValue ratio={plan.current} size="callout" colored />
                  <Text size="footnote" tone="faint">
                    /
                  </Text>
                  <AverageValue ratio={plan.target} size="callout" />
                </Row>
              }
            />
          ))}
          {pinned.map((plan) => (
            <ProgressBar
              key={`bar-${plan.goal.id}`}
              value={
                plan.current === null || plan.target === 0
                  ? 0
                  : plan.current / plan.target
              }
              done={plan.status === "achieved" || plan.status === "secured"}
            />
          ))}
        </Section>
      ) : null}

      {mainSubjects.length > 0 ? (
        <Section title={t("Watching")}>
          {mainSubjects.map((subject) => (
            <Line
              key={subject.id}
              title={subject.shortName ?? subject.name}
              onPress={() => router.push(`/subject/${subject.id}`)}
              trailing={
                <AverageValue
                  ratio={graph.ratio(subject.id)}
                  size="heading"
                  colored
                />
              }
            />
          ))}
        </Section>
      ) : null}

      <Section title={t("Latest results")}>
        {recent.length === 0 ? (
          <Empty
            glyph="grade"
            title={t("Nothing recorded yet.")}
            body={t("Add your first grade and the year starts drawing itself.")}
          />
        ) : (
          <>
            {recent.map((grade) => {
              const subject = graph.byId(grade.subjectId);
              const impact = gradeImpact(graph, grade.id);
              return (
                <Line
                  key={grade.id}
                  title={grade.name}
                  detail={`${subject?.name ?? ""} · ${formatDay(grade.passedAt)}`}
                  onPress={() => router.push(`/grade/${grade.id}`)}
                  trailing={
                    <Row spacing={space.sm}>
                      <DeltaValue delta={impact.delta} />
                      <ResultBadge ratio={gradeRatio(grade)} />
                    </Row>
                  }
                />
              );
            })}
            <Line
              title={t("See all")}
              onPress={() => router.push("/(tabs)/grades")}
            />
          </>
        )}
      </Section>

      {ratios.length > 0 ? (
        <Section title={t("How the year is going")}>
          <Line
            title={t("Grades recorded")}
            trailing={<Text mono>{String(ratios.length)}</Text>}
          />
          <Line
            title={t("Pass rate")}
            trailing={<PercentValue ratio={pass} />}
          />
          {best ? (
            <Line
              title={t("Strongest subject")}
              detail={best.subject.name}
              onPress={() => router.push(`/subject/${best.subject.id}`)}
              trailing={
                <AverageValue ratio={best.ratio} size="callout" colored />
              }
            />
          ) : null}
          {worst && worst.subject.id !== best?.subject.id ? (
            <Line
              title={t("Weakest subject")}
              detail={worst.subject.name}
              onPress={() => router.push(`/subject/${worst.subject.id}`)}
              trailing={
                <AverageValue ratio={worst.ratio} size="callout" colored />
              }
            />
          ) : null}
          <Line
            leading="insights"
            title={t("All the statistics")}
            onPress={() => router.push("/insights")}
          />
        </Section>
      ) : null}

      <Card>
        <Row>
          <Column spacing={2}>
            <Text size="heading">{t("Year in review")}</Text>
            <Text size="footnote" tone="muted">
              {t("Your year, told back to you")}
            </Text>
          </Column>
          <Spacer flexible />
        </Row>
        <Button
          label={t("Open")}
          variant="secondary"
          onPress={() => router.push("/review")}
        />
      </Card>
    </Grouped>
  );
}
