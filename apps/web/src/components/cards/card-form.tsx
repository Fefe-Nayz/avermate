"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useExtracted } from "next-intl";
import { toast } from "sonner";
import {
  CARD_METRICS,
  allowedDisplays,
  type CardDisplay,
  type CardMetric,
  type CardSpec,
} from "@avermate/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormPage } from "@/components/forms/form-page";
import { ChoiceField, FormSection, TextField } from "@/components/forms/controls";
import { PickerField, type PickerOption } from "@/components/forms/picker";
import { CardBody, useCardResult, useMetricLabels } from "./card-view";
import { useYear } from "@/components/year/year-provider";
import { orpc } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";

export interface CardFormValues {
  id?: string;
  metric: CardMetric;
  targetKind: "general" | "subject" | "custom";
  targetId: string | null;
  goalId: string | null;
  display: CardDisplay;
  span: 1 | 2 | 3 | 4;
  title: string;
}

/**
 * The card editor.
 *
 * A live preview sits above the controls, because a metric name is not enough
 * to picture what a card will look like — and because the whole point of a
 * customisable dashboard is that the choice is visual.
 */
export function CardForm({
  initial,
  mode,
}: {
  initial?: Partial<CardFormValues>;
  mode: "create" | "edit";
}) {
  const t = useExtracted();
  const labels = useMetricLabels();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { graph, customAverages, goals, yearId } = useYear();

  const [metric, setMetric] = useState<CardMetric>(initial?.metric ?? "average");
  const [targetKind, setTargetKind] = useState<CardFormValues["targetKind"]>(
    initial?.targetKind ?? "general",
  );
  const [targetId, setTargetId] = useState<string | null>(
    initial?.targetId ?? null,
  );
  const [goalId, setGoalId] = useState<string | null>(initial?.goalId ?? null);
  const [display, setDisplay] = useState<CardDisplay>(
    initial?.display ?? "value",
  );
  const [span, setSpan] = useState<CardFormValues["span"]>(initial?.span ?? 1);
  const [title, setTitle] = useState(initial?.title ?? "");

  const displays = allowedDisplays(metric);
  const effectiveDisplay = displays.includes(display)
    ? display
    : ((displays[0] ?? "value") as CardDisplay);

  const spec: CardSpec = useMemo(
    () => ({
      id: initial?.id ?? "__preview__",
      metric,
      target: { kind: targetKind, referenceId: targetId },
      display: effectiveDisplay,
      span,
      title: title.trim() || null,
      accent: null,
      goalId,
      sortOrder: 0,
      hidden: false,
    }),
    [initial?.id, metric, targetKind, targetId, effectiveDisplay, span, title, goalId],
  );

  const preview = useCardResult(spec);

  const subjectOptions: PickerOption[] = useMemo(
    () =>
      graph.flatten().map((subject) => ({
        value: subject.id,
        label: subject.name,
        depth: graph.depthOf(subject.id),
      })),
    [graph],
  );

  const onSaved = {
    onSuccess: () => {
      haptic("success");
      toast.success(mode === "create" ? t("Card added") : t("Card updated"));
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({ input: { yearId: yearId ?? "" } }),
      });
      router.push("/dashboard");
    },
    onError: (error: Error) => {
      haptic("error");
      toast.error(error.message || t("The card could not be saved."));
    },
  };

  const create = useMutation({ ...orpc.cards.create.mutationOptions(), ...onSaved });
  const update = useMutation({ ...orpc.cards.update.mutationOptions(), ...onSaved });
  const remove = useMutation({
    ...orpc.cards.delete.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({ input: { yearId: yearId ?? "" } }),
      });
      router.push("/dashboard");
    },
  });

  const submit = () => {
    const payload = {
      surface: "overview" as const,
      metric,
      targetKind,
      targetId: targetKind === "general" ? null : targetId,
      goalId: metric === "goalProgress" ? goalId : null,
      display: effectiveDisplay,
      span,
      title: title.trim() || null,
      accent: null,
      hidden: false,
    };

    if (mode === "create") {
      create.mutate({ yearId: yearId as string, ...payload });
    } else {
      update.mutate({ cardId: initial?.id as string, ...payload });
    }
  };

  const displayLabels: Record<CardDisplay, string> = {
    value: t("Just the number"),
    sparkline: t("Number with a mini chart"),
    chart: t("Full chart"),
    list: t("List"),
    gauge: t("Progress bar"),
  };

  return (
    <FormPage
      title={mode === "create" ? t("New card") : t("Edit card")}
      backHref="/dashboard"
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Add to dashboard") : t("Save changes")}
      submitting={create.isPending || update.isPending}
      destructive={
        mode === "edit" && initial?.id
          ? {
              label: t("Remove"),
              onClick: () => remove.mutate({ cardId: initial.id as string }),
            }
          : undefined
      }
    >
      <FormSection title={t("Preview")}>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {spec.title ?? labels[metric]}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <CardBody spec={spec} result={preview} />
          </CardContent>
        </Card>
      </FormSection>

      <FormSection title={t("What it shows")}>
        <PickerField
          label={t("Metric")}
          options={CARD_METRICS.map((item) => ({
            value: item,
            label: labels[item],
          }))}
          value={metric}
          onValueChange={(value) => setMetric(value as CardMetric)}
        />

        <ChoiceField
          label={t("Measured over")}
          choices={[
            { value: "general", label: t("The whole year") },
            { value: "subject", label: t("One subject") },
            ...(customAverages.length > 0
              ? [{ value: "custom" as const, label: t("A custom average") }]
              : []),
          ]}
          value={targetKind}
          onValueChange={(value) => {
            setTargetKind(value);
            setTargetId(null);
          }}
        />

        {targetKind === "subject" ? (
          <PickerField
            label={t("Subject")}
            options={subjectOptions}
            value={targetId}
            onValueChange={setTargetId}
          />
        ) : null}

        {targetKind === "custom" ? (
          <PickerField
            label={t("Custom average")}
            options={customAverages.map((average) => ({
              value: average.id,
              label: average.name,
            }))}
            value={targetId}
            onValueChange={setTargetId}
          />
        ) : null}

        {metric === "goalProgress" ? (
          <PickerField
            label={t("Goal")}
            options={goals.map((goal) => ({
              value: goal.id,
              label: goal.name,
            }))}
            value={goalId}
            onValueChange={setGoalId}
            emptyHint={t("Create a goal first.")}
          />
        ) : null}
      </FormSection>

      <FormSection title={t("How it looks")}>
        {displays.length > 1 ? (
          <ChoiceField
            label={t("Style")}
            choices={displays.map((item) => ({
              value: item,
              label: displayLabels[item],
            }))}
            value={effectiveDisplay}
            onValueChange={setDisplay}
          />
        ) : null}

        <ChoiceField
          label={t("Width")}
          choices={[
            { value: "1", label: t("Quarter") },
            { value: "2", label: t("Half") },
            { value: "4", label: t("Full") },
          ]}
          value={String(span)}
          onValueChange={(value) =>
            setSpan(Number.parseInt(value, 10) as CardFormValues["span"])
          }
          columns={3}
        />

        <TextField
          label={t("Title")}
          description={t("Leave blank to use the metric's own name.")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={48}
          placeholder={labels[metric]}
        />
      </FormSection>
    </FormPage>
  );
}
