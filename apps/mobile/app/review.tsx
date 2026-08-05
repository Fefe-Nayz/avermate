import { useMemo } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { buildYearReview, type AwardKind } from "@avermate/core";
import { Card, Empty, Label, Loading, Row, Screen, Section } from "@/components/ui";
import { AverageValue } from "@/components/value";
import { formatDate, formatNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { orpc } from "@/lib/orpc";
import { locale, t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";

/**
 * The end-of-year recap.
 *
 * Assembled from the year already in memory — only the percentile comes from
 * the server, because it is the one number that needs everybody else's data.
 * The numbers are picked for what they say about a year rather than for what
 * is cheap to compute: when you peaked, what you were graded on most, the
 * subject that turned around.
 */
export default function Review() {
  const palette = usePalette();
  const router = useRouter();
  const { isLoading, subjects, year, yearId, graph } = useYear();

  const status = useQuery({
    ...orpc.review.status.queryOptions({
      input: { yearId: yearId ?? "", reviewKey: "annual" },
    }),
    enabled: Boolean(yearId),
  });

  const review = useMemo(() => {
    if (!year) return null;
    return buildYearReview(
      subjects,
      { startsAt: new Date(year.startsAt), endsAt: new Date(year.endsAt) },
      status.data?.topPercentile ?? 0,
    );
  }, [subjects, year, status.data]);

  if (isLoading || status.isLoading) return <Loading />;

  if (!review || !status.data?.available) {
    return (
      <>
        <Stack.Screen options={{ title: t("Year in review") }} />
        <Empty
          icon="sparkles-outline"
          title={t("The story is still being written.")}
          body={t("Record a few more grades and your year gets its recap.")}
        />
      </>
    );
  }

  const weekdays = [
    t("Sunday"),
    t("Monday"),
    t("Tuesday"),
    t("Wednesday"),
    t("Thursday"),
    t("Friday"),
    t("Saturday"),
  ];

  const plain = (value: string) => (
    <Text style={[type.body, { color: palette.text }]}>{value}</Text>
  );

  return (
    <>
      <Stack.Screen options={{ title: t("Year in review") }} />
      <Screen>
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          <Label>{year?.name ?? ""}</Label>
          <Text style={[type.display, { color: palette.text }]}>
            {awardTitle(review.award)}
          </Text>
          <Text style={[type.callout, { color: palette.textMuted }]}>
            {awardBlurb(review.award)}
          </Text>
        </View>

        <Section title={t("The headline")}>
          <Card padded={false}>
            <Row
              first
              title={t("Your average")}
              trailing={
                <AverageValue ratio={review.average} size="heading" colored />
              }
            />
            {review.topPercentile > 0 ? (
              <Row
                title={t("Among everyone using Avermate")}
                subtitle={t(
                  "Only the number matters — no names ever leave a device.",
                )}
                trailing={plain(
                  t("top {percent}%", { percent: review.topPercentile }),
                )}
              />
            ) : null}
            <Row
              title={t("Grades recorded")}
              trailing={plain(String(review.gradeCount))}
            />
          </Card>
        </Section>

        <Section title={t("How you worked")}>
          <Card padded={false}>
            {review.busiestMonth ? (
              <Row
                first
                title={t("Busiest month")}
                subtitle={monthName(review.busiestMonth.month)}
                trailing={plain(
                  t("{count} grades", { count: review.busiestMonth.count }),
                )}
              />
            ) : null}
            {review.busiestWeekday ? (
              <Row
                title={t("The day it always lands on")}
                trailing={plain(weekdays[review.busiestWeekday.weekday] ?? "")}
              />
            ) : null}
            <Row
              title={t("Longest run of active days")}
              trailing={plain(
                review.longestStreak === 1
                  ? t("1 day")
                  : t("{count} days", { count: review.longestStreak }),
              )}
            />
            {review.firstGradeAt ? (
              <Row
                title={t("It started")}
                trailing={plain(formatDate(review.firstGradeAt, "short"))}
              />
            ) : null}
            {review.lastGradeAt ? (
              <Row
                title={t("Last one in")}
                trailing={plain(formatDate(review.lastGradeAt, "short"))}
              />
            ) : null}
          </Card>
        </Section>

        {review.primeTime ? (
          <Section title={t("Your peak")}>
            <Card padded={false}>
              <Row
                first
                title={formatDate(review.primeTime.date)}
                subtitle={t("The day your average was at its highest")}
                trailing={
                  <AverageValue
                    ratio={review.primeTime.ratio}
                    size="heading"
                    colored
                  />
                }
              />
            </Card>
          </Section>
        ) : null}

        {review.topSubjects.length > 0 ? (
          <Section title={t("What you were best at")}>
            <Card padded={false}>
              {review.topSubjects.map((subject, index) => (
                <Row
                  key={subject.subjectId}
                  first={index === 0}
                  title={subject.name}
                  onPress={() => router.push(`/subject/${subject.subjectId}`)}
                  trailing={
                    <AverageValue ratio={subject.ratio} size="callout" colored />
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {review.bestProgression ? (
          <Section title={t("The turnaround")}>
            <Card padded={false}>
              <Row
                first
                title={review.bestProgression.name}
                subtitle={t("Furthest travelled between the halves of the year")}
                onPress={() =>
                  router.push(`/subject/${review.bestProgression!.subjectId}`)
                }
                trailing={plain(
                  `+${formatNumber(review.bestProgression.delta * 100, 0)} %`,
                )}
              />
            </Card>
          </Section>
        ) : null}

        <Section title={t("In total")}>
          <Card padded={false}>
            <Row
              first
              title={t("Everything you were graded on, added up")}
              trailing={plain(formatNumber(review.ratioSum, 1))}
            />
            <Row
              title={t("Subjects followed")}
              trailing={plain(
                String(
                  graph.subjects.filter((item) => item.kind !== "category")
                    .length,
                ),
              )}
            />
          </Card>
        </Section>
      </Screen>
    </>
  );
}

/** The award is the one place the app is allowed to be a bit theatrical. */
function awardTitle(award: AwardKind): string {
  switch (award) {
    case "tourist":
      return t("The Visitor");
    case "tightrope":
      return t("The Tightrope Walker");
    case "comeback":
      return t("The Comeback");
    case "allin":
      return t("All In");
    case "masterclass":
      return t("The Masterclass");
    case "unpredictable":
      return t("The Wildcard");
    case "precision":
      return t("The Metronome");
    case "legend":
      return t("The Legend");
    case "avermatien":
      return t("The Avermatian");
  }
}

function awardBlurb(award: AwardKind): string {
  switch (award) {
    case "tourist":
      return t("You passed through. The year barely knew you were there.");
    case "tightrope":
      return t("Close to the line all year, and you never fell off it.");
    case "comeback":
      return t("It started badly. That is not how it ended.");
    case "allin":
      return t("Nobody recorded more than you did.");
    case "masterclass":
      return t("High, and it stayed high. That is the hard part.");
    case "unpredictable":
      return t("Brilliant, then baffling. Never the same twice.");
    case "precision":
      return t("The same result, again and again. Uncanny.");
    case "legend":
      return t("A year that will be hard to beat — including by you.");
    case "avermatien":
      return t("You have used this app more than the app expected.");
  }
}

function monthName(key: string): string {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(locale() === "fr" ? "fr-FR" : "en-GB", {
    month: "long",
    year: "numeric",
  });
}
