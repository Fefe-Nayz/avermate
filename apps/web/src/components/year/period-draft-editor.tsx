"use client"

import { useMemo } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { DateField } from "@/components/forms/controls"
import { SettingsRow } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import {
  DragHandle,
  SortableList,
  SortableRow,
} from "@/components/ui/sortable-list"
import { Switch } from "@/components/ui/switch"
import { haptic } from "@/lib/haptics"
import { randomId } from "@/lib/id"
import {
  periodDraftProblems,
  periodDraftsFromTemplate,
  type PeriodDraft,
  type PeriodDraftProblem,
  type PeriodTemplateDefinition,
} from "@/lib/period-drafts"

function templatePresentation(id: string, t: ReturnType<typeof useExtracted>) {
  switch (id) {
    case "trimesters":
      return {
        label: t("Three terms"),
        names: [t("Term 1"), t("Term 2"), t("Term 3")],
      }
    case "semesters":
      return {
        label: t("Two semesters"),
        names: [t("Semester 1"), t("Semester 2")],
      }
    case "semesters-cumulative":
      return {
        label: t("Two semesters, cumulative"),
        names: [t("Semester 1"), t("Full year")],
      }
    case "quarters":
      return {
        label: t("Four quarters"),
        names: [t("Quarter 1"), t("Quarter 2"), t("Quarter 3"), t("Quarter 4")],
      }
    default:
      return { label: t("No split"), names: [] }
  }
}

function problemLabel(
  problem: PeriodDraftProblem,
  t: ReturnType<typeof useExtracted>
): string {
  switch (problem) {
    case "empty-name":
      return t("Give every period a name.")
    case "invalid-range":
      return t("Every period must end on or after it starts.")
    case "outside-year":
      return t("Periods must stay inside the school year.")
    case "overlap":
      return t("Periods cannot overlap.")
  }
}

export function PeriodDraftEditor({
  value,
  onChange,
  year,
  templates = [],
  allowAdd = true,
}: {
  value: PeriodDraft[]
  onChange: (drafts: PeriodDraft[]) => void
  year: { startsAt: string; endsAt: string }
  templates?: readonly PeriodTemplateDefinition[]
  allowAdd?: boolean
}) {
  const t = useExtracted()
  const problems = useMemo(
    () => periodDraftProblems(value, year),
    [value, year]
  )

  const update = (index: number, patch: Partial<PeriodDraft>) => {
    onChange(
      value.map((draft, position) =>
        position === index ? { ...draft, ...patch } : draft
      )
    )
  }

  const add = () => {
    haptic("light")
    onChange([
      ...value,
      {
        key: randomId(),
        name: t("New period"),
        startAt: year.startsAt,
        endAt: year.endsAt,
        isCumulative: false,
      },
    ])
  }

  return (
    <div className="flex flex-col gap-3">
      {templates.length > 0 ? (
        <div className="rounded-xl border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t("Start from a template")}
          </p>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => {
              const presentation = templatePresentation(template.id, t)
              return (
                <Button
                  key={template.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    haptic("selection")
                    onChange(
                      periodDraftsFromTemplate({
                        template,
                        startsAt: year.startsAt,
                        endsAt: year.endsAt,
                        names: presentation.names,
                      })
                    )
                  }}
                >
                  {presentation.label}
                </Button>
              )
            })}
          </div>
          {value.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                "Choosing a template replaces the unsaved period draft below."
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {value.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("No periods — the whole year counts as one.")}
          </p>
        </div>
      ) : (
        <SortableList
          ids={value.map((draft) => draft.key)}
          onReorder={(keys) => {
            const byKey = new Map(value.map((draft) => [draft.key, draft]))
            const ordered = keys.flatMap((key) => {
              const draft = byKey.get(key)
              return draft ? [draft] : []
            })
            if (ordered.length === value.length) onChange(ordered)
          }}
        >
          {value.map((draft, index) => (
            <SortableRow
              key={draft.key}
              id={draft.key}
              as="div"
              className="rounded-xl border bg-card p-3"
            >
              <div className="flex items-center gap-2 pb-3">
                <DragHandle className="-ml-1" />
                <input
                  value={draft.name}
                  maxLength={64}
                  aria-label={t("Period name")}
                  onChange={(event) =>
                    update(index, { name: event.target.value })
                  }
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Remove")}
                  onClick={() => {
                    haptic("light")
                    onChange(value.filter((_, position) => position !== index))
                  }}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DateField
                  label={t("Starts")}
                  value={draft.startAt}
                  onValueChange={(startAt) => update(index, { startAt })}
                />
                <DateField
                  label={t("Ends")}
                  value={draft.endAt}
                  onValueChange={(endAt) => update(index, { endAt })}
                />
              </div>
              <div className="pt-3">
                <SettingsRow
                  label={t("Cumulative")}
                  description={t(
                    "Includes everything since the start of the year."
                  )}
                >
                  <Switch
                    checked={draft.isCumulative}
                    onCheckedChange={(isCumulative) =>
                      update(index, { isCumulative })
                    }
                  />
                </SettingsRow>
              </div>
            </SortableRow>
          ))}
        </SortableList>
      )}

      {problems.length > 0 ? (
        <ul className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problemLabel(problem, t)}</li>
          ))}
        </ul>
      ) : null}

      {allowAdd ? (
        <Button type="button" variant="outline" onClick={add}>
          <PlusIcon className="size-4" />
          {t("Add a period")}
        </Button>
      ) : null}
    </div>
  )
}
