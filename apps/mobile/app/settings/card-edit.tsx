import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  CARD_METRICS,
  allowedDisplays,
  type CardDisplay,
  type CardMetric,
  type Subject,
} from "@avermate/core";
import {
  Button,
  Card,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { ChoiceField, PickerField, TextField, type Choice } from "@/components/field";
import { metricHint, metricLabel, useCards } from "@/components/use-cards";
import { widgetCatalogEntry } from "@/components/widget-catalog";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

/**
 * One card, configured.
 *
 * The order of the questions is the order they constrain each other: the
 * metric decides which displays make sense, and only some metrics can point at
 * a single subject. Offering a nonsense combination and then rejecting it
 * would be worse than not offering it.
 */
export default function CardEdit() {
  const router = useRouter();
  const { id, metric: requestedMetric } = useLocalSearchParams<{
    id?: string;
    metric?: string;
  }>();
  const { yearId, yearGraph, customAverages, goals } = useYear();
  const { specs, hidden } = useCards("overview");

  const existing = [...specs, ...hidden].find((spec) => spec.id === id);

  const initialMetric: CardMetric =
    requestedMetric && CARD_METRICS.includes(requestedMetric as CardMetric)
      ? (requestedMetric as CardMetric)
      : "average";
  const recommendation = widgetCatalogEntry(initialMetric);
  const [metric, setMetric] = useState<CardMetric>(
    existing?.metric ?? initialMetric,
  );
  const [display, setDisplay] = useState<CardDisplay>(
    existing?.display ?? recommendation.recommendedDisplay,
  );
  const [targetKind, setTargetKind] = useState(existing?.target.kind ?? "general");
  const [referenceId, setReferenceId] = useState<string | null>(
    existing?.target.referenceId ?? null,
  );
  const [goalId, setGoalId] = useState<string | null>(existing?.goalId ?? null);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [span, setSpan] = useState<1 | 2 | 3 | 4>(
    existing?.span ?? recommendation.recommendedSpan,
  );
  const [error, setError] = useState<string | null>(null);

  const displays = useMemo(() => allowedDisplays(metric), [metric]);
  const effectiveDisplay = displays.includes(display)
    ? display
    : (displays[0] ?? "value");

  const subjectChoices = useMemo<Choice[]>(() => {
    const walk = (nodes: readonly Subject[], depth: number): Choice[] =>
      [...nodes]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .flatMap((subject) => [
          { value: subject.id, label: subject.name, depth },
          ...walk(yearGraph.childrenOf(subject.id), depth + 1),
        ]);
    return walk(yearGraph.roots, 0);
  }, [yearGraph]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        surface: "overview" as const,
        metric,
        targetKind: targetKind as "general" | "subject" | "custom",
        targetId: targetKind === "general" ? null : referenceId,
        goalId: metric === "goalProgress" ? goalId : null,
        display: effectiveDisplay,
        span,
        title: title.trim() || null,
        accent: null,
        hidden: false,
      };
      return existing
        ? client.cards.update({ cardId: existing.id, ...payload })
        : client.cards.create({ yearId: yearId ?? "", ...payload });
    },
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("That could not be saved."));
    },
  });

  const remove = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.delete>[0]) =>
      client.cards.delete(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.back();
    },
  });

  const needsGoal = metric === "goalProgress";
  const ready =
    (targetKind === "general" || referenceId !== null) &&
    (!needsGoal || goalId !== null);

  return (
    <>
      <Stack.Screen
        options={{ title: existing ? t("Edit card") : t("New card") }}
      />
      <Screen
        footer={
          <Button
            label={t("Save")}
            onPress={() => save.mutate()}
            disabled={!ready || save.isPending}
          />
        }
      >
        <Section title={t("What it measures")}>
          <PickerField
            label={t("Metric")}
            value={metric}
            onChange={(next) => setMetric(next as CardMetric)}
            choices={CARD_METRICS.map((item) => ({
              value: item,
              label: metricLabel(item),
            }))}
          />
          {metricHint(metric) ? (
            <Note>{metricHint(metric) ?? ""}</Note>
          ) : null}
        </Section>

        <Section title={t("What it looks at")}>
          <PickerField
            label={t("Scope")}
            value={targetKind}
            onChange={(next) => {
              setTargetKind(next as "general" | "subject" | "custom");
              setReferenceId(null);
            }}
            choices={[
              { value: "general", label: t("The whole year") },
              { value: "subject", label: t("One subject") },
              ...(customAverages.length > 0
                ? [{ value: "custom", label: t("A custom average") }]
                : []),
            ]}
          />
          {targetKind === "subject" ? (
            <PickerField
              label={t("Subject")}
              value={referenceId}
              onChange={setReferenceId}
              choices={subjectChoices}
            />
          ) : null}
          {targetKind === "custom" ? (
            <PickerField
              label={t("Custom average")}
              value={referenceId}
              onChange={setReferenceId}
              choices={customAverages.map((average) => ({
                value: average.id,
                label: average.name,
              }))}
            />
          ) : null}
          {needsGoal ? (
            <PickerField
              label={t("Goal")}
              value={goalId}
              onChange={setGoalId}
              choices={goals.map((goal) => ({
                value: goal.id,
                label: goal.name,
              }))}
            />
          ) : null}
        </Section>

        {displays.length > 1 ? (
          <Section title={t("How it looks")}>
            <PickerField
              label={t("Display")}
              value={effectiveDisplay}
              onChange={(next) => setDisplay(next as CardDisplay)}
              choices={displays.map((item) => ({
                value: item,
                label: displayLabel(item),
              }))}
            />
          </Section>
        ) : null}

        <Section title={t("Width")}>
          <ChoiceField
            value={String(span)}
            onChange={(value) => setSpan(Number(value) as 1 | 2 | 3 | 4)}
            columns={2}
            choices={[
              { value: "1", label: t("Quarter") },
              { value: "2", label: t("Half") },
              { value: "4", label: t("Full") },
            ]}
          />
        </Section>

        <Section title={t("Title")}>
          <TextField
            label={t("Title")}
            value={title}
            onChangeText={setTitle}
            placeholder={metricLabel(metric)}
          />
          <Note>{t("Leave it empty to use the metric's own name.")}</Note>
        </Section>

        {existing ? (
          <Section>
          <Card padded={false}>
              <Row
                title={t("Delete this card")}
                destructive
                onPress={() =>
                  Alert.alert(t("Delete this card?"), t("This cannot be undone."), [
                    { text: t("Cancel"), style: "cancel" },
                    {
                      text: t("Delete"),
                      style: "destructive",
                      onPress: () => remove.mutate({ cardId: existing.id }),
                    },
                  ])
                }
              />
          </Card>
        </Section>
        ) : null}

        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}

function displayLabel(display: CardDisplay): string {
  switch (display) {
    case "value":
      return t("Just the number");
    case "sparkline":
      return t("Number and a line");
    case "chart":
      return t("A chart");
    case "list":
      return t("A list");
    case "gauge":
      return t("A bar");
  }
}
