"use client"

import { useCallback, useId, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  WIDGET_DEFINITION_VERSION,
  type CohortContext,
  type FriendContext,
  type WidgetDefinition,
  type WidgetSurface,
} from "@avermate/core"
import { SelectControl } from "@/components/forms/controls"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  cohortMemberChoices,
  friendChoices,
  useCohorts,
  useFriends,
} from "@/hooks/use-cohorts"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  resolveSlotMapping,
  substituteSlots,
  templateSlotKey,
  templateSlots,
  type TemplateSlot,
  type TemplateSlotKind,
} from "./template-slots"
import { useWidgetResult } from "./use-widget-result"
import { WidgetBody } from "./widget-view"

interface CardTemplateRow {
  id: string
  title: string
  description: string
  surfaces: string[]
  category: string
  definitionVersion: number
  definitionJson: WidgetDefinition
}

interface SlotOption {
  value: string
  label: string
}

/**
 * The store: admin-curated card definitions, browsed on the user's own data.
 *
 * Every tile is the real widget evaluated live against the current year —
 * the honest preview no screenshot could give. A template may carry SLOTS
 * (the entities its author built it on); each becomes a small picker,
 * pre-filled with the user's first matching entity, and installing writes a
 * card whose definition points at the picks. Installation is the ordinary
 * `cards.create`, so a gallery card and a hand-built one are the same thing
 * from the moment they land.
 */
export function CardGallery({ surface }: { surface: WidgetSurface }) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, graph, customAverages, goals, periods } = useYear()
  const [installingId, setInstallingId] = useState<string | null>(null)

  const templates = useQuery(orpc.cardTemplates.list.queryOptions())
  const returnHref = surface === "insights" ? "/insights" : "/dashboard"
  const rows = useMemo(
    () =>
      ((templates.data ?? []) as CardTemplateRow[]).filter((row) =>
        row.surfaces.includes(surface)
      ),
    [surface, templates.data]
  )
  const requiredSlotKinds = useMemo(() => {
    const kinds = new Set<TemplateSlotKind>()
    for (const row of rows) {
      for (const slot of templateSlots(row.definitionJson)) kinds.add(slot.kind)
    }
    return kinds
  }, [rows])

  // A template can name a class, a member of it, or a friend. Query only the social
  // domain represented by the visible templates. Member choices need the figures from
  // each class because the list endpoint intentionally exposes comparisons, not people.
  const needsCohorts =
    requiredSlotKinds.has("cohort") || requiredSlotKinds.has("cohort-member")
  const { cohorts, choices: cohortChoices } = useCohorts({
    enabled: needsCohorts,
    loadAllFigures: requiredSlotKinds.has("cohort-member"),
  })
  const { friends } = useFriends({ enabled: requiredSlotKinds.has("friend") })

  const slotOptions = useMemo<Record<TemplateSlotKind, SlotOption[]>>(
    () => ({
      subject: graph
        .flatten()
        .map((subject) => ({ value: subject.id, label: subject.name })),
      "custom-average": customAverages.map((average) => ({
        value: average.id,
        label: average.name,
      })),
      goal: goals.map((goal) => ({ value: goal.id, label: goal.name })),
      period: periods.map((period) => ({
        value: period.id,
        label: period.name,
      })),
      cohort: cohortChoices.map((cohort) => ({
        value: cohort.comparisonId,
        label: cohort.name,
      })),
      // A member is dependent on the comparison selected inside one tile. Pooling every
      // class here made it possible to install class B with a member from class A.
      "cohort-member": [],
      // Friend options are also dependent: each metric has its own sharing lock, so a
      // subject-only friend cannot fill an average or history slot.
      friend: [],
    }),
    [cohortChoices, customAverages, goals, graph, periods]
  )

  const install = useMutation({
    ...orpc.cards.create.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Card added"))
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.push(returnHref)
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The card could not be saved."))
      setInstallingId(null)
    },
  })

  const groups = useMemo(() => {
    const byCategory = new Map<string, CardTemplateRow[]>()
    for (const row of rows) {
      const list = byCategory.get(row.category) ?? []
      list.push(row)
      byCategory.set(row.category, list)
    }
    return [...byCategory.entries()]
  }, [rows])

  if (templates.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-5" />
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("Nothing in the gallery yet. Check back soon.")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map(([category, rows]) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {category}
          </h2>
          <div className="grid gap-4 @2xl/main:grid-cols-2">
            {rows.map((template) => (
              <GalleryTile
                key={template.id}
                installing={install.isPending && installingId === template.id}
                disabled={install.isPending || !yearId}
                onInstall={(definition) => {
                  setInstallingId(template.id)
                  install.mutate({
                    yearId: yearId as string,
                    surface,
                    span: surface === "insights" ? 4 : 2,
                    title: null,
                    accent: null,
                    hidden: false,
                    definitionVersion: WIDGET_DEFINITION_VERSION,
                    definitionJson: definition,
                  })
                }}
                slotOptions={slotOptions}
                cohorts={cohorts}
                friends={friends}
                surface={surface}
                template={template}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function GalleryTile({
  template,
  surface,
  onInstall,
  installing,
  disabled,
  slotOptions,
  cohorts,
  friends,
}: {
  template: CardTemplateRow
  surface: WidgetSurface
  onInstall: (definition: WidgetDefinition) => void
  installing: boolean
  disabled: boolean
  slotOptions: Record<TemplateSlotKind, SlotOption[]>
  cohorts: ReadonlyMap<string, CohortContext>
  friends: ReadonlyMap<string, FriendContext>
}) {
  const t = useExtracted()
  const tileId = useId()
  const slots = useMemo(
    () => templateSlots(template.definitionJson),
    [template.definitionJson]
  )
  const [picks, setPicks] = useState<ReadonlyMap<string, string>>(new Map())

  const cohortSlot = slots.find((slot) => slot.kind === "cohort")
  const selectedComparisonId = useMemo(() => {
    if (!cohortSlot) return ""
    return (
      resolveSlotMapping([cohortSlot], slotOptions, picks).get(
        templateSlotKey(cohortSlot)
      ) ?? ""
    )
  }, [cohortSlot, picks, slotOptions])
  const optionsForSlot = useCallback(
    (slot: TemplateSlot): SlotOption[] => {
      if (slot.kind === "cohort-member") {
        return cohortMemberChoices(cohorts, selectedComparisonId)
      }
      if (slot.kind === "friend") {
        return friendChoices(friends, slot.friendRequirement)
      }
      return slotOptions[slot.kind]
    },
    [cohorts, friends, selectedComparisonId, slotOptions]
  )

  const slotLabels: Record<TemplateSlotKind, string> = {
    subject: t("Subject"),
    "custom-average": t("Custom average"),
    goal: t("Goal"),
    period: t("Period"),
    cohort: t("Class"),
    "cohort-member": t("Classmate"),
    friend: t("Friend"),
  }
  const slotEmptyHints: Record<TemplateSlotKind, string> = {
    subject: t("This card follows a subject, and this year has none yet."),
    "custom-average": t(
      "This card follows a custom average, and you have none yet."
    ),
    goal: t("This card follows a goal, and you have none yet."),
    period: t("This card follows a period, and this year has none yet."),
    cohort: t(
      "This card compares with a class, and none of yours has comparisons turned on."
    ),
    "cohort-member": t(
      "This card is about a classmate, and nobody in your classes has shared an average with you yet."
    ),
    friend: t(
      "This card is about a friend, and none of your friends has shared the required results with you yet."
    ),
  }

  const mapping = useMemo(
    () => resolveSlotMapping(slots, slotOptions, picks, optionsForSlot),
    [optionsForSlot, picks, slots, slotOptions]
  )

  const unfillableSlot = slots.find((slot) => optionsForSlot(slot).length === 0)
  const unfillable = Boolean(unfillableSlot)
  const titleId = `${tileId}-title`
  const unfillableHintId = unfillable ? `${tileId}-unfillable` : undefined
  const resolvedDefinition = useMemo(
    () => substituteSlots(template.definitionJson, mapping),
    [mapping, template.definitionJson]
  )
  const result = useWidgetResult(resolvedDefinition, surface)

  return (
    <Card className="@container/card flex flex-col gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-xs leading-tight font-medium tracking-wide text-muted-foreground uppercase">
          <h3 id={titleId}>{template.title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4">
        <div className="min-h-24 flex-1">
          <WidgetBody definition={resolvedDefinition} result={result} />
        </div>
        {template.description ? (
          <p className="text-xs text-muted-foreground">
            {template.description}
          </p>
        ) : null}
        {slots.map((slot) => {
          const options = optionsForSlot(slot)
          const empty = options.length === 0
          return (
            <div
              key={templateSlotKey(slot)}
              className="flex items-center gap-2 text-sm"
            >
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                {slotLabels[slot.kind]}
              </span>
              <SelectControl
                aria-label={slotLabels[slot.kind]}
                aria-describedby={empty ? unfillableHintId : undefined}
                className="min-w-0 flex-1"
                disabled={empty}
                value={mapping.get(templateSlotKey(slot)) ?? ""}
                onValueChange={(value) => {
                  if (!value) return
                  setPicks((current) => {
                    const next = new Map(current)
                    next.set(templateSlotKey(slot), value)
                    return next
                  })
                }}
                options={options}
              />
            </div>
          )
        })}
        {unfillable ? (
          <p id={unfillableHintId} className="text-xs text-muted-foreground">
            {slotEmptyHints[unfillableSlot?.kind ?? "subject"]}
          </p>
        ) : null}
        <Button
          aria-describedby={unfillableHintId}
          className="self-start"
          disabled={disabled || unfillable}
          onClick={() => onInstall(resolvedDefinition)}
          size="sm"
          type="button"
        >
          {installing ? <Spinner className="size-4" /> : null}
          {t("Add this card")}
        </Button>
      </CardContent>
    </Card>
  )
}
