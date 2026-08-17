"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  WIDGET_DEFINITION_VERSION,
  type WidgetDefinitionV1,
  type WidgetSurface,
} from "@avermate/core"
import {
  resolveSlotMapping,
  substituteSlots,
  templateSlots,
  type TemplateSlotKind,
} from "@/components/cards/template-slots"
import { useWidgetResult } from "@/components/cards/use-widget-result"
import { WidgetBody } from "@/components/cards/widget-view"
import { resolveWidgetRow } from "@/components/cards/widget-row"
import { PageMeta } from "@/components/shell/page-chrome"
import { SelectControl } from "@/components/forms/controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

interface TemplateRow {
  id: string
  title: string
  description: string
  surfaces: string[]
  category: string
  status: "draft" | "published" | "archived"
  definitionVersion: number
  definitionJson: WidgetDefinitionV1
}

/**
 * Curating the card gallery.
 *
 * Authoring rides the full card editor: build the card on your own
 * dashboard or insights, then lift it here as a draft. Every template shows
 * as the live card it will be — evaluated on your own data, slots filled
 * with your first matching entities — because a catalog you can only read
 * as rows is not a catalog you can judge. Entity references are the
 * template's slots; installers re-point them at their own subjects,
 * averages, goals or periods.
 */
export default function AdminCardTemplatesPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { cards } = useYear()
  const [sourceCardId, setSourceCardId] = useState("")

  const templates = useQuery(orpc.cardTemplates.adminList.queryOptions())

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.cardTemplates.adminList.queryKey(),
    })
    void queryClient.invalidateQueries({
      queryKey: orpc.cardTemplates.list.queryKey(),
    })
  }

  const onError = (error: Error) => {
    haptic("error")
    toast.error(error.message || t("That did not work."))
  }

  const create = useMutation({
    ...orpc.cardTemplates.create.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Draft created"))
      setSourceCardId("")
      refresh()
    },
    onError,
  })

  const sources = useMemo(() => cards.filter((card) => !card.hidden), [cards])

  const createFromCard = () => {
    const row = sources.find((card) => card.id === sourceCardId)
    if (!row) return
    // A row whose definition will not compile cannot seed a template: there is
    // nothing to copy but the envelope.
    const definition = resolveWidgetRow(row).definition
    if (!definition) return
    create.mutate({
      title: row.title?.trim() || t("Untitled card"),
      description: "",
      surfaces: [row.surface as WidgetSurface],
      category: "general",
      definitionVersion: WIDGET_DEFINITION_VERSION,
      definitionJson: definition as unknown as Record<string, unknown>,
      sortOrder: 0,
    })
  }

  return (
    <>
      <PageMeta title={t("Card gallery")} backHref="/admin" />
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Card gallery")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Curated card templates every account can browse and install. Build one from scratch with the full editor, or lift one of your existing cards — references to your entities become the installer's choices."
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button render={<Link href="/admin/card-templates/new" />}>
            {t("Build a new template")}
          </Button>
          <SelectControl
            aria-label={t("Pick one of your cards…")}
            className="w-72 md:w-72"
            placeholder={t("Pick one of your cards…")}
            value={sourceCardId}
            onValueChange={(value) => setSourceCardId(value ?? "")}
            options={sources.map((card) => ({
              value: card.id,
              label:
                (card.title?.trim() || card.metric) +
                (card.surface === "insights" ? " · Insights" : ""),
            }))}
          />
          <Button
            disabled={!sourceCardId || create.isPending}
            onClick={createFromCard}
            type="button"
            variant="outline"
          >
            {create.isPending ? <Spinner className="size-4" /> : null}
            {t("Create a draft from it")}
          </Button>
        </div>

        {templates.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-5" />
          </div>
        ) : (templates.data ?? []).length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t(
              "No templates yet. Build one from scratch or lift one of your cards."
            )}
          </p>
        ) : (
          <div className="grid gap-4 @2xl/main:grid-cols-2">
            {((templates.data ?? []) as TemplateRow[]).map((template) => (
              <AdminTemplateCard
                key={template.id}
                onChanged={refresh}
                onError={onError}
                template={template}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function AdminTemplateCard({
  template,
  onChanged,
  onError,
}: {
  template: TemplateRow
  onChanged: () => void
  onError: (error: Error) => void
}) {
  const t = useExtracted()
  const { graph, customAverages, goals, periods } = useYear()
  const [title, setTitle] = useState(template.title)
  const [description, setDescription] = useState(template.description)
  const [category, setCategory] = useState(template.category)

  const publish = useMutation({
    ...orpc.cardTemplates.publish.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Template published"))
      onChanged()
    },
    onError,
  })
  const archive = useMutation({
    ...orpc.cardTemplates.archive.mutationOptions(),
    onSuccess: () => {
      haptic("light")
      onChanged()
    },
    onError,
  })
  const update = useMutation({
    ...orpc.cardTemplates.update.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      onChanged()
    },
    onError,
  })

  const slotOptions = useMemo<Record<TemplateSlotKind, { value: string }[]>>(
    () => ({
      subject: graph.flatten().map((subject) => ({ value: subject.id })),
      "custom-average": customAverages.map((average) => ({
        value: average.id,
      })),
      goal: goals.map((goal) => ({ value: goal.id })),
      period: periods.map((period) => ({ value: period.id })),
    }),
    [customAverages, goals, graph, periods]
  )

  const slots = useMemo(
    () => templateSlots(template.definitionJson),
    [template.definitionJson]
  )
  const previewDefinition = useMemo(
    () =>
      substituteSlots(
        template.definitionJson,
        resolveSlotMapping(slots, slotOptions)
      ),
    [slotOptions, slots, template.definitionJson]
  )
  const surface = (template.surfaces[0] ?? "overview") as WidgetSurface
  const result = useWidgetResult(previewDefinition, surface)

  const draft = template.status === "draft"
  const metadataDirty =
    title !== template.title ||
    description !== template.description ||
    category !== template.category

  const statusLabels: Record<TemplateRow["status"], string> = {
    draft: t("Draft"),
    published: t("Published"),
    archived: t("Archived"),
  }

  return (
    <Card className="@container/card flex flex-col gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardTitle className="text-xs leading-tight font-medium tracking-wide text-muted-foreground uppercase">
          {template.title}
        </CardTitle>
        <Badge
          variant={
            template.status === "published"
              ? "default"
              : template.status === "draft"
                ? "secondary"
                : "outline"
          }
        >
          {statusLabels[template.status]}
        </Badge>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4">
        <div className="min-h-24 flex-1">
          <WidgetBody definition={previewDefinition} result={result} />
        </div>
        <p className="text-xs text-muted-foreground">
          {template.category} · {template.surfaces.join(", ")}
          {slots.length > 0
            ? ` · ${t("{count} installer choices", {
                count: String(slots.length),
              })}`
            : ""}
        </p>
        {draft ? (
          <div className="flex flex-col gap-2">
            <Input
              aria-label={t("Title")}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
            <Input
              aria-label={t("Description")}
              maxLength={280}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("Description")}
              value={description}
            />
            <Input
              aria-label={t("Category")}
              maxLength={48}
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {draft && metadataDirty ? (
            <Button
              disabled={update.isPending || title.trim().length === 0}
              onClick={() =>
                update.mutate({
                  templateId: template.id,
                  title: title.trim(),
                  description: description.trim(),
                  category: category.trim() || "general",
                })
              }
              size="sm"
              type="button"
            >
              {update.isPending ? <Spinner className="size-4" /> : null}
              {t("Save")}
            </Button>
          ) : null}
          {draft ? (
            <Button
              disabled={publish.isPending}
              onClick={() => publish.mutate({ templateId: template.id })}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("Publish")}
            </Button>
          ) : null}
          {template.status !== "archived" ? (
            <Button
              disabled={archive.isPending}
              onClick={() => archive.mutate({ templateId: template.id })}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("Archive")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
