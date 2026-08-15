"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  WIDGET_DEFINITION_VERSION,
  type WidgetDefinitionV1,
  type WidgetSurface,
} from "@avermate/core"
import { SelectControl } from "@/components/forms/controls"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  resolveSlotMapping,
  substituteSlots,
  templateSlots,
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
  definitionJson: WidgetDefinitionV1
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
    }),
    [customAverages, goals, graph, periods]
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
    const rows = ((templates.data ?? []) as CardTemplateRow[]).filter((row) =>
      row.surfaces.includes(surface)
    )
    const byCategory = new Map<string, CardTemplateRow[]>()
    for (const row of rows) {
      const list = byCategory.get(row.category) ?? []
      list.push(row)
      byCategory.set(row.category, list)
    }
    return [...byCategory.entries()]
  }, [surface, templates.data])

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
}: {
  template: CardTemplateRow
  surface: WidgetSurface
  onInstall: (definition: WidgetDefinitionV1) => void
  installing: boolean
  disabled: boolean
  slotOptions: Record<TemplateSlotKind, SlotOption[]>
}) {
  const t = useExtracted()
  const slots = useMemo(
    () => templateSlots(template.definitionJson),
    [template.definitionJson]
  )
  const [picks, setPicks] = useState<ReadonlyMap<string, string>>(new Map())

  const slotLabels: Record<TemplateSlotKind, string> = {
    subject: t("Subject"),
    "custom-average": t("Custom average"),
    goal: t("Goal"),
    period: t("Period"),
  }
  const slotEmptyHints: Record<TemplateSlotKind, string> = {
    subject: t("This card follows a subject, and this year has none yet."),
    "custom-average": t(
      "This card follows a custom average, and you have none yet."
    ),
    goal: t("This card follows a goal, and you have none yet."),
    period: t("This card follows a period, and this year has none yet."),
  }

  const mapping = useMemo(
    () => resolveSlotMapping(slots, slotOptions, picks),
    [picks, slotOptions, slots]
  )

  const unfillable = slots.some((slot) => slotOptions[slot.kind].length === 0)
  const resolvedDefinition = useMemo(
    () => substituteSlots(template.definitionJson, mapping),
    [mapping, template.definitionJson]
  )
  const result = useWidgetResult(resolvedDefinition, surface)

  return (
    <Card className="@container/card flex flex-col gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-xs leading-tight font-medium tracking-wide text-muted-foreground uppercase">
          {template.title}
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
        {slots.map((slot) => (
          <div
            key={slot.placeholderId}
            className="flex items-center gap-2 text-sm"
          >
            <span className="w-32 shrink-0 text-xs text-muted-foreground">
              {slotLabels[slot.kind]}
            </span>
            <SelectControl
              aria-label={slotLabels[slot.kind]}
              className="h-8 flex-1 md:h-8"
              value={mapping.get(slot.placeholderId) ?? ""}
              onValueChange={(value) => {
                if (!value) return
                setPicks((current) => {
                  const next = new Map(current)
                  next.set(slot.placeholderId, value)
                  return next
                })
              }}
              options={slotOptions[slot.kind]}
            />
          </div>
        ))}
        {unfillable ? (
          <p className="text-xs text-muted-foreground">
            {
              slotEmptyHints[
                slots.find((slot) => slotOptions[slot.kind].length === 0)
                  ?.kind ?? "subject"
              ]
            }
          </p>
        ) : null}
        <Button
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
