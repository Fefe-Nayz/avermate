import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
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
import { Card, Empty, Label, Loading, Row, Section } from "@/components/ui";
import { AverageValue, DeltaValue, PercentValue } from "@/components/value";
import { Distribution, Sparkline } from "@/components/sparkline";
import { ScopeBar } from "@/components/scope-bar";
import { formatNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";

/**
 * The statistics screen.
 *
 * Everything here is derived rather than stored, so it costs nothing to offer
 * — but that is a reason to be selective, not exhaustive. Each number answers
 * a question somebody actually asks: am I steady, am I improving, where do I
 * end up if nothing changes, and which subjects are pulling which way.
 */
export default function Insights() {
  const palette = usePalette();
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
        <Empty
          icon="stats-chart-outline"
          title={t("Not enough data yet")}
          body={t("A handful of grades and this screen fills in.")}
        />
      </>
    );
  }

  const slope = trend(series);
  const weeksLeft = Math.max(
    0,
    Math.round((period.endAt.getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000)),
  );
  const projection = projectedRatio(series, weeksLeft);
  const spread = standardDeviation(ratios);
  const declining = [...improving].reverse()[0];

  const stat = (value: string) => (
    <Text style={[type.body, { color: palette.text }]}>{value}</Text>
  );

  return (
    <>
      <Stack.Screen options={{ title: t("Insights") }} />
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
          <View
            style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}
          >
            <AverageValue
              ratio={graph.ratio(null)}
              size="hero"
              showScale
              colored
            />
            <View style={{ paddingBottom: space.sm }}>
              <DeltaValue
                delta={
                  slope === null ? null : slope * Math.max(1, series.length - 1)
                }
                size="callout"
              />
            </View>
          </View>
          {series.length > 2 ? (
            <Sparkline series={series} positive={(slope ?? 0) >= 0} />
          ) : null}
          <ScopeBar />
        </View>

        <Section title={t("Where it lands")}>
          <Card padded={false}>
            <Row
              first
              title={t("If the trend holds")}
              subtitle={
                weeksLeft > 0
                  ? t("{count} weeks left in this period", { count: weeksLeft })
                  : t("This period is over")
              }
              trailing={
                <AverageValue ratio={projection} size="heading" colored />
              }
            />
          </Card>
        </Section>

        <Section title={t("The shape of your results")}>
          <Card>
            <View style={{ gap: space.sm }}>
              <Distribution buckets={buckets} />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Label>{t("Weak")}</Label>
                <Label>{t("Strong")}</Label>
              </View>
            </View>
          </Card>
        </Section>

        <Section title={t("Numbers")}>
          <Card padded={false}>
            <Row
              first
              title={t("Grades recorded")}
              trailing={stat(String(ratios.length))}
            />
            <Row
              title={t("Pass rate")}
              trailing={<PercentValue ratio={passRate(ratios, passingRatio)} />}
            />
            <Row
              title={t("Median result")}
              trailing={<AverageValue ratio={median(ratios)} size="body" />}
            />
            <Row
              title={t("Mean result")}
              subtitle={t("Unweighted — every grade counts once")}
              trailing={<AverageValue ratio={mean(ratios)} size="body" />}
            />
            <Row
              title={t("Spread")}
              subtitle={t("How far a typical result sits from your average")}
              trailing={stat(
                spread === null ? "—" : formatNumber(spread * scale, decimals),
              )}
            />
            <Row
              title={t("Consistency")}
              trailing={<PercentValue ratio={consistency(ratios)} />}
            />
            <Row
              title={t("Second half vs first")}
              trailing={<DeltaValue delta={improvement(ratios)} size="body" />}
            />
          </Card>
        </Section>

        <Section title={t("Streaks")}>
          <Card padded={false}>
            <Row
              first
              title={t("Passing right now")}
              trailing={stat(
                streaks.current.length === 1
                  ? t("1 result")
                  : t("{count} results", { count: streaks.current.length }),
              )}
            />
            <Row
              title={t("Best run this year")}
              trailing={stat(
                streaks.longest.length === 1
                  ? t("1 result")
                  : t("{count} results", { count: streaks.longest.length }),
              )}
            />
          </Card>
        </Section>

        {ranked.length > 1 ? (
          <Section title={t("Subjects, best first")}>
            <Card padded={false}>
              {ranked.map((entry, index) => (
                <Row
                  key={entry.subject.id}
                  first={index === 0}
                  title={entry.subject.name}
                  onPress={() => router.push(`/subject/${entry.subject.id}`)}
                  trailing={
                    <AverageValue ratio={entry.ratio} size="callout" colored />
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {improving.length > 0 ? (
          <Section title={t("Moving the most")}>
            <Card padded={false}>
              {improving[0] ? (
                <Row
                  first
                  title={t("Most improved")}
                  subtitle={improving[0].subject.name}
                  onPress={() =>
                    router.push(`/subject/${improving[0]!.subject.id}`)
                  }
                  trailing={<DeltaValue delta={improving[0].delta} size="body" />}
                />
              ) : null}
              {declining && declining.subject.id !== improving[0]?.subject.id ? (
                <Row
                  title={t("Slipping the most")}
                  subtitle={declining.subject.name}
                  onPress={() => router.push(`/subject/${declining.subject.id}`)}
                  trailing={<DeltaValue delta={declining.delta} size="body" />}
                />
              ) : null}
              {steadiest[0] ? (
                <Row
                  title={t("Steadiest")}
                  subtitle={steadiest[0].subject.name}
                  onPress={() =>
                    router.push(`/subject/${steadiest[0]!.subject.id}`)
                  }
                  trailing={<PercentValue ratio={steadiest[0].consistency} />}
                />
              ) : null}
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}
