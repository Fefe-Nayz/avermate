"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-section"
import { NumberField, TextField } from "@/components/forms/controls"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

interface PeriodDraft {
  key: string
  name: string
  startAt: string
  endAt: string
  isCumulative: boolean
}

function createPeriodDrafts(
  periods: ReturnType<typeof useYear>["periods"]
): PeriodDraft[] {
  return periods
    .filter((period) => period.id !== "__full_year__")
    .map((period) => ({
      key: period.id,
      name: period.name,
      startAt: toDateInput(new Date(period.startAt)),
      endAt: toDateInput(new Date(period.endAt)),
      isCumulative: period.isCumulative,
    }))
}

/**
 * The year itself: its dates, its scale, and how it is split.
 *
 * Periods are edited as a set and saved in one go — changing them one at a
 * time would leave the year in half-migrated states that the averages would
 * pick up and show as real.
 */
export default function YearSettingsPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { year, yearId, periods } = useYear()

  const [sourceYear, setSourceYear] = useState(year)
  const [name, setName] = useState(year?.name ?? "")
  const [startsAt, setStartsAt] = useState(() =>
    year ? toDateInput(new Date(year.startsAt)) : ""
  )
  const [endsAt, setEndsAt] = useState(() =>
    year ? toDateInput(new Date(year.endsAt)) : ""
  )
  const [scale, setScale] = useState(() => String(year?.scale ?? 20))
  const [defaultOutOf, setDefaultOutOf] = useState(() =>
    String(year?.defaultOutOf ?? 20)
  )
  const [passing, setPassing] = useState(() =>
    String(year ? year.passingRatio * year.scale : 10)
  )
  const [decimals, setDecimals] = useState(() => String(year?.decimals ?? 2))
  const [sourcePeriods, setSourcePeriods] = useState(periods)
  const [drafts, setDrafts] = useState<PeriodDraft[]>(() =>
    createPeriodDrafts(periods)
  )

  // A refreshed snapshot replaces the editing baseline. Adjusting guarded
  // render state avoids an extra effect render while keeping unsaved edits
  // intact during unrelated renders.
  if (sourceYear !== year) {
    setSourceYear(year)
    if (year) {
      setName(year.name)
      setStartsAt(toDateInput(new Date(year.startsAt)))
      setEndsAt(toDateInput(new Date(year.endsAt)))
      setScale(String(year.scale))
      setDefaultOutOf(String(year.defaultOutOf))
      setPassing(String(year.passingRatio * year.scale))
      setDecimals(String(year.decimals))
    }
  }

  if (sourcePeriods !== periods) {
    setSourcePeriods(periods)
    setDrafts(createPeriodDrafts(periods))
  }

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.snapshot.get.queryKey({ input: { yearId: yearId ?? "" } }),
    })

  const saveYear = useMutation({
    ...orpc.years.update.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Year updated."))
      void invalidate()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The year could not be saved."))
    },
  })

  const savePeriods = useMutation({
    ...orpc.periods.replaceAll.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Periods updated."))
      void invalidate()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The periods could not be saved."))
    },
  })

  const scaleNumber = Number.parseFloat(scale) || 20

  return (
    <>
      <PageMeta title={t("Year & periods")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Year & periods")}
        </h1>

        <SettingsSection
          title={t("This year")}
          footer={
            <Button
              size="sm"
              disabled={saveYear.isPending}
              onClick={() =>
                saveYear.mutate({
                  yearId: yearId as string,
                  name: name.trim(),
                  startsAt: new Date(`${startsAt}T00:00:00`),
                  endsAt: new Date(`${endsAt}T23:59:59`),
                  scale: scaleNumber,
                  defaultOutOf: Number.parseFloat(defaultOutOf) || scaleNumber,
                  passingRatio:
                    (Number.parseFloat(passing) || scaleNumber / 2) /
                    scaleNumber,
                  decimals: Number.parseInt(decimals, 10) || 2,
                })
              }
            >
              {saveYear.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <SaveIcon className="size-4" />
              )}
              {t("Save")}
            </Button>
          }
        >
          <TextField
            label={t("Name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t("Starts")}
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
            <TextField
              label={t("Ends")}
              type="date"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t("Averages out of")}
              value={scale}
              onValueChange={setScale}
              min={1}
            />
            <NumberField
              label={t("New grades out of")}
              value={defaultOutOf}
              onValueChange={setDefaultOutOf}
              min={1}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t("Pass mark")}
              description={t("Used for pass rates and colour bands.")}
              value={passing}
              onValueChange={setPassing}
              min={0}
            />
            <NumberField
              label={t("Decimal places")}
              value={decimals}
              onValueChange={setDecimals}
              min={0}
              max={4}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("Periods")}
          description={t(
            "A grade with no period of its own is filed by its date. Deleting a period never deletes grades."
          )}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  haptic("light")
                  setDrafts((current) => [
                    ...current,
                    {
                      key: crypto.randomUUID(),
                      name: t("New period"),
                      startAt: startsAt,
                      endAt: endsAt,
                      isCumulative: false,
                    },
                  ])
                }}
              >
                <PlusIcon className="size-4" />
                {t("Add a period")}
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                disabled={savePeriods.isPending}
                onClick={() =>
                  savePeriods.mutate({
                    yearId: yearId as string,
                    periods: drafts.map((draft) => ({
                      name: draft.name.trim() || t("Period"),
                      startAt: new Date(`${draft.startAt}T00:00:00`),
                      endAt: new Date(`${draft.endAt}T23:59:59`),
                      isCumulative: draft.isCumulative,
                    })),
                  })
                }
              >
                {savePeriods.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <SaveIcon className="size-4" />
                )}
                {t("Save periods")}
              </Button>
            </>
          }
        >
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("No periods — the whole year counts as one.")}
            </p>
          ) : null}

          {drafts.map((draft, index) => (
            <div key={draft.key} className="rounded-xl border p-3">
              <div className="flex items-center gap-2 pb-3">
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { ...item, name: event.target.value }
                          : item
                      )
                    )
                  }
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Remove")}
                  onClick={() => {
                    haptic("light")
                    setDrafts((current) =>
                      current.filter((_, position) => position !== index)
                    )
                  }}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label={t("Starts")}
                  type="date"
                  value={draft.startAt}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { ...item, startAt: event.target.value }
                          : item
                      )
                    )
                  }
                />
                <TextField
                  label={t("Ends")}
                  type="date"
                  value={draft.endAt}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { ...item, endAt: event.target.value }
                          : item
                      )
                    )
                  }
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
                    onCheckedChange={(checked) =>
                      setDrafts((current) =>
                        current.map((item, position) =>
                          position === index
                            ? { ...item, isCumulative: checked }
                            : item
                        )
                      )
                    }
                  />
                </SettingsRow>
              </div>
            </div>
          ))}
        </SettingsSection>
      </div>
    </>
  )
}
