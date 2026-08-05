import { useMemo } from "react";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Column, Spacer } from "@expo/ui";
import { buildYearReview, type AwardKind } from "@avermate/core";
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
import { AverageValue, PercentValue } from "@/components/value";
import { formatDate, formatNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { orpc } from "@/lib/orpc";
import { locale, t } from "@/lib/i18n";
import { space } from "@/lib/theme";

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
        <Grouped>
          <Empty
            glyph="review"
            title={t("The story is still being written.")}
            body={t("Record a few more grades and your year gets its recap.")}
          />
        </Grouped>
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

  return (
    <>
      <Stack.Screen options={{ title: t("Year in review") }} />
      <Grouped>
        <Section>
          <Column spacing={space.md}>
            <Label>{year?.name ?? ""}</Label>
            <Text size="display">{awardTitle(review.award)}</Text>
            <Text size="callout" tone="muted">
              {awardBlurb(review.award)}
            </Text>
          </Column>
        </Section>

        <Section title={t("The headline")}>
          <Line
            title={t("Your average")}
            trailing={
              <AverageValue ratio={review.average} size="heading" colored />
            }
          />
          {review.topPercentile > 0 ? (
            <Line
              title={t("Among everyone using Avermate")}
              detail={t("Only the number matters — no names ever leave a device.")}
              trailing={
                <Text size="heading" mono>
                  {t("top {percent}%", { percent: review.topPercentile })}
                </Text>
              }
            />
          ) : null}
          <Line
            title={t("Grades recorded")}
            trailing={<Text mono>{String(review.gradeCount)}</Text>}
          />
        </Section>

        <Section title={t("How you worked")}>
          {review.busiestMonth ? (
            <Line
              title={t("Busiest month")}
              detail={monthName(review.busiestMonth.month)}
              trailing={
                <Text mono>
                  {t("{count} grades", { count: review.busiestMonth.count })}
                </Text>
              }
            />
          ) : null}
          {review.busiestWeekday ? (
            <Line
              title={t("The day it always lands on")}
              trailing={
                <Text>{weekdays[review.busiestWeekday.weekday] ?? ""}</Text>
              }
            />
          ) : null}
          <Line
            title={t("Longest run of active days")}
            trailing={
              <Text mono>
                {review.longestStreak === 1
                  ? t("1 day")
                  : t("{count} days", { count: review.longestStreak })}
              </Text>
            }
          />
          {review.firstGradeAt ? (
            <Line
              title={t("It started")}
              trailing={<Text>{formatDate(review.firstGradeAt, "short")}</Text>}
            />
          ) : null}
          {review.lastGradeAt ? (
            <Line
              title={t("Last one in")}
              trailing={<Text>{formatDate(review.lastGradeAt, "short")}</Text>}
            />
          ) : null}
        </Section>

        {review.primeTime ? (
          <Section title={t("Your peak")}>
            <Line
              title={formatDate(review.primeTime.date)}
              detail={t("The day your average was at its highest")}
              trailing={
                <AverageValue
                  ratio={review.primeTime.ratio}
                  size="heading"
                  colored
                />
              }
            />
          </Section>
        ) : null}

        {review.topSubjects.length > 0 ? (
          <Section title={t("What you were best at")}>
            {review.topSubjects.map((subject) => (
              <Line
                key={subject.subjectId}
                title={subject.name}
                onPress={() => router.push(`/subject/${subject.subjectId}`)}
                trailing={
                  <AverageValue ratio={subject.ratio} size="callout" colored />
                }
              />
            ))}
          </Section>
        ) : null}

        {review.bestProgression ? (
          <Section title={t("The turnaround")}>
            <Line
              title={review.bestProgression.name}
              detail={t("Furthest travelled between the halves of the year")}
              onPress={() =>
                router.push(`/subject/${review.bestProgression!.subjectId}`)
              }
              trailing={
                <Text size="heading" mono>
                  {`+${formatNumber(review.bestProgression.delta * 100, 0)} %`}
                </Text>
              }
            />
          </Section>
        ) : null}

        <Section title={t("In total")}>
          <Line
            title={t("Everything you were graded on, added up")}
            trailing={
              <Text size="heading" mono>
                {formatNumber(review.ratioSum, 1)}
              </Text>
            }
          />
          <Line
            title={t("Subjects followed")}
            trailing={
              <Text mono>
                {String(
                  graph.subjects.filter((s) => s.kind !== "category").length,
                )}
              </Text>
            }
          />
        </Section>

        <Spacer size={space.xl} />
      </Grouped>
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
