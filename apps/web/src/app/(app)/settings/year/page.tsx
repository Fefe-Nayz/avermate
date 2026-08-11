"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DragHandle,
  SortableList,
  SortableRow,
} from "@/components/ui/sortable-list"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  SettingsSection,
} from "@/components/settings/settings-section"
import { DateField, NumberField, TextField } from "@/components/forms/controls"
import { PeriodDraftEditor } from "@/components/year/period-draft-editor"
import { useYear } from "@/components/year/year-provider"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import {
  dateInputValue,
  periodDraftProblems,
  periodDraftsFromRows,
  type PeriodDraft,
} from "@/lib/period-drafts"

/**
 * The year itself: its dates, its scale, and how it is split.
 *
 * Periods are edited as a set and saved in one go — changing them one at a
 * time would leave the year in half-migrated states that the averages would
 * pick up and show as real.
 */
export default function YearSettingsPage() {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const { year, yearId, years, periods, selectYear } = useYear()
  const [deletingYearId, setDeletingYearId] = useState<string | null>(null)

  const [sourceYear, setSourceYear] = useState(year)
  const [name, setName] = useState(year?.name ?? "")
  const [startsAt, setStartsAt] = useState(() =>
    year ? dateInputValue(new Date(year.startsAt)) : ""
  )
  const [endsAt, setEndsAt] = useState(() =>
    year ? dateInputValue(new Date(year.endsAt)) : ""
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
    periodDraftsFromRows(
      periods.filter((period) => period.id !== "__full_year__")
    )
  )

  // A refreshed snapshot replaces the editing baseline. Adjusting guarded
  // render state avoids an extra effect render while keeping unsaved edits
  // intact during unrelated renders.
  if (sourceYear !== year) {
    setSourceYear(year)
    if (year) {
      setName(year.name)
      setStartsAt(dateInputValue(new Date(year.startsAt)))
      setEndsAt(dateInputValue(new Date(year.endsAt)))
      setScale(String(year.scale))
      setDefaultOutOf(String(year.defaultOutOf))
      setPassing(String(year.passingRatio * year.scale))
      setDecimals(String(year.decimals))
    }
  }

  if (sourcePeriods !== periods) {
    setSourcePeriods(periods)
    setDrafts(
      periodDraftsFromRows(
        periods.filter((period) => period.id !== "__full_year__")
      )
    )
  }

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.snapshot.get.queryKey({ input: { yearId: yearId ?? "" } }),
    })

  const invalidateYears = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.years.list.queryKey(),
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
      void Promise.all([
        invalidate(),
        invalidateAnnouncementAudience(queryClient),
      ])
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The periods could not be saved."))
    },
  })

  const reorderYears = useMutation({
    ...orpc.years.reorder.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      void invalidateYears()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(
        error.message || t("The school years could not be reordered.")
      )
    },
  })

  const archiveYear = useMutation({
    ...orpc.years.archive.mutationOptions(),
    onSuccess: (_, variables) => {
      if (variables.archived && variables.yearId === yearId) {
        const fallback =
          years.find(
            (item) => item.id !== variables.yearId && !item.archivedAt
          ) ?? years.find((item) => item.id !== variables.yearId)
        if (fallback) selectYear(fallback.id)
      }
      haptic("success")
      toast.success(
        variables.archived ? t("Year archived.") : t("Year restored.")
      )
      void invalidateYears()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The year could not be updated."))
    },
  })

  const deleteContents = useQuery({
    ...orpc.years.contents.queryOptions({
      input: { yearId: deletingYearId ?? "" },
    }),
    enabled: Boolean(deletingYearId),
  })

  const deleteYear = useMutation({
    ...orpc.years.delete.mutationOptions(),
    onSuccess: (_, variables) => {
      const fallback =
        years.find(
          (item) => item.id !== variables.yearId && !item.archivedAt
        ) ?? years.find((item) => item.id !== variables.yearId)
      if (variables.yearId === yearId && fallback) selectYear(fallback.id)
      queryClient.removeQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: variables.yearId },
        }),
      })
      setDeletingYearId(null)
      haptic("success")
      toast.success(t("Year deleted."))
      void invalidateYears()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The year could not be deleted."))
    },
  })

  const scaleNumber = Number.parseFloat(scale) || 20

  const reorderYearList = (yearIds: string[]) => {
    if (reorderYears.isPending) return
    reorderYears.mutate({ yearIds })
  }

  const deletingYear = years.find((item) => item.id === deletingYearId)
  const activeYearCount = years.filter((item) => !item.archivedAt).length

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
            <DateField
              label={t("Starts")}
              value={startsAt}
              onValueChange={setStartsAt}
            />
            <DateField
              label={t("Ends")}
              value={endsAt}
              onValueChange={setEndsAt}
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
                      id: undefined,
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
                disabled={
                  savePeriods.isPending ||
                  periodDraftProblems(drafts, { startsAt, endsAt }).length > 0
                }
                onClick={() =>
                  savePeriods.mutate({
                    yearId: yearId as string,
                    periods: drafts.map((draft) => ({
                      periodId: draft.id,
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
          <PeriodDraftEditor
            value={drafts}
            onChange={setDrafts}
            year={{ startsAt, endsAt }}
            allowAdd={false}
          />
        </SettingsSection>

        <SettingsSection
          title={t("School years")}
          description={t(
            "Reorder the picker, archive years you no longer use, or permanently remove one after checking its contents."
          )}
          footer={
            <Button size="sm" render={<Link href="/onboarding/year/new" />}>
              <PlusIcon className="size-4" />
              {t("Add a year")}
            </Button>
          }
        >
          <SortableList
            ids={years.map((item) => item.id)}
            onReorder={reorderYearList}
          >
            {years.map((item) => {
              const isCurrent = item.id === yearId
              const isArchived = Boolean(item.archivedAt)
              const canArchive = isArchived || activeYearCount > 1

              return (
                <SortableRow
                  key={item.id}
                  id={item.id}
                  as="div"
                  disabled={reorderYears.isPending}
                  className="flex min-h-16 items-center gap-2 border-b px-1 py-3 last:border-b-0"
                >
                  <DragHandle />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.name}
                      {isCurrent ? (
                        <span className="ml-2 text-xs font-normal text-primary">
                          {t("Current")}
                        </span>
                      ) : null}
                      {isArchived ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t("Archived")}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {format.dateTime(new Date(item.startsAt), {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {" → "}
                      {format.dateTime(new Date(item.endsAt), {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!canArchive || archiveYear.isPending}
                    aria-label={
                      isArchived
                        ? t("Restore {name}", { name: item.name })
                        : t("Archive {name}", { name: item.name })
                    }
                    onClick={() =>
                      archiveYear.mutate({
                        yearId: item.id,
                        archived: !isArchived,
                      })
                    }
                  >
                    {isArchived ? (
                      <ArchiveRestoreIcon className="size-4" />
                    ) : (
                      <ArchiveIcon className="size-4" />
                    )}
                  </Button>
                  {years.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={t("Delete {name}", { name: item.name })}
                      onClick={() => {
                        haptic("warning")
                        setDeletingYearId(item.id)
                      }}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  ) : null}
                </SortableRow>
              )
            })}
          </SortableList>
        </SettingsSection>
      </div>

      <AlertDialog
        open={Boolean(deletingYearId)}
        onOpenChange={(open) => {
          if (!open && !deleteYear.isPending) setDeletingYearId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Delete {name}?", { name: deletingYear?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteContents.isError
                ? t(
                    "The contents could not be checked, so nothing will be deleted. Close this dialog and try again."
                  )
                : deleteContents.data
                  ? t(
                      "This permanently deletes {subjects} subjects, {grades} grades, {periods} periods, {averages} custom averages, {goals} goals, {cards} cards and {recaps} recap records. This cannot be undone.",
                      {
                        subjects: String(deleteContents.data.subjects),
                        grades: String(deleteContents.data.grades),
                        periods: String(deleteContents.data.periods),
                        averages: String(deleteContents.data.averages),
                        goals: String(deleteContents.data.goals),
                        cards: String(deleteContents.data.cards),
                        recaps: String(deleteContents.data.recaps),
                      }
                    )
                  : t("Checking what belongs to this year…")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteYear.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                !deletingYearId ||
                deleteContents.isLoading ||
                deleteContents.isError ||
                deleteYear.isPending
              }
              onClick={() => {
                if (deletingYearId) {
                  deleteYear.mutate({ yearId: deletingYearId })
                }
              }}
            >
              {deleteYear.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <Trash2Icon className="size-4" />
              )}
              {t("Delete permanently")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
