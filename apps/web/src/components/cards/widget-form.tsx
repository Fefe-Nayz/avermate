"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  availableSpans,
  cardColumns,
  compileWidgetDefinition,
  createWidgetDefinition,
  resolveWidgetFlow,
  spanForColumns,
  widgetCapability,
  widgetMeasureId,
  widgetPrimaryMeasure,
  widgetRecipeLayout,
  widgetSocialNeeds,
  WIDGET_DEFINITION_VERSION,
  type CardSpec,
  type WidgetDefinition,
  type WidgetFlowSection,
  type WidgetOptionProvider,
  type WidgetSurface,
} from "@avermate/core"
import {
  AccentField,
  ChoiceField,
  FormSection,
  TextField,
} from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { useCohorts, useFriends } from "@/hooks/use-cohorts"
import { useYear, type DashboardCardRow } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  CardShell,
  CardShellGrid,
  cardSurface,
  useDashboardGrid,
} from "./card-shell"
import {
  WidgetFieldRenderer,
  type WidgetOptionSets,
} from "./widget-field-renderer"
import { resolveWidgetRow } from "./widget-row"
import { useWidgetMessages } from "./use-widget-messages"
import { useWidgetResult } from "./use-widget-result"
import { WidgetBody } from "./widget-view"
import { widgetRecipeForLayout } from "./widget-responsive"
import type { WidgetDraftValue } from "./widget-draft"
import {
  resolveWidgetEditorChange,
  widgetIssueForPath,
} from "./widget-editor-model"

const PREVIEW_SPAN: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
}

/**
 * Refinements, not decisions: these sections fold to a one-line readout of
 * their state so the form presents a handful of choices instead of a wall.
 * The primary sections — what data, what measure, what chart — stay open.
 */
const REFINEMENT_SECTIONS = new Set([
  "filters",
  "comparison",
  "transforms",
  "scale",
  "axes",
  "legend",
  "format",
  "thresholds",
])

/**
 * Repoints the editor at a different destination — the card gallery's
 * template drafts. The flow, preview and validation stay exactly the card
 * editor's; only the chrome and the save change hands. Width and colour
 * disappear because installers choose those, not templates.
 */
export interface WidgetFormSubmission {
  title: string
  description: string
  backHref: string
  submitLabel: string
  pending: boolean
  /** Receives the compiled definition and a non-empty title. */
  submit: (definition: WidgetDefinition, title: string) => void
  /** An extra opening step, e.g. the template's surface choice. */
  leadStep?: FlowStep
}

export function WidgetForm({
  mode,
  surface,
  initial,
  submission,
}: {
  mode: "create" | "edit"
  surface: WidgetSurface
  initial?: DashboardCardRow
  submission?: WidgetFormSubmission
}) {
  const t = useExtracted()
  const message = useWidgetMessages()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, customAverages, goals, periods, yearId } = useYear()
  const initialDefinition = useMemo(
    () =>
      // A row that will not compile opens as a fresh card rather than as a
      // blank screen: editing is the one place that can repair it.
      (initial ? resolveWidgetRow(initial).definition : null) ??
      createWidgetDefinition(surface),
    [initial, surface]
  )
  const [definition, setDefinition] = useState(initialDefinition)
  const [span, setSpan] = useState<CardSpec["span"]>(
    initial ? clampSpan(initial.span) : surface === "insights" ? 4 : 2
  )
  const [title, setTitle] = useState(initial?.title ?? "")
  const [accent, setAccent] = useState(initial?.accent ?? null)
  const [hidden] = useState(initial?.hidden ?? false)

  const socialNeeds = useMemo(() => widgetSocialNeeds(definition), [definition])
  const primaryMeasure = widgetPrimaryMeasure(definition.analysis)
  // The comparison the card currently names, which decides both the sole expensive group
  // response to fetch and the people the dependent member picker may offer.
  const selectedGroupId =
    primaryMeasure?.kind === "metric" ? (primaryMeasure.groupId ?? null) : null
  const selectedComparisonIds = useMemo(
    () => (selectedGroupId ? [selectedGroupId] : []),
    [selectedGroupId]
  )
  // A normal card editor now asks for no social data. Choosing a social metric first
  // loads its cheap picker; choosing a cohort comparison then loads that group alone.
  const { cohorts, choices: cohortChoices } = useCohorts({
    enabled: socialNeeds.cohorts,
    comparisonIds: selectedComparisonIds,
  })
  const { people } = useFriends({ enabled: socialNeeds.friends })
  const optionSets = useMemo<WidgetOptionSets>(
    () => ({
      subjects: graph.flatten().map((subject) => ({
        value: subject.id,
        messageKey: subject.name,
      })),
      "custom-averages": customAverages.map((average) => ({
        value: average.id,
        messageKey: average.name,
      })),
      goals: goals.map((goal) => ({
        value: goal.id,
        messageKey: goal.name,
      })),
      periods: periods.map((period) => ({
        value: period.id,
        messageKey: period.name,
      })),
      /**
       * One entry per *comparison*, not per group.
       *
       * `useCohorts` keys its map by the comparison's id — "Terminale 2" and "Maths in
       * Terminale 2" are two readings of one group — and the evaluator looks the card's
       * `groupId` up in that map. Offering the group's own id would store a reference
       * nothing can resolve.
       */
      cohorts: cohortChoices.map((cohort) => ({
        value: cohort.comparisonId,
        messageKey: cohort.name,
      })),
      // Those readable inside the chosen comparison. Before one is chosen there is
      // nobody to offer, which is the honest answer rather than everyone.
      "cohort-members": (selectedGroupId
        ? (cohorts.get(selectedGroupId)?.members ?? [])
        : []
      ).map((member) => ({ value: member.userId, messageKey: member.name })),
      friends: people.map((friend) => ({
        value: friend.userId,
        messageKey: friend.name,
      })),
    }),
    [
      cohortChoices,
      cohorts,
      customAverages,
      goals,
      graph,
      people,
      periods,
      selectedGroupId,
    ]
  )
  const flow = useMemo(
    () =>
      resolveWidgetFlow(definition, {
        surface,
        options: optionSets as Partial<
          Record<WidgetOptionProvider, { value: string; messageKey: string }[]>
        >,
      }),
    [definition, optionSets, surface]
  )
  const draftCompilation = useMemo(
    () => compileWidgetDefinition(definition, { surface }),
    [definition, surface]
  )
  const result = useWidgetResult(flow.prunedDefinition, surface)
  const capability = widgetCapability(
    widgetMeasureId(widgetPrimaryMeasure(flow.prunedDefinition.analysis))
  )
  const defaultTitle = message(capability.messageKey)

  // The pane the dashboard is drawn in decides, exactly as its container
  // queries do — not this window. See `useDashboardGrid`.
  const { columns } = useDashboardGrid()
  // The dashboard lets an adaptive recipe occupy the compact fallback's width,
  // while a preserving definition keeps the requested recipe's floor. The editor
  // must ask the same question or it previews an adaptive one-column card but never
  // lets the reader choose that width.
  const requestedRecipe = flow.prunedDefinition.visualization.recipe
  const layoutRecipe = draftCompilation.plan
    ? widgetRecipeForLayout(
        requestedRecipe,
        flow.prunedDefinition.presentation.responsiveBehavior,
        draftCompilation.plan.resultShape
      )
    : requestedRecipe
  const shape = { recipe: layoutRecipe }
  const widths = availableSpans(shape, columns)
  const drawn = cardColumns({ ...shape, span }, columns)

  const updateDraft = (draft: WidgetDraftValue) => {
    setDefinition(
      resolveWidgetEditorChange(draft as unknown as WidgetDefinition, {
        surface,
        options: optionSets,
      })
    )
  }

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.snapshot.get.queryKey({ input: { yearId: yearId ?? "" } }),
    })
  const returnHref = surface === "insights" ? "/insights" : "/dashboard"
  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(mode === "create" ? t("Card added") : t("Card updated"))
      void invalidate()
      router.push(returnHref)
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
      void invalidate()
      router.push(returnHref)
    },
  })

  const submit = () => {
    const compiled = compileWidgetDefinition(definition, { surface })
    if (!compiled.valid || !compiled.plan) {
      toast.error(message("widget.error.definition"))
      return
    }
    if (submission) {
      submission.submit(compiled.plan.definition, title.trim() || defaultTitle)
      return
    }
    const payload = {
      span,
      title: title.trim() || null,
      accent,
      hidden,
      definitionVersion: WIDGET_DEFINITION_VERSION,
      definitionJson: compiled.plan.definition,
    } as const
    if (mode === "create") {
      create.mutate({
        yearId: yearId as string,
        surface,
        ...payload,
      })
    } else {
      update.mutate({ cardId: initial?.id as string, ...payload })
    }
  }

  const preview = (
    <CardShellGrid>
      {/* The very shell the grid draws. This copy had grown a `min-h-36` floor
          the real card has no trace of, dropped `cardSurface` — so the preview
          never showed a loading, empty or error state — and let a long title run
          unclamped. */}
      <CardShell
        accent={accent}
        surface={cardSurface(result)}
        heightTier={
          widgetRecipeLayout(flow.prunedDefinition.visualization.recipe)
            .minHeightTier
        }
        spanClasses={PREVIEW_SPAN[drawn]}
        title={title.trim() || defaultTitle}
      >
        {/* `expanded` is not decoration: it takes a chart from 170px to 300 or
            320. The grid passes it for every insights card and this preview
            passed nothing, so an insights card was previewed at half the height
            it would be drawn at — the body diverging, not just its frame. */}
        <WidgetBody
          definition={flow.prunedDefinition}
          result={result}
          expanded={surface === "insights"}
          columns={drawn as 1 | 2 | 3 | 4}
          gridColumns={columns as 1 | 2 | 3 | 4}
        />
      </CardShell>
    </CardShellGrid>
  )

  const steps: FlowStep[] = [
    ...(submission?.leadStep ? [submission.leadStep] : []),
    editorStep("definition", t("Data and analysis"), flow.definition),
    editorStep("visualization", t("Visualisation"), flow.visualization),
  ]

  function editorStep(
    id: string,
    label: string,
    sections: WidgetFlowSection[]
  ): FlowStep {
    return {
      id,
      title: label,
      summary: summarize(sections, flow.prunedDefinition, message),
      content: (
        <div className="flex flex-col gap-8">
          {sections.map((section) => {
            const refinement = REFINEMENT_SECTIONS.has(section.id)
            const sectionHasIssue = section.fields.some(
              (field) =>
                field.active &&
                widgetIssueForPath(draftCompilation.issues, field.path)
            )
            return (
              <FormSection
                key={section.id}
                title={message(section.messageKey)}
                description={
                  section.descriptionKey
                    ? message(section.descriptionKey)
                    : undefined
                }
                collapsible={refinement}
                forceOpen={refinement && sectionHasIssue}
                summary={
                  refinement
                    ? summarize([section], flow.prunedDefinition, message)
                    : undefined
                }
              >
                {section.fields
                  .filter((field) => field.active)
                  .map((field) => (
                    <WidgetFieldRenderer
                      key={field.id}
                      field={{
                        ...field,
                        error:
                          widgetIssueForPath(
                            draftCompilation.issues,
                            field.path
                          )?.messageKey ?? null,
                      }}
                      draft={definition as unknown as WidgetDraftValue}
                      message={message}
                      optionSets={optionSets}
                      onChange={updateDraft}
                    />
                  ))}
              </FormSection>
            )
          })}
        </div>
      ),
    }
  }

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

  return (
    <FormFlow
      title={
        submission?.title ??
        (mode === "create" ? t("New card") : t("Edit card"))
      }
      description={
        submission?.description ??
        (surface === "insights"
          ? t(
              "Build the analysis and chart around the question you want to answer."
            )
          : t(
              "Choose the data, calculation and presentation for this DataCard."
            ))
      }
      backHref={submission?.backHref ?? returnHref}
      steps={steps}
      aside={preview}
      asidePlacement="sticky-end"
      beforeSave={
        <div className="flex flex-col gap-5">
          {submission ? null : (
            <>
              <ChoiceField
                label={t("Width")}
                choices={widths.map((width) => ({
                  value: String(width.columns),
                  label:
                    widthLabels[`${width.columns}/${columns}`] ?? t("Full"),
                }))}
                value={String(drawn)}
                onValueChange={(value) =>
                  setSpan(
                    spanForColumns(
                      span,
                      Number.parseInt(value, 10),
                      shape,
                      columns
                    )
                  )
                }
                columns={widths.length > 2 ? 4 : 2}
              />
              <AccentField value={accent} onValueChange={setAccent} />
            </>
          )}
          <TextField
            label={t("Title")}
            description={t("Leave blank to use the metric's own name.")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={48}
            placeholder={defaultTitle}
          />
        </div>
      }
      onSubmit={submit}
      submitLabel={
        submission?.submitLabel ??
        (mode === "create"
          ? surface === "insights"
            ? t("Add to Insights")
            : t("Add to dashboard")
          : t("Save changes"))
      }
      submitting={
        submission ? submission.pending : create.isPending || update.isPending
      }
      disabled={!draftCompilation.valid || (!submission && !yearId)}
      destructive={
        mode === "edit" && initial && !submission
          ? {
              label: t("Remove"),
              onClick: () => remove.mutate({ cardId: initial.id }),
            }
          : undefined
      }
    />
  )
}

function clampSpan(span: number): CardSpec["span"] {
  return Math.min(4, Math.max(1, span)) as CardSpec["span"]
}

function summarize(
  sections: WidgetFlowSection[],
  definition: WidgetDefinition,
  message: (key: string) => string
): string {
  const summaries = sections.flatMap((section) =>
    section.fields.flatMap((field) => {
      if (!field.active) return []
      const segments = field.path.split(".")
      let current: unknown = definition
      for (const segment of segments) {
        if (!current || typeof current !== "object") return []
        current = (current as Record<string, unknown>)[segment]
      }
      if (typeof current !== "string" && typeof current !== "number") return []
      const option = field.options.find(
        (item) => item.value === String(current)
      )
      return [option ? message(option.messageKey) : String(current)]
    })
  )
  return [...new Set(summaries)].slice(0, 3).join(" · ")
}
