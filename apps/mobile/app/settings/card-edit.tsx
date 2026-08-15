import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  CARD_METRICS,
  FULL_YEAR_PERIOD_ID,
  WIDGET_DEFINITION_VERSION,
  compileWidgetDefinition,
  createWidgetDefinition,
  resolveWidgetFlow,
  type CardMetric,
  type WidgetDefinitionV1,
  type WidgetSurface,
} from "@avermate/core";
import { ChoiceField, TextField } from "@/components/field";
import {
  Button,
  Card,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { useCards } from "@/components/use-cards";
import { useYear } from "@/components/year-provider";
import { WidgetFlowEditor } from "@/components/widgets/widget-flow-editor";
import { useWidgetFlowContext } from "@/components/widgets/use-widget-options";
import { widgetCardTitle } from "@/components/widgets/widget-renderer";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";

function widgetSurface(value: string | undefined): WidgetSurface {
  return value === "subject" || value === "grade" || value === "insights"
    ? value
    : "overview";
}

function initialDefinition(
  surface: WidgetSurface,
  requestedMetric: string | undefined,
): WidgetDefinitionV1 {
  const definition = createWidgetDefinition(surface);
  if (requestedMetric && CARD_METRICS.includes(requestedMetric as CardMetric)) {
    definition.analysis.measure = {
      kind: "metric",
      metric: requestedMetric as CardMetric,
      goalId: null,
    };
  }
  return resolveWidgetFlow(definition, { surface }).prunedDefinition;
}

function AccentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const palette = usePalette();
  const choices = [
    { value: "", label: t("No accent"), color: palette.surface },
    { value: "#2563EB", label: t("Blue"), color: "#2563EB" },
    { value: "#16A34A", label: t("Green"), color: "#16A34A" },
    { value: "#D97706", label: t("Amber"), color: "#D97706" },
    { value: "#DC2626", label: t("Red"), color: "#DC2626" },
    { value: "#7C3AED", label: t("Violet"), color: "#7C3AED" },
    { value: "#0891B2", label: t("Cyan"), color: "#0891B2" },
  ];
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: palette.textFaint }]}>
        {t("Accent color")}
      </Text>
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}
      >
        {choices.map((choice) => {
          const selected = value === choice.value;
          return (
            <Pressable
              key={choice.value || "none"}
              accessibilityRole="radio"
              accessibilityLabel={choice.label}
              accessibilityState={{ selected }}
              onPress={() => onChange(choice.value)}
              style={{ alignItems: "center", gap: space.xs, width: 48 }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: choice.color,
                  borderWidth: selected ? 3 : StyleSheet.hairlineWidth,
                  borderColor: selected ? palette.text : palette.border,
                }}
              >
                {choice.value === "" ? (
                  <View
                    style={{
                      position: "absolute",
                      left: 4,
                      right: 4,
                      top: 17,
                      height: 2,
                      backgroundColor: palette.negative,
                      transform: [{ rotate: "-45deg" }],
                    }}
                  />
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[type.label, { color: palette.textMuted }]}
              >
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function CardEdit() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    metric?: string;
    surface?: string;
  }>();
  const surface = widgetSurface(params.surface);
  const yearState = useYear();
  const widgets = useCards(surface);
  const flowContext = useWidgetFlowContext(surface);
  const existing = widgets.all.find((card) => card.id === params.id);
  const [definition, setDefinition] = useState(() =>
    initialDefinition(surface, params.metric),
  );
  const [title, setTitle] = useState("");
  const [span, setSpan] = useState<1 | 2 | 3 | 4>(
    surface === "insights" ? 4 : 1,
  );
  const [accent, setAccent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    if (!existing || loadedId.current === existing.id) return;
    loadedId.current = existing.id;
    setDefinition(existing.definition);
    setTitle(existing.title ?? "");
    setSpan(existing.span);
    setAccent(existing.accent ?? "");
  }, [existing]);

  const flow = useMemo(
    () => resolveWidgetFlow(definition, flowContext),
    [definition, flowContext],
  );
  const compiled = useMemo(
    () =>
      compileWidgetDefinition(definition, {
        surface,
        references: {
          subjectIds: new Set(yearState.subjects.map((item) => item.id)),
          customAverageIds: new Set(
            yearState.customAverages.map((item) => item.id),
          ),
          goalIds: new Set(yearState.goals.map((item) => item.id)),
          periodIds: new Set(
            yearState.periods
              .filter((item) => item.id !== FULL_YEAR_PERIOD_ID)
              .map((item) => item.id),
          ),
        },
      }),
    [definition, surface, yearState],
  );
  const listKey = orpc.cards.list.queryKey({
    input: { yearId: yearState.yearId ?? "", surface },
  });
  const save = useMutation({
    mutationFn: () => {
      if (!yearState.yearId || !compiled.plan) {
        throw new Error("Invalid widget definition");
      }
      const presentation = {
        span,
        title: title.trim() || null,
        accent: accent.trim() || null,
        hidden: existing?.hidden ?? false,
      };
      return existing
        ? client.cards.update({
            cardId: existing.id,
            definitionVersion: WIDGET_DEFINITION_VERSION,
            definitionJson: compiled.plan.definition,
            ...presentation,
          })
        : client.cards.create({
            yearId: yearState.yearId,
            surface,
            definitionVersion: WIDGET_DEFINITION_VERSION,
            definitionJson: compiled.plan.definition,
            ...presentation,
          });
    },
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries({ queryKey: listKey });
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("That could not be saved."));
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!existing) throw new Error("No widget selected");
      return client.cards.delete({ cardId: existing.id });
    },
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries({ queryKey: listKey });
      router.back();
    },
  });

  if (params.id && widgets.isLoading && !existing) return <Loading />;
  if (params.id && !widgets.isLoading && !existing) {
    return (
      <Screen>
        <Problem>{t("This widget no longer exists.")}</Problem>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{ title: existing ? t("Edit widget") : t("New widget") }}
      />
      <Screen
        footer={
          <Button
            label={t("Save")}
            loading={save.isPending}
            disabled={!compiled.valid || save.isPending}
            onPress={() => save.mutate()}
          />
        }
      >
        <Section>
          <Note>
            {surface === "insights"
              ? t(
                  "This widget belongs to Insights. Its definition and chart stay editable together.",
                )
              : t(
                  "This widget belongs to the Dashboard. Its definition and chart stay editable together.",
                )}
          </Note>
        </Section>

        <WidgetFlowEditor
          definition={definition}
          surface={surface}
          onChange={setDefinition}
        />

        <Section title={t("Card")}>
          <TextField
            label={t("Title")}
            value={title}
            onChangeText={setTitle}
            placeholder={widgetCardTitle({ title: null, definition })}
            maxLength={48}
          />
          <ChoiceField
            label={t("Width")}
            value={String(span)}
            onChange={(value) => setSpan(Number(value) as 1 | 2 | 3 | 4)}
            columns={2}
            choices={[
              { value: "1", label: t("Compact") },
              { value: "2", label: t("Half") },
              { value: "3", label: t("Wide") },
              { value: "4", label: t("Full") },
            ]}
          />
          <AccentPicker value={accent} onChange={setAccent} />
        </Section>

        {!compiled.valid ? (
          <Section>
            <Problem>
              {t("Complete the highlighted widget fields before saving.")}
            </Problem>
          </Section>
        ) : null}
        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
        {existing ? (
          <Section>
            <Card padded={false}>
              <Row
                title={t("Delete this widget")}
                destructive
                onPress={() =>
                  Alert.alert(
                    t("Delete this widget?"),
                    t("This cannot be undone."),
                    [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("Delete"),
                        style: "destructive",
                        onPress: () => remove.mutate(),
                      },
                    ],
                  )
                }
              />
            </Card>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
