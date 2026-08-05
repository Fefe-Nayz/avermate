import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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
  Label,
  Loading,
  ProgressBar,
  Row,
  Section,
} from "@/components/ui";
import { AverageValue, DeltaValue, ResultBadge } from "@/components/value";
import { Sparkline } from "@/components/sparkline";
import { ScopeBar } from "@/components/scope-bar";
import { formatDay } from "@/components/date-field";
import { useYear } from "@/components/year-provider";
import { useGoalPlans } from "@/components/use-goal-plans";
import { useCards } from "@/components/use-cards";
import { CardView } from "@/components/card-view";
import { useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

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
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: session } = useSession();

  const {
    isLoading,
    year,
    graph,
    subjects,
    period,
    passingRatio,
    refresh,
  } = useYear();
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxxl,
        gap: space.xl,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={refresh}
          tintColor={palette.textFaint}
        />
      }
    >
      <View style={{ gap: space.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {session?.user.name
              ? t("Hello, {name}", { name: session.user.name.split(" ")[0] ?? "" })
              : t("Hello")}
          </Text>
          <Pressable
            onPress={() => {
              haptic("light");
              router.push("/grade/new");
            }}
            hitSlop={10}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              height: 34,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: palette.accent,
            }}
          >
            <Ionicons name="add" size={16} color={palette.accentText} />
            <Text style={[type.footnote, { color: palette.accentText, fontWeight: "600" }]}>
              {t("Add grade")}
            </Text>
          </Pressable>
        </View>

        <View style={{ gap: space.xs }}>
          <Label>{t("General average")}</Label>
          <AverageValue ratio={general} size="hero" showScale colored />
          {slope !== null ? (
            // The fitted change across the whole window, not since yesterday:
            // one result should not be able to rewrite the headline.
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
              }}
            >
              <DeltaValue
                delta={slope * Math.max(1, series.length - 1)}
                size="footnote"
              />
              <Text style={[type.footnote, { color: palette.textMuted }]}>
                {t("over this period")}
              </Text>
            </View>
          ) : null}
        </View>

        {series.length > 2 ? (
          <Sparkline series={series} positive={(slope ?? 0) >= 0} />
        ) : null}

        <ScopeBar />
      </View>

      {cards.specs.map((spec) => (
        <CardView key={spec.id} spec={spec} result={cards.results.get(spec.id)} />
      ))}

      {pinned.length > 0 ? (
        <Section title={t("Goals")}>
          <View style={{ gap: space.sm }}>
            {pinned.map((plan) => (
              <Pressable
                key={plan.goal.id}
                onPress={() => {
                  haptic("selection");
                  router.push(`/goal/${plan.goal.id}`);
                }}
              >
                <Card>
                  <View style={{ gap: space.sm }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={[type.body, { flex: 1, color: palette.text }]}
                      >
                        {plan.goal.name}
                      </Text>
                      <AverageValue ratio={plan.current} size="callout" />
                      <Text style={[type.footnote, { color: palette.textFaint }]}>
                        /
                      </Text>
                      <AverageValue ratio={plan.target} size="callout" />
                    </View>
                    <ProgressBar
                      value={
                        plan.current === null || plan.target === 0
                          ? 0
                          : plan.current / plan.target
                      }
                      done={plan.status === "achieved" || plan.status === "secured"}
                    />
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      {mainSubjects.length > 0 ? (
        <Section title={t("Watching")}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {mainSubjects.map((subject) => (
              <Pressable
                key={subject.id}
                onPress={() => {
                  haptic("selection");
                  router.push(`/subject/${subject.id}`);
                }}
                style={{ flexBasis: "48%", flexGrow: 1 }}
              >
                <Card>
                  <View style={{ gap: space.xs }}>
                    <Text
                      numberOfLines={1}
                      style={[type.footnote, { color: palette.textMuted }]}
                    >
                      {subject.shortName ?? subject.name}
                    </Text>
                    <AverageValue
                      ratio={graph.ratio(subject.id)}
                      size="title"
                      colored
                    />
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      <Section
        title={t("Latest results")}
        action={
          recent.length > 0 ? (
            <Pressable
              onPress={() => {
                haptic("selection");
                router.push("/(tabs)/grades");
              }}
              hitSlop={8}
            >
              <Text style={[type.footnote, { color: palette.textMuted }]}>
                {t("See all")}
              </Text>
            </Pressable>
          ) : null
        }
      >
        <Card padded={false}>
          {recent.length === 0 ? (
            <Empty
              icon="document-text-outline"
              title={t("Nothing recorded yet.")}
              body={t("Add your first grade and the year starts drawing itself.")}
            />
          ) : (
            recent.map((grade, index) => {
              const subject = graph.byId(grade.subjectId);
              const impact = gradeImpact(graph, grade.id);
              return (
                <Row
                  key={grade.id}
                  first={index === 0}
                  title={grade.name}
                  subtitle={`${subject?.name ?? ""} · ${formatDay(grade.passedAt)}`}
                  onPress={() => router.push(`/grade/${grade.id}`)}
                  trailing={
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <ResultBadge ratio={gradeRatio(grade)} />
                      <DeltaValue delta={impact.delta} />
                    </View>
                  }
                />
              );
            })
          )}
        </Card>
      </Section>

      {ratios.length > 0 ? (
        <Section title={t("How the year is going")}>
          <Card padded={false}>
            <Row
              first
              title={t("Grades recorded")}
              trailing={
                <Text style={[type.body, { color: palette.text }]}>
                  {String(ratios.length)}
                </Text>
              }
            />
            {pass !== null ? (
              <Row
                title={t("Pass rate")}
                trailing={
                  <Text style={[type.body, { color: palette.text }]}>
                    {`${Math.round(pass * 100)}%`}
                  </Text>
                }
              />
            ) : null}
            {best ? (
              <Row
                title={t("Strongest subject")}
                subtitle={best.subject.name}
                onPress={() => router.push(`/subject/${best.subject.id}`)}
                trailing={<AverageValue ratio={best.ratio} size="callout" colored />}
              />
            ) : null}
            <Row
              title={t("All the statistics")}
              onPress={() => router.push("/insights")}
            />
            {worst && worst.subject.id !== best?.subject.id ? (
              <Row
                title={t("Weakest subject")}
                subtitle={worst.subject.name}
                onPress={() => router.push(`/subject/${worst.subject.id}`)}
                trailing={<AverageValue ratio={worst.ratio} size="callout" colored />}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Card>
        <View style={{ gap: space.md }}>
          <View style={{ gap: 2 }}>
            <Text style={[type.heading, { color: palette.text }]}>
              {t("Year in review")}
            </Text>
            <Text style={[type.footnote, { color: palette.textMuted }]}>
              {t("Your year, told back to you")}
            </Text>
          </View>
          <Button
            label={t("Open")}
            variant="secondary"
            onPress={() => router.push("/review")}
          />
        </View>
      </Card>
    </ScrollView>
  );
}
