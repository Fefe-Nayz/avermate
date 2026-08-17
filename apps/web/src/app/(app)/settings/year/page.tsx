"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronRightIcon,
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
  sortableListClassName,
  sortableRowClassName,
  sortableRowLinkClassName,
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
import { SettingsSection } from "@/components/settings/settings-section"
import { DateField, NumberField, TextField } from "@/components/forms/controls"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { dateInputValue } from "@/lib/period-drafts"

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

  /**
   * The order, saved the moment it changes.
   *
   * Its own mutation rather than part of a pending draft: reordering is a thing you
   * *did*, and every other list in the app treats it that way — there was no reason
   * for periods to make it something you then had to remember to save.
   */
  const reorderPeriods = useMutation({
    ...orpc.periods.reorder.mutationOptions(),
    onSuccess: () => {
      void invalidate()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The periods could not be reordered."))
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
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/settings/year/periods/new" />}
            >
              <PlusIcon className="size-4" />
              {t("Add a period")}
            </Button>
          }
        >
          {/* Summaries that open their own form, and a drag that saves itself.
              This section used to be a column of open forms over one "Save periods"
              button that replaced the whole set at once — the only object in the app
              edited that way, and the only list whose order was part of a pending
              draft rather than a thing you did. A period is now created, edited and
              deleted like everything else: on a route, through `FormFlow`, which is
              all the fields at once on a laptop and one decision per screen on a
              phone. The wizards keep their in-place editor, because their periods are
              unsaved drafts in wizard state and no route can reach those. */}
          {periods.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t("No periods — the whole year counts as one.")}
            </p>
          ) : (
            <SortableList
              ids={periods.map((period) => period.id)}
              onReorder={(periodIds) => {
                haptic("light")
                reorderPeriods.mutate({ periodIds })
              }}
              disabled={reorderPeriods.isPending}
            >
              <ul className={sortableListClassName}>
                {periods.map((period, index) => (
                  <SortableRow
                    key={period.id}
                    id={period.id}
                    disabled={reorderPeriods.isPending}
                    className={sortableRowClassName(index)}
                  >
                    <DragHandle className="ml-1.5" />
                    <Link
                      href={`/settings/year/periods/${period.id}`}
                      className={sortableRowLinkClassName}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {period.name}
                        </span>
                        <span className="numeric block truncate text-xs text-muted-foreground">
                          {format.dateTime(new Date(period.startAt), {
                            day: "numeric",
                            month: "short",
                          })}
                          {" → "}
                          {format.dateTime(new Date(period.endAt), {
                            day: "numeric",
                            month: "short",
                          })}
                          {period.isCumulative ? ` · ${t("Cumulative")}` : ""}
                        </span>
                      </span>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                    </Link>
                  </SortableRow>
                ))}
              </ul>
            </SortableList>
          )}
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
          {/* The app's sortable list, the same object as the custom averages, the
              goals and the sidebar settings. This was a fourth set of numbers —
              `min-h-16`, `px-1`, `border-b` with a `last:` exception, and a grip
              with no gutter — for the same thing those three already are. */}
          <SortableList
            ids={years.map((item) => item.id)}
            onReorder={reorderYearList}
          >
            <ul className={sortableListClassName}>
              {years.map((item, index) => {
                const isCurrent = item.id === yearId
                const isArchived = Boolean(item.archivedAt)
                const canArchive = isArchived || activeYearCount > 1

                return (
                  <SortableRow
                    key={item.id}
                    id={item.id}
                    disabled={reorderYears.isPending}
                    className={sortableRowClassName(index)}
                  >
                    <DragHandle className="ml-1.5" />
                    {/* A year's row is not a link — it carries its own actions — so
                        it takes the shared measurements without the hover state
                        that would promise somewhere to go. */}
                    <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-3">
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
                    </div>
                  </SortableRow>
                )
              })}
            </ul>
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
