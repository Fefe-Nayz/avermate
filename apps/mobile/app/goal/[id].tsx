import { Alert, Pressable } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Column, Spacer } from "@expo/ui";
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
import { AverageValue } from "@/components/value";
import { ProgressBar } from "@/components/chart";
import { StatusPill } from "@/components/goal-status";
import { adviceText } from "@/components/goal-advice";
import { Sign } from "@/components/icon";
import { formatNumber } from "@/components/format";
import { useGoalPlans } from "@/components/use-goal-plans";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * A goal, and what to do about it.
 *
 * Three answers, in the order they are useful: what the next result has to be,
 * what a steady run of results has to be, and which subject is worth the effort.
 * All three come out of the same inversion — an average is affine in any single
 * input, so "what would it take" has an exact answer rather than a guess.
 */
export default function GoalDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoading, graph, scale, decimals } = useYear();
  const plans = useGoalPlans();

  const plan = plans.find((item) => item.goal.id === id);

  const remove = useMutation({
    mutationFn: (input: Parameters<typeof client.goals.delete>[0]) =>
      client.goals.delete(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.dismissTo("/(tabs)/goals");
    },
  });

  const markAchieved = useMutation({
    mutationFn: (input: Parameters<typeof client.goals.markAchieved>[0]) =>
      client.goals.markAchieved(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
    },
  });

  if (isLoading) return <Loading />;
  if (!plan) return <Empty glyph="help" title={t("Goal not found.")} />;

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
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const nextResults = plan.nextResults
    .filter((entry) => entry.achievable && !entry.alreadySecured)
    .slice(0, 4);

  const horizons = plan.horizons
    .filter((entry) => entry.achievable && !entry.alreadySecured)
    .slice(0, 3);

  const levers = plan.levers.filter((lever) => lever.leverage > 0.001).slice(0, 5);
  const done = plan.status === "achieved" || plan.status === "secured";
  const settled = plan.goal.achievedAt !== null;

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
              <Sign glyph="settings" size={20} />
            </Pressable>
          ),
        }}
      />
      <Grouped>
        <Section>
          <Column spacing={space.md}>
            <Row spacing={space.sm}>
              <Text size="title">{plan.goal.name}</Text>
              <Spacer flexible />
              <StatusPill status={plan.status} />
            </Row>

            <Row spacing={space.sm} alignment="end">
              <AverageValue ratio={plan.current} size="hero" colored />
              <Text size="callout" tone="faint">
                {`${t("of")} ${formatNumber(plan.target * scale, decimals)}`}
              </Text>
            </Row>

            <ProgressBar
              value={
                plan.current === null || plan.target === 0
                  ? 0
                  : plan.current / plan.target
              }
              done={done}
            />

            {plan.gap !== null && plan.gap > 0 ? (
              <Row spacing={space.xs}>
                <Label>{t("Still to go")}</Label>
                <AverageValue ratio={plan.gap} size="footnote" />
              </Row>
            ) : null}
          </Column>
        </Section>

        {advice.length > 0 ? (
          <Section title={t("How to get there")}>
            {advice.map((item, index) => (
              <Line key={index} leading={item.glyph} title={item.text} />
            ))}
          </Section>
        ) : null}

        {!done && nextResults.length > 0 ? (
          <Section title={t("What your next result has to be")}>
            {nextResults.map((entry) => (
              <Line
                key={entry.subject.id}
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
          </Section>
        ) : null}

        {!done && horizons.length > 0 ? (
          <Section title={t("Or a steady run")}>
            {horizons.map((entry) => (
              <Line
                key={entry.count}
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
          </Section>
        ) : null}

        {levers.length > 0 ? (
          <Section title={t("Where effort pays off most")}>
            {levers.map((lever) => (
              <Line
                key={lever.subject.id}
                title={lever.subject.name}
                detail={t("Worth up to {gain} on this average", {
                  gain: formatNumber(lever.realisticGain * scale, decimals),
                })}
                onPress={() => router.push(`/subject/${lever.subject.id}`)}
                trailing={
                  <AverageValue
                    ratio={lever.currentRatio}
                    size="callout"
                    colored
                  />
                }
              />
            ))}
          </Section>
        ) : null}

        <Section title={t("The range still open")}>
          <Line
            title={t("At worst")}
            trailing={<AverageValue ratio={plan.floor} size="heading" />}
          />
          <Line
            title={t("At best")}
            trailing={<AverageValue ratio={plan.ceiling} size="heading" />}
          />
        </Section>

        <Section>
          <Line
            leading={settled ? "reset" : "achieved"}
            title={settled ? t("Reopen this goal") : t("Mark as reached")}
            onPress={() =>
              markAchieved.mutate({
                goalId: plan.goal.id,
                achieved: !settled,
              })
            }
          />
          <Line
            leading="remove"
            title={t("Delete goal")}
            destructive
            onPress={confirmDelete}
          />
        </Section>

        <Spacer size={space.xl} />
      </Grouped>
    </>
  );
}
