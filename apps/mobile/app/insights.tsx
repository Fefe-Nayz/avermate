import { useMemo } from "react";
import { Stack } from "expo-router";
import { useRouter } from "expo-router";
import { Column, Spacer } from "@expo/ui";
import {
  averageOverTime,
  consistency,
  dayRange,
  distribution,
  gradeRatios,
  improvement,
  mean,
  median,
  passRate,
  passStreaks,
  projectedRatio,
  rankByConsistency,
  rankByImprovement,
  rankSubjects,
  standardDeviation,
  trend,
} from "@avermate/core";
import {
  Empty,
  Grouped,
  Label,
  Line,
  Loading,
  Row,
  Section,
  Text,
} from "@/components/native";
import { AverageValue, DeltaValue, PercentValue } from "@/components/value";
import { Distribution, Sparkline } from "@/components/chart";
import { ScopeBar } from "@/components/scope-bar";
import { formatNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * The statistics screen.
 *
 * Everything here is derived rather than stored, so it costs nothing to offer
 * — but that is a reason to be selective, not exhaustive. Each number answers
 * a question somebody actually asks: am I steady, am I improving, where do I
 * end up if nothing changes, and which subjects are pulling which way.
 */
export default function Insights() {
  const router = useRouter();
  const { isLoading, graph, period, year, passingRatio, scale, decimals } =
    useYear();

  const series = useMemo(() => {
    if (!year) return [];
    const from = period.startAt;
    const to = new Date(Math.min(Date.now(), period.endAt.getTime()));
    if (to.getTime() <= from.getTime()) return [];
    const span = to.getTime() - from.getTime();
    const step = Math.max(1, Math.round(span / (24 * 60 * 60 * 1000) / 60));
    return averageOverTime(graph.subjects, dayRange(from, to, step));
  }, [graph, period, year]);

  const ratios = useMemo(() => gradeRatios(graph), [graph]);
  const ranked = useMemo(() => rankSubjects(graph), [graph]);
  const improving = useMemo(() => rankByImprovement(graph), [graph]);
  const steadiest = useMemo(() => rankByConsistency(graph), [graph]);
  const buckets = useMemo(() => distribution(ratios, 5), [ratios]);
  const streaks = useMemo(
    () => passStreaks(graph.allGrades(), passingRatio),
    [graph, passingRatio],
  );

  if (isLoading) return <Loading />;

  if (ratios.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: t("Insights") }} />
        <Grouped>
          <Empty
            glyph="insights"
            title={t("Not enough data yet")}
            body={t("A handful of grades and this screen fills in.")}
          />
        </Grouped>
      </>
    );
  }

  const slope = trend(series);
  const weeksLeft = year
    ? Math.max(
        0,
        Math.round(
          (period.endAt.getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000),
        ),
      )
    : 0;
  const projection = projectedRatio(series, weeksLeft);
  const spread = standardDeviation(ratios);
  const declining = [...improving].reverse()[0];

  return (
    <>
      <Stack.Screen options={{ title: t("Insights") }} />
      <Grouped>
        <ScopeBar />

        <Section title={t("The year so far")}>
          <Column spacing={space.md}>
            <Row spacing={space.sm} alignment="end">
              <AverageValue ratio={graph.ratio(null)} size="display" showScale colored />
              <DeltaValue
                delta={slope === null ? null : slope * Math.max(1, series.length - 1)}
                size="callout"
              />
            </Row>
            {series.length > 2 ? (
              <Sparkline series={series} positive={(slope ?? 0) >= 0} />
            ) : null}
          </Column>
        </Section>

        <Section title={t("Where it lands")}>
          <Line
            title={t("If the trend holds")}
            detail={
              weeksLeft > 0
                ? t("{count} weeks left in this period", { count: weeksLeft })
                : t("This period is over")
            }
            trailing={<AverageValue ratio={projection} size="heading" colored />}
          />
        </Section>

        <Section title={t("The shape of your results")}>
          <Column spacing={space.sm}>
            <Distribution buckets={buckets} />
            <Row>
              <Label>{t("Weak")}</Label>
              <Spacer flexible />
              <Label>{t("Strong")}</Label>
            </Row>
          </Column>
        </Section>

        <Section title={t("Numbers")}>
          <Line
            title={t("Grades recorded")}
            trailing={<Text mono>{String(ratios.length)}</Text>}
          />
          <Line
            title={t("Pass rate")}
            trailing={<PercentValue ratio={passRate(ratios, passingRatio)} />}
          />
          <Line
            title={t("Median result")}
            trailing={<AverageValue ratio={median(ratios)} size="body" />}
          />
          <Line
            title={t("Mean result")}
            detail={t("Unweighted — every grade counts once")}
            trailing={<AverageValue ratio={mean(ratios)} size="body" />}
          />
          <Line
            title={t("Spread")}
            detail={t("How far a typical result sits from your average")}
            trailing={
              <Text mono>
                {spread === null
                  ? "—"
                  : formatNumber(spread * scale, decimals)}
              </Text>
            }
          />
          <Line
            title={t("Consistency")}
            trailing={<PercentValue ratio={consistency(ratios)} />}
          />
          <Line
            title={t("Second half vs first")}
            trailing={<DeltaValue delta={improvement(ratios)} size="body" />}
          />
        </Section>

        <Section title={t("Streaks")}>
          <Line
            title={t("Passing right now")}
            trailing={
              <Text mono>
                {streaks.current.length === 1
                  ? t("1 result")
                  : t("{count} results", { count: streaks.current.length })}
              </Text>
            }
          />
          <Line
            title={t("Best run this year")}
            trailing={
              <Text mono>
                {streaks.longest.length === 1
                  ? t("1 result")
                  : t("{count} results", { count: streaks.longest.length })}
              </Text>
            }
          />
        </Section>

        {ranked.length > 1 ? (
          <Section title={t("Subjects, best first")}>
            {ranked.map((entry) => (
              <Line
                key={entry.subject.id}
                title={entry.subject.name}
                onPress={() => router.push(`/subject/${entry.subject.id}`)}
                trailing={
                  <AverageValue ratio={entry.ratio} size="callout" colored />
                }
              />
            ))}
          </Section>
        ) : null}

        {improving.length > 0 ? (
          <Section title={t("Moving the most")}>
            {improving[0] ? (
              <Line
                title={t("Most improved")}
                detail={improving[0].subject.name}
                onPress={() => router.push(`/subject/${improving[0]!.subject.id}`)}
                trailing={<DeltaValue delta={improving[0].delta} size="body" />}
              />
            ) : null}
            {declining && declining.subject.id !== improving[0]?.subject.id ? (
              <Line
                title={t("Slipping the most")}
                detail={declining.subject.name}
                onPress={() => router.push(`/subject/${declining.subject.id}`)}
                trailing={<DeltaValue delta={declining.delta} size="body" />}
              />
            ) : null}
            {steadiest[0] ? (
              <Line
                title={t("Steadiest")}
                detail={steadiest[0].subject.name}
                onPress={() => router.push(`/subject/${steadiest[0]!.subject.id}`)}
                trailing={<PercentValue ratio={steadiest[0].consistency} />}
              />
            ) : null}
          </Section>
        ) : null}

        <Spacer size={space.xl} />
      </Grouped>
    </>
  );
}
