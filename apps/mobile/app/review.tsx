import { useMemo } from "react";
import { Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { useQuery } from "@tanstack/react-query";
import {
  buildYearReview,
  type CustomAverage,
  type Goal,
  type Period,
  type Subject,
  type Year,
} from "@avermate/core";
import {
  Empty,
  Loading,
  Row,
  Card,
  Screen,
  Section,
  Title,
} from "@/components/ui";
import { YearReviewStory } from "@/components/review/year-review-story";
import { useYear } from "@/components/year-provider";
import { useSession } from "@/lib/auth-client";
import { formatDate } from "@/components/format";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { type, usePalette } from "@/lib/theme";
import { yearReviewWindowKey } from "@/lib/year-review-window";

interface Snapshot {
  customAverages: CustomAverage[];
  goals: Goal[];
  periods: Period[];
  subjects: Subject[];
  year: Year;
}

/** A recap library first, and an immersive story only after an explicit play. */
export default function Review() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ play?: string; yearId?: string }>();
  const session = useSession();
  const active = useYear();
  const playing = params.play === "1";
  const eligible = useQuery(orpc.review.eligibleYears.queryOptions());
  const eligibleYears = eligible.data ?? [];
  const selectedYearId =
    (params.yearId &&
    eligibleYears.some((item) => item.yearId === params.yearId)
      ? params.yearId
      : eligibleYears.find((item) => item.yearId === active.yearId)?.yearId) ??
    eligibleYears[0]?.yearId ??
    null;

  const snapshot = useQuery({
    ...orpc.snapshot.get.queryOptions({
      input: { yearId: selectedYearId ?? "" },
    }),
    enabled: Boolean(playing && selectedYearId),
  });
  const selectedSnapshot = snapshot.data as Snapshot | undefined;
  const selectedYear = selectedSnapshot?.year ?? null;
  const reviewKey = selectedYear
    ? (yearReviewWindowKey(
        new Date(active.now),
        new Date(selectedYear.startsAt),
        new Date(selectedYear.endsAt),
      ) ?? "annual")
    : "annual";
  const status = useQuery({
    ...orpc.review.status.queryOptions({
      input: { yearId: selectedYearId ?? "", reviewKey },
    }),
    enabled: Boolean(playing && selectedYearId && selectedYear),
  });
  const review = useMemo(
    () =>
      selectedYear && status.data?.available
        ? buildYearReview(
            selectedSnapshot?.subjects ?? [],
            selectedYear,
            status.data.topPercentile,
            new Date(active.now),
          )
        : null,
    [active.now, selectedSnapshot?.subjects, selectedYear, status.data],
  );

  if (playing) {
    if (snapshot.isLoading || status.isLoading || eligible.isLoading) {
      return (
        <>
          <Stack.Screen options={{ headerShown: false }} />
          <Loading />
        </>
      );
    }
    if (!review || !selectedYear || !status.data?.available) {
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
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />
        <NavigationBar style="light" />
        <YearReviewStory
          decimals={selectedYear.decimals}
          onClose={() => router.replace("/review")}
          review={review}
          reviewKey={reviewKey}
          scale={selectedYear.scale}
          userName={session.data?.user.name ?? t("Student")}
          year={selectedYear}
        />
      </>
    );
  }

  if (eligible.isLoading) return <Loading />;

  return (
    <>
      <Stack.Screen options={{ title: t("Year in review") }} />
      <Screen>
        <Title
          subtitle={t("Replay the years that already have enough to tell.")}
        >
          {t("Your recap library")}
        </Title>
        {eligibleYears.length === 0 ? (
          <Empty
            icon="sparkles-outline"
            title={t("The story is still being written.")}
            body={t("Five grades in a year unlock its recap.")}
          />
        ) : (
          <Section title={t("Eligible years")}>
            <Card padded={false}>
              {eligibleYears.map((item, index) => (
                <Row
                  first={index === 0}
                  key={item.yearId}
                  title={item.name}
                  subtitle={`${formatDate(item.startsAt, "short")} – ${formatDate(
                    item.endsAt,
                    "short",
                  )}`}
                  onPress={() =>
                    router.push({
                      pathname: "/review",
                      params: { play: "1", yearId: item.yearId },
                    })
                  }
                  trailing={
                    <Text
                      selectable
                      style={[type.callout, { color: palette.textMuted }]}
                    >
                      {t("{count} grades", { count: String(item.total) })}
                    </Text>
                  }
                />
              ))}
            </Card>
          </Section>
        )}
      </Screen>
    </>
  );
}
