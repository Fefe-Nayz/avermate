import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import type { Goal } from "@avermate/core";
import { Button, Card, Label, Screen } from "@/components/ui";
import { NativeSlider, NativeSwitch } from "@/components/native-controls";
import { AverageValue } from "@/components/value";
import {
  ChoiceField,
  FieldGroup,
  PickerField,
  SwitchField,
  TextField,
  type Choice,
} from "@/components/field";
import { DateField } from "@/components/date-field";
import { FULL_YEAR_PERIOD_ID } from "@avermate/core";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { numeric, space, type, usePalette } from "@/lib/theme";

/**
 * Setting a goal.
 *
 * The target is a slider rather than a text field because picking a target is
 * a judgement, not a measurement — you drag until it feels right, and the
 * number under your thumb tells you what you just asked of yourself. Typing
 * "13.72" as a target is a thing nobody has ever meant to do.
 */

export interface GoalDraft {
  name: string;
  kind: "general" | "subject" | "custom";
  referenceId: string | null;
  target: number;
  periodId: string | null;
  dueAt: Date | null;
  isPinned: boolean;
}

export interface GoalPayload {
  name: string;
  kind: "general" | "subject" | "custom";
  referenceId: string | null;
  targetRatio: number;
  periodId: string | null;
  dueAt: Date | null;
  isPinned: boolean;
}

export function emptyGoalDraft(scale: number, current: number | null): GoalDraft {
  // Half a point above where you already are: an opening bid, not a fantasy.
  const suggested =
    current === null
      ? scale * 0.7
      : Math.min(scale, Math.round((current * scale + 0.5) * 4) / 4);

  return {
    name: "",
    kind: "general",
    referenceId: null,
    target: suggested,
    periodId: null,
    dueAt: null,
    isPinned: true,
  };
}

export function goalDraftOf(goal: Goal, scale: number): GoalDraft {
  return {
    name: goal.name,
    kind: goal.kind,
    referenceId: goal.referenceId,
    target: goal.targetRatio * scale,
    periodId: goal.periodId,
    dueAt: goal.dueAt ? new Date(goal.dueAt) : null,
    isPinned: goal.isPinned ?? false,
  };
}

export function GoalForm({
  draft,
  onChange,
  onSubmit,
  submitLabel,
  busy,
  error,
  extra,
}: {
  draft: GoalDraft;
  onChange: (draft: GoalDraft) => void;
  onSubmit: (payload: GoalPayload) => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  extra?: React.ReactNode;
}) {
  const palette = usePalette();
  const { graph, yearGraph, customAverages, periods, scale, decimals, year } =
    useYear();
  const [touched, setTouched] = useState(false);

  const subjectChoices = useMemo<Choice[]>(() => {
    const walk = (ids: readonly { id: string; name: string; sortOrder: number }[], depth: number): Choice[] =>
      [...ids]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .flatMap((subject) => [
          { value: subject.id, label: subject.name, depth },
          ...walk(yearGraph.childrenOf(subject.id), depth + 1),
        ]);
    return walk(yearGraph.roots, 0);
  }, [yearGraph]);

  const periodChoices = useMemo<Choice[]>(
    () => [
      { value: FULL_YEAR_PERIOD_ID, label: t("The whole year") },
      ...periods
        .filter((period) => period.id !== FULL_YEAR_PERIOD_ID)
        .map((period) => ({ value: period.id, label: period.name })),
    ],
    [periods],
  );

  const patch = (values: Partial<GoalDraft>) =>
    onChange({ ...draft, ...values });

  const nameProblem =
    draft.name.trim().length === 0 ? t("Give this goal a name.") : null;
  const referenceProblem =
    draft.kind !== "general" && !draft.referenceId
      ? t("Pick what this goal is about.")
      : null;

  // Where the tracked average stands right now, so the slider has a reference.
  const current = useMemo(() => {
    if (draft.kind === "general") return graph.ratio(null);
    if (draft.kind === "subject") {
      return draft.referenceId && graph.has(draft.referenceId)
        ? graph.ratio(draft.referenceId)
        : null;
    }
    return null;
  }, [draft.kind, draft.referenceId, graph]);

  const submit = () => {
    setTouched(true);
    if (nameProblem || referenceProblem) {
      haptic("error");
      return;
    }
    onSubmit({
      name: draft.name.trim(),
      kind: draft.kind,
      referenceId: draft.kind === "general" ? null : draft.referenceId,
      targetRatio: Math.min(1, Math.max(0, draft.target / scale)),
      periodId:
        draft.periodId === FULL_YEAR_PERIOD_ID ? null : draft.periodId,
      dueAt: draft.dueAt,
      isPinned: draft.isPinned,
    });
  };

  const show = (value: number) =>
    value.toLocaleString(locale() === "fr" ? "fr-FR" : "en-GB", {
      minimumFractionDigits: decimals > 0 ? 1 : 0,
      maximumFractionDigits: 2,
    });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen
        footer={<Button label={submitLabel} onPress={submit} loading={busy} />}
      >
        <FieldGroup>
          <TextField
            label={t("Name")}
            value={draft.name}
            onChangeText={(name) => patch({ name })}
            placeholder={t("Pass the year, get honours, 14 in maths…")}
            error={touched ? (nameProblem ?? undefined) : undefined}
            autoFocus
          />

          <ChoiceField
            label={t("What is it about?")}
            value={draft.kind}
            onChange={(kind) =>
              patch({ kind: kind as GoalDraft["kind"], referenceId: null })
            }
            choices={[
              { value: "general", label: t("The whole year") },
              { value: "subject", label: t("One subject") },
              ...(customAverages.length > 0
                ? [{ value: "custom", label: t("A custom average") }]
                : []),
            ]}
          />

          {draft.kind === "subject" ? (
            <PickerField
              label={t("Subject")}
              choices={subjectChoices}
              value={draft.referenceId}
              onChange={(referenceId) => patch({ referenceId })}
              placeholder={t("Choose a subject")}
              error={touched ? (referenceProblem ?? undefined) : undefined}
            />
          ) : null}

          {draft.kind === "custom" ? (
            <PickerField
              label={t("Custom average")}
              choices={customAverages.map((average) => ({
                value: average.id,
                label: average.name,
              }))}
              value={draft.referenceId}
              onChange={(referenceId) => patch({ referenceId })}
              error={touched ? (referenceProblem ?? undefined) : undefined}
            />
          ) : null}

          <Card>
            <View style={{ gap: space.md }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                }}
              >
                <Label>{t("Target")}</Label>
                <View
                  style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}
                >
                  <Text style={[type.display, numeric, { color: palette.text }]}>
                    {show(draft.target)}
                  </Text>
                  <Text
                    style={[type.callout, numeric, { color: palette.textFaint }]}
                  >
                    /{show(scale)}
                  </Text>
                </View>
              </View>

              <NativeSlider
                value={draft.target}
                onValueChange={(target) => patch({ target })}
                min={0}
                max={scale}
                step={scale >= 20 ? 0.25 : 0.05}
              />

              {current !== null ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.xs,
                  }}
                >
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {t("now")}
                  </Text>
                  <AverageValue ratio={current} size="footnote" />
                </View>
              ) : null}
            </View>
          </Card>

          {periodChoices.length > 1 ? (
            <PickerField
              label={t("Period")}
              choices={periodChoices}
              value={draft.periodId ?? FULL_YEAR_PERIOD_ID}
              onChange={(periodId) => patch({ periodId })}
            />
          ) : null}

          <SwitchField
            label={t("Give it a deadline")}
            value={draft.dueAt !== null}
            onValueChange={(on) =>
              patch({
                dueAt: on ? (year ? new Date(year.endsAt) : new Date()) : null,
              })
            }
          />

          {draft.dueAt ? (
            <DateField
              label={t("By")}
              value={draft.dueAt}
              onChange={(dueAt) => patch({ dueAt })}
            />
          ) : null}

          <Card>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Label>{t("Show on the dashboard")}</Label>
                <Text style={[type.footnote, { color: palette.textMuted }]}>
                  {t("A goal you cannot see is a goal you forget.")}
                </Text>
              </View>
              <NativeSwitch
                value={draft.isPinned}
                onValueChange={(isPinned) => patch({ isPinned })}
              />
            </View>
          </Card>
        </FieldGroup>

        {error ? (
          <Text style={[type.footnote, { color: palette.negative }]}>
            {error}
          </Text>
        ) : null}

        {extra}
      </Screen>
    </KeyboardAvoidingView>
  );
}
