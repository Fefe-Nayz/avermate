"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  CARD_METRICS,
  allowedDisplays,
  availableSpans,
  cardColumns,
  spanForColumns,
  type CardDisplay,
  type CardMetric,
  type CardSpec,
} from "@avermate/core"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { ChoiceField, TextField } from "@/components/forms/controls"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { CARD_ACCENTS, cardAccent } from "./card-accent"
import { CardBody, useCardResult, useMetricLabels } from "./card-view"
import { useYear } from "@/components/year/year-provider"
import { useMediaQuery } from "@/hooks/use-media-query"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/** Spelled out because Tailwind reads class names, not expressions. */
const PREVIEW_SPAN: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
}

export interface CardFormValues {
  id?: string
  metric: CardMetric
  targetKind: "general" | "subject" | "custom"
  targetId: string | null
  goalId: string | null
  display: CardDisplay
  span: 1 | 2 | 3 | 4
  title: string
  /** A named theme accent, or `null` for the default uncoloured card. */
  accent: string | null
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
  initial?: Partial<CardFormValues>
  mode: "create" | "edit"
}) {
  const t = useExtracted()
  const labels = useMetricLabels()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, customAverages, goals, yearId } = useYear()

  const [metric, setMetric] = useState<CardMetric>(initial?.metric ?? "average")
  const [targetKind, setTargetKind] = useState<CardFormValues["targetKind"]>(
    initial?.targetKind ?? "general"
  )
  const [targetId, setTargetId] = useState<string | null>(
    initial?.targetId ?? null
  )
  const [goalId, setGoalId] = useState<string | null>(initial?.goalId ?? null)
  const [display, setDisplay] = useState<CardDisplay>(
    initial?.display ?? "value"
  )
  const [span, setSpan] = useState<CardFormValues["span"]>(initial?.span ?? 1)
  const [title, setTitle] = useState(initial?.title ?? "")
  const [accent, setAccent] = useState<string | null>(initial?.accent ?? null)

  const displays = allowedDisplays(metric)
  const effectiveDisplay = displays.includes(display)
    ? display
    : ((displays[0] ?? "value") as CardDisplay)

  // The editor speaks the grid of the screen it is running on. The dashboard
  // gains a column as it gains width, and these two queries are where — with
  // room left for the sidebar the dashboard has and this page's column does
  // not. One stored width sits underneath, so choosing "half" is the same
  // decision everywhere; only its name and its drawing change.
  const roomForFour = useMediaQuery("(min-width: 1200px)")
  const roomForThree = useMediaQuery("(min-width: 900px)")
  const columns = roomForFour ? 4 : roomForThree ? 3 : 2
  const shape = { display: effectiveDisplay, metric }
  const widths = availableSpans(shape, columns)
  const drawn = cardColumns({ ...shape, span }, columns)
  const rowRemainder = columns - drawn
  const accentBar = cardAccent(accent)

  const spec: CardSpec = useMemo(() => {
    const validDisplays = allowedDisplays(metric)
    const resolvedDisplay = validDisplays.includes(display)
      ? display
      : ((validDisplays[0] ?? "value") as CardDisplay)

    return {
      id: initial?.id ?? "__preview__",
      metric,
      target: { kind: targetKind, referenceId: targetId },
      display: resolvedDisplay,
      span,
      title: title.trim() || null,
      accent,
      goalId,
      sortOrder: 0,
      hidden: false,
    }
  }, [
    initial?.id,
    metric,
    targetKind,
    targetId,
    display,
    span,
    title,
    accent,
    goalId,
  ])

  const preview = useCardResult(spec)

  const subjectOptions: PickerOption[] = useMemo(
    () =>
      graph.flatten().map((subject) => ({
        value: subject.id,
        label: subject.name,
        depth: graph.depthOf(subject.id),
      })),
    [graph]
  )

  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(mode === "create" ? t("Card added") : t("Card updated"))
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.push("/dashboard")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The card could not be saved."))
    },
  }

  const create = useMutation({
    ...orpc.cards.create.mutationOptions(),
    ...onSaved,
  })
  const update = useMutation({
    ...orpc.cards.update.mutationOptions(),
    ...onSaved,
  })
  const remove = useMutation({
    ...orpc.cards.delete.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.push("/dashboard")
    },
  })

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
      accent,
      hidden: false,
    }

    if (mode === "create") {
      create.mutate({ yearId: yearId as string, ...payload })
    } else {
      update.mutate({ cardId: initial?.id as string, ...payload })
    }
  }

  const displayLabels: Record<CardDisplay, string> = {
    value: t("Just the number"),
    sparkline: t("Number with a mini chart"),
    chart: t("Full chart"),
    list: t("List"),
    gauge: t("Progress bar"),
  }

  /** Widths are named as fractions of a row, so the name travels between grids. */
  const widthLabels: Record<string, string> = {
    "1/2": t("Half"),
    "2/2": t("Full"),
    "1/3": t("A third"),
    "2/3": t("Two thirds"),
    "3/3": t("Full"),
    "1/4": t("Quarter"),
    "2/4": t("Half"),
    "3/4": t("Three quarters"),
    "4/4": t("Full"),
  }

  /* Drawn inside this device's own grid, at the share of the row it will
     really take, so the preview is the dashboard in miniature rather than a
     card floating on its own. It stays on screen through every step, because
     every step changes what it looks like. */
  const previewGrid = (
    <div
      className={cn(
        "grid gap-3",
        columns === 4
          ? "grid-cols-4"
          : columns === 3
            ? "grid-cols-3"
            : "grid-cols-2"
      )}
    >
      <Card
        className={cn("relative gap-2 overflow-hidden py-4", PREVIEW_SPAN[drawn])}
      >
        {accentBar ? (
          <span
            aria-hidden
            className={cn("absolute inset-x-0 top-0 h-0.5", accentBar.bar)}
          />
        ) : null}
        <CardHeader className="px-4">
          <CardTitle
            className={cn(
              "line-clamp-2 text-xs leading-tight font-medium tracking-wide uppercase",
              accentBar ? accentBar.text : "text-muted-foreground"
            )}
          >
            {spec.title ?? labels[metric]}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <CardBody spec={spec} result={preview} />
        </CardContent>
      </Card>
      {rowRemainder > 0 ? (
        <div
          aria-hidden
          className={cn(
            "rounded-xl border border-dashed",
            PREVIEW_SPAN[rowRemainder]
          )}
        />
      ) : null}
    </div>
  )

  const targetSummary =
    targetKind === "general"
      ? t("The whole year")
      : targetKind === "subject"
        ? (subjectOptions.find((option) => option.value === targetId)?.label ??
          null)
        : (customAverages.find((average) => average.id === targetId)?.name ??
          null)

  const steps: FlowStep[] = [
    {
      id: "metric",
      title: t("What should it show?"),
      summary: labels[metric],
      content: (
        <PickerField
          layout="page"
          label={t("Metric")}
          options={CARD_METRICS.map((item) => ({
            value: item,
            label: labels[item],
          }))}
          value={metric}
          onValueChange={(value) => setMetric(value as CardMetric)}
        />
      ),
    },
    {
      id: "target",
      title: t("Measured over what?"),
      summary: targetSummary,
      content: (
        <div className="flex flex-col gap-4">
          <ChoiceField
            choices={[
              { value: "general", label: t("The whole year") },
              { value: "subject", label: t("One subject") },
              ...(customAverages.length > 0
                ? [{ value: "custom" as const, label: t("A custom average") }]
                : []),
            ]}
            value={targetKind}
            onValueChange={(value) => {
              setTargetKind(value)
              setTargetId(null)
            }}
          />

          {targetKind === "subject" ? (
            <PickerField
              layout="page"
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
        </div>
      ),
    },
    {
      id: "look",
      title: t("How should it look?"),
      summary: [
        displays.length > 1 ? displayLabels[effectiveDisplay] : null,
        widthLabels[`${drawn}/${columns}`],
      ]
        .filter(Boolean)
        .join(" · "),
      content: (
        <div className="flex flex-col gap-4">
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

          {widths.length > 1 ? (
            <ChoiceField
              label={t("Width")}
              description={
                columns > 2
                  ? t(
                      "On a narrower screen this becomes the nearest width that fits."
                    )
                  : t(
                      "On a wider screen this becomes the nearest width that fits."
                    )
              }
              choices={widths.map((width) => ({
                value: String(width.columns),
                label: widthLabels[`${width.columns}/${columns}`] ?? t("Full"),
              }))}
              value={String(drawn)}
              onValueChange={(value) =>
                setSpan(
                  spanForColumns(span, Number.parseInt(value, 10), shape, columns)
                )
              }
              columns={widths.length > 2 ? 4 : 2}
            />
          ) : null}

          <AccentField value={accent} onValueChange={setAccent} />
        </div>
      ),
    },
    {
      id: "title",
      title: t("Anything to call it?"),
      description: t("Optional. The metric's own name is used otherwise."),
      summary: title.trim() || labels[metric],
      content: (
        <TextField
          label={t("Title")}
          description={t("Leave blank to use the metric's own name.")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={48}
          placeholder={labels[metric]}
        />
      ),
    },
  ]

  return (
    <FormFlow
      title={mode === "create" ? t("New card") : t("Edit card")}
      backHref="/dashboard"
      steps={steps}
      aside={previewGrid}
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
    />
  )
}

/**
 * Choosing a card's accent.
 *
 * Swatches rather than a dropdown: six colours are quicker to compare side by
 * side than to page through, and the choice is entirely visual. "None" is the
 * first option and the default, because a dashboard where every card shouts is
 * a dashboard where nothing does.
 */
function AccentField({
  value,
  onValueChange,
}: {
  value: string | null
  onValueChange: (value: string | null) => void
}) {
  const t = useExtracted()

  const labels: Record<string, string> = {
    Accent: t("Accent"),
    Green: t("Green"),
    Teal: t("Teal"),
    Blue: t("Blue"),
    Purple: t("Purple"),
    Amber: t("Amber"),
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t("Colour")}</span>
      <div
        role="radiogroup"
        aria-label={t("Colour")}
        className="flex flex-wrap gap-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label={t("No colour")}
          onClick={() => onValueChange(null)}
          className={cn(
            "flex size-9 items-center justify-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === null ? "border-foreground" : "border-transparent"
          )}
        >
          <span className="size-6 rounded-full border border-dashed" />
        </button>

        {CARD_ACCENTS.map((accent) => (
          <button
            key={accent.value}
            type="button"
            role="radio"
            aria-checked={value === accent.value}
            aria-label={labels[accent.label] ?? accent.label}
            onClick={() => onValueChange(accent.value)}
            className={cn(
              "flex size-9 items-center justify-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              value === accent.value ? "border-foreground" : "border-transparent"
            )}
          >
            <span className={cn("size-6 rounded-full", accent.swatch)} />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {cardAccent(value)
          ? t("A hairline on the card and its title take this colour.")
          : t("Cards are uncoloured unless you choose one.")}
      </p>
    </div>
  )
}
