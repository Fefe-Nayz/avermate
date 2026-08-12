import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Icon, type IconName } from "@/components/icon";
import { Button, Card, Empty, Label, Loading, ProgressBar, Row, Section } from "@/components/ui";
import { AverageValue } from "@/components/value";
import { StatusPill } from "@/components/goal-status";
import { adviceText } from "@/components/goal-advice";
import { useGoalPlans } from "@/components/use-goal-plans";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * A goal, and what to do about it.
 *
 * Three answers, in the order they are useful: what the next result has to be,
 * what a steady run of results has to be, and which subject is worth the effort.
 * All three come out of the same inversion — an average is affine in any single
 * input, so "what would it take" has an exact answer rather than a guess.
 */
export default function GoalDetail() {
  const palette = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoading, graph, scale, decimals } = useYear();
  const plans = useGoalPlans();

  const plan = plans.find((item) => item.goal.id === id);

  const markAchieved = useMutation({
    mutationFn: (input: Parameters<typeof client.goals.markAchieved>[0]) =>
      client.goals.markAchieved(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
    },
  });

  const remove = useMutation({
    mutationFn: (input: Parameters<typeof client.goals.delete>[0]) =>
      client.goals.delete(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.dismissTo("/(tabs)/goals");
    },
  });

  if (isLoading) return <Loading />;
  if (!plan) {
    return <Empty icon="help-circle-outline" title={t("Goal not found.")} />;
  }

  const confirmDelete = () => {
    Alert.alert(t("Delete this goal?"), t("This cannot be undone."), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () => {
          haptic("warning");
          remove.mutate({ goalId: plan.goal.id });
        },
      },
    ]);
  };

  const advice = plan.advice
    .map((item) => adviceText(item, { graph, scale, decimals }))
    .filter(
      (item): item is { icon: IconName; text: string } => item !== null,
    );

  const nextResults = plan.nextResults
    .filter((entry) => entry.achievable && !entry.alreadySecured)
    .slice(0, 4);

  const horizons = plan.horizons
    .filter((entry) => entry.achievable && !entry.alreadySecured)
    .slice(0, 3);

  const levers = plan.levers.filter((lever) => lever.leverage > 0.001).slice(0, 5);
  const done = plan.status === "achieved" || plan.status === "secured";

  return (
    <>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => (
            <Pressable
              onPress={() => {
                haptic("light");
                router.push(`/goal/edit?id=${plan.goal.id}`);
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
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <Text style={[type.title, { flex: 1, color: palette.text }]}>
              {plan.goal.name}
            </Text>
            <StatusPill status={plan.status} />
          </View>

          <View
            style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}
          >
            <AverageValue ratio={plan.current} size="hero" colored />
            <View style={{ paddingBottom: space.md }}>
              <Text style={[type.callout, { color: palette.textFaint }]}>
                {t("of")} {(plan.target * scale).toFixed(decimals)}
              </Text>
            </View>
          </View>

          <ProgressBar
            value={
              plan.current === null || plan.target === 0
                ? 0
                : plan.current / plan.target
            }
            done={done}
          />

          {plan.gap !== null && plan.gap > 0 ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
            >
              <Text style={[type.footnote, { color: palette.textMuted }]}>
                {t("Still to go")}
              </Text>
              <AverageValue ratio={plan.gap} size="footnote" />
            </View>
          ) : null}
        </View>

        {advice.length > 0 ? (
          <Section title={t("How to get there")}>
            <Card>
              <View style={{ gap: space.md }}>
                {advice.map((item, index) => (
                  <View
                    key={index}
                    style={{ flexDirection: "row", gap: space.md }}
                  >
                    <View style={{ marginTop: 2 }}>
                      <Icon
                        name={item.icon}
                        size={17}
                        color={palette.textFaint}
                      />
                    </View>
                    <Text
                      style={[type.body, { flex: 1, color: palette.text }]}
                    >
                      {item.text}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </Section>
        ) : null}

        {!done && nextResults.length > 0 ? (
          <Section title={t("What your next result has to be")}>
            <Card padded={false}>
              {nextResults.map((entry, index) => (
                <Row
                  key={entry.subject.id}
                  first={index === 0}
                  title={entry.subject.name}
                  onPress={() => router.push(`/subject/${entry.subject.id}`)}
                  trailing={
                    <AverageValue
                      ratio={Math.min(1, entry.requiredRatio)}
                      size="callout"
                      colored
                    />
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {!done && horizons.length > 0 ? (
          <Section title={t("Or a steady run")}>
            <Card padded={false}>
              {horizons.map((entry, index) => (
                <Row
                  key={entry.count}
                  first={index === 0}
                  title={
                    entry.count === 1
                      ? t("1 more result")
                      : t("{count} more results", { count: entry.count })
                  }
                  trailing={
                    <AverageValue
                      ratio={Math.min(1, entry.requiredRatio)}
                      size="callout"
                      colored
                    />
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {levers.length > 0 ? (
          <Section title={t("Where effort pays off most")}>
            <Card padded={false}>
              {levers.map((lever, index) => (
                <Row
                  key={lever.subject.id}
                  first={index === 0}
                  title={lever.subject.name}
                  subtitle={t("Worth up to {gain} on this average", {
                    gain: (lever.realisticGain * scale).toFixed(decimals),
                  })}
                  onPress={() => router.push(`/subject/${lever.subject.id}`)}
                  trailing={
                    <View
                      style={{
                        width: 56,
                        height: 6,
                        borderRadius: radius.pill,
                        backgroundColor: palette.accentSoft,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.min(100, (lever.leverage / (levers[0]?.leverage || 1)) * 100)}%`,
                          height: "100%",
                          backgroundColor: palette.accent,
                        }}
                      />
                    </View>
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={t("The range still open")}>
          <Card>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ gap: space.xs }}>
                <Label>{t("At worst")}</Label>
                <AverageValue ratio={plan.floor} size="heading" />
              </View>
              <View style={{ gap: space.xs, alignItems: "flex-end" }}>
                <Label>{t("At best")}</Label>
                <AverageValue ratio={plan.ceiling} size="heading" />
              </View>
            </View>
          </Card>
        </Section>

        <Button
          label={
            plan.goal.achievedAt ? t("Reopen this goal") : t("Mark as reached")
          }
          variant="secondary"
          onPress={() =>
            markAchieved.mutate({
              goalId: plan.goal.id,
              achieved: plan.goal.achievedAt === null,
            })
          }
        />

        <Button
          label={t("Delete goal")}
          onPress={confirmDelete}
          variant="destructive"
          loading={remove.isPending}
        />
      </ScrollView>
    </>
  );
}
