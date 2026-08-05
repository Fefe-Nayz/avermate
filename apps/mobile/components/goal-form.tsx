import { useMemo, useState, type ReactNode } from "react";
import { Spacer } from "@expo/ui";
import type { Goal } from "@avermate/core";
import { FULL_YEAR_PERIOD_ID } from "@avermate/core";
import { Button, Grouped, Row, Section, Text } from "@/components/native";
import {
  ChoiceField,
  DateField,
  PickerField,
  SliderField,
  SwitchField,
  TextField,
  type Choice,
} from "@/components/controls";
import { AverageValue } from "@/components/value";
import { formatNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * Setting a goal.
 *
 * The target is a slider rather than a text field because picking a target is
 * a judgement, not a measurement — you drag until it feels right, and the
 * number above your thumb tells you what you just asked of yourself. Typing
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
  extra?: ReactNode;
}) {
  const { graph, yearGraph, customAverages, periods, scale, decimals, year } =
    useYear();
  const [touched, setTouched] = useState(false);

  const subjectChoices = useMemo<Choice[]>(() => {
    const walk = (nodes: readonly { id: string; name: string; sortOrder: number }[], depth: number): Choice[] =>
      [...nodes]
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
      periodId: draft.periodId === FULL_YEAR_PERIOD_ID ? null : draft.periodId,
      dueAt: draft.dueAt,
      isPinned: draft.isPinned,
    });
  };

  return (
    <Grouped footer={<Button label={submitLabel} onPress={submit} disabled={busy} />}>
      <Section>
        <TextField
          label={t("Name")}
          value={draft.name}
          onChangeText={(name) => patch({ name })}
          placeholder={t("Pass the year, get honours, 14 in maths…")}
          error={touched ? (nameProblem ?? undefined) : undefined}
          autoFocus
        />
      </Section>

      <ChoiceField
        title={t("What is it about?")}
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

      {draft.kind !== "general" ? (
        <Section>
          <PickerField
            label={draft.kind === "subject" ? t("Subject") : t("Custom average")}
            choices={
              draft.kind === "subject"
                ? subjectChoices
                : customAverages.map((average) => ({
                    value: average.id,
                    label: average.name,
                  }))
            }
            value={draft.referenceId}
            onChange={(referenceId) => patch({ referenceId })}
            error={touched ? (referenceProblem ?? undefined) : undefined}
          />
        </Section>
      ) : null}

      <Section title={t("Target")}>
        <SliderField
          label={t("Target")}
          value={draft.target}
          onValueChange={(target) => patch({ target })}
          min={0}
          max={scale}
          step={scale >= 20 ? 0.25 : 0.05}
          display={(value) =>
            `${formatNumber(value, decimals > 0 ? 1 : 0)} / ${formatNumber(scale)}`
          }
        />
        {current !== null ? (
          <Row spacing={space.xs}>
            <Text size="footnote" tone="muted">
              {t("now")}
            </Text>
            <AverageValue ratio={current} size="footnote" />
          </Row>
        ) : null}
      </Section>

      <Section title={t("When")}>
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
            patch({ dueAt: on ? (year ? new Date(year.endsAt) : new Date()) : null })
          }
        />
        {draft.dueAt ? (
          <DateField
            label={t("By")}
            value={draft.dueAt}
            onChange={(dueAt) => patch({ dueAt })}
          />
        ) : null}
        <SwitchField
          label={t("Show on the dashboard")}
          detail={t("A goal you cannot see is a goal you forget.")}
          value={draft.isPinned}
          onValueChange={(isPinned) => patch({ isPinned })}
        />
      </Section>

      {error ? (
        <Section>
          <Text size="footnote" tone="negative">
            {error}
          </Text>
        </Section>
      ) : null}

      {extra}
      <Spacer size={space.xl} />
    </Grouped>
  );
}
