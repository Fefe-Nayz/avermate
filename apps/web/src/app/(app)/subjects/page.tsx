"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  ChevronRightIcon,
  ListOrderedIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { resolveCustomAverage, type Subject } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { PeriodRail, PeriodSwitcher } from "@/components/shell/period-switcher"
import {
  AverageValue,
  CoefficientBadge,
  DeltaValue,
} from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import {
  DragHandle,
  SortableDropTarget,
  SortableGroup,
  SortableRoot,
  SortableRow,
} from "@/components/ui/sortable-list"
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"

/**
 * The subject tree.
 *
 * Indentation carries the hierarchy and a category is drawn as a heading
 * rather than a row with a number, so the shape of someone's year is legible
 * before they read a single average.
 */
export default function SubjectsPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { customAverages, graph, subjects, yearId } = useYear()
  const [query, setQuery] = useState("")
  const [reordering, setReordering] = useState(false)
  const snapshotKey = orpc.snapshot.get.queryKey({
    input: { yearId: yearId ?? "" },
  })

  const general = graph.ratio(null)
  const averageRows = useMemo(
    () =>
      customAverages.map((average) => {
        const resolved = resolveCustomAverage(graph, average)
        return {
          ...average,
          ratio: resolved.graph.ratio(null, resolved.scope),
        }
      }),
    [customAverages, graph]
  )

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle) {
      return subjects
        .filter((subject) =>
          `${subject.name} ${subject.shortName ?? ""}`
            .toLowerCase()
            .includes(needle)
        )
        .map((subject) => ({ subject, depth: 0 }))
    }
    return graph
      .flatten()
      .map((subject) => ({ subject, depth: graph.depthOf(subject.id) }))
  }, [graph, subjects, query])

  const move = useMutation({
    ...orpc.subjects.move.mutationOptions(),
    onMutate: async ({ parentId, siblingIds }) => {
      await queryClient.cancelQueries({ queryKey: snapshotKey })
      const previous = queryClient.getQueryData(snapshotKey)

      if (previous) {
        const order = new Map(siblingIds.map((id, index) => [id, index]))
        queryClient.setQueryData(snapshotKey, {
          ...previous,
          subjects: previous.subjects.map((subject) => {
            const sortOrder = order.get(subject.id)
            return subject.parentId === parentId && sortOrder !== undefined
              ? { ...subject, sortOrder }
              : subject
          }),
        })
      }

      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(snapshotKey, context.previous)
      }
      haptic("error")
      toast.error(error.message || t("The subject could not be saved."))
    },
    onSuccess: () => {
      void invalidateAnnouncementAudience(queryClient)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: snapshotKey })
    },
  })

  /**
   * Subjects are a tree, so an order is only meaningful among siblings —
   * dropping Maths between two of English's children would be asking to change
   * the hierarchy, which is what the edit screen is for. Each level of the
   * tree gets its own sortable group, and a drag can never leave it.
   */
  const reorderSiblings = (
    subjectId: string,
    parentId: string | null,
    siblingIds: string[]
  ) => {
    if (move.isPending) return
    // `subjectId` is the subject the server reparents; the rest of the list
    // only gets a new sort order. Since a reorder never changes the parent,
    // passing any sibling would work — but naming the one that actually moved
    // is what makes the request readable in a log.
    move.mutate({ subjectId, parentId, siblingIds })
  }

  return (
    <>
      <PageMeta title={t("Subjects")} />
      <PageActions>
        {subjects.length > 1 ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={reordering ? t("Done") : t("Reorder subjects")}
            onClick={() => {
              haptic("light")
              setQuery("")
              setReordering((current) => !current)
            }}
          >
            {reordering ? (
              <CheckIcon className="size-5" />
            ) : (
              <ListOrderedIcon className="size-5" />
            )}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Add subject")}
          render={<Link href="/subjects/new" />}
        >
          <PlusIcon className="size-5" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Subjects")}
          </h1>
          <div className="flex items-center gap-2">
            <PeriodSwitcher />
            {subjects.length > 1 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  haptic("light")
                  setQuery("")
                  setReordering((current) => !current)
                }}
              >
                {reordering ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <ListOrderedIcon className="size-4" />
                )}
                {reordering ? t("Done") : t("Reorder")}
              </Button>
            ) : null}
            <Button size="sm" render={<Link href="/subjects/new" />}>
              <PlusIcon className="size-4" />
              {t("Add subject")}
            </Button>
          </div>
        </div>

        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>

        {/*
         * The tree is the page; the year's figures are its summary. Side by
         * side above `@4xl`, stacked below it — with the summary first on a
         * phone, where the general average is the one thing worth seeing
         * without scrolling.
         */}
        <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_19rem] @4xl/main:items-start">
          <aside className="flex flex-col gap-4 @4xl/main:order-2">
            <Link
              href="/averages/general"
              className="group flex flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <span className="flex items-center gap-2 text-xs tracking-wide text-muted-foreground uppercase">
                {t("General average")}
                <ChevronRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
              <AverageValue
                ratio={general}
                showScale
                colored
                className="text-4xl font-semibold tracking-tight"
              />
              <span className="text-xs text-muted-foreground">
                {t("{count} subjects", { count: String(subjects.length) })}
              </span>
            </Link>

            {averageRows.length > 0 ? (
              <section aria-labelledby="custom-averages-heading">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2
                    id="custom-averages-heading"
                    className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    {t("Custom averages")}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    render={<Link href="/settings/averages" />}
                  >
                    {t("Edit")}
                  </Button>
                </div>
                <ul className="overflow-hidden rounded-xl border bg-card">
                  {averageRows.map((average, index) => (
                    <li
                      key={average.id}
                      className={cn(index > 0 && "border-t")}
                    >
                      <Link
                        href={`/averages/${average.id}`}
                        className="flex min-h-13 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/60 active:bg-accent"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {average.name}
                          </span>
                          {average.isMain ? (
                            <StarIcon
                              aria-label={t("Headline average")}
                              className="size-3.5 shrink-0 fill-primary/20 text-primary"
                            />
                          ) : null}
                        </span>
                        <AverageValue
                          ratio={average.ratio}
                          colored
                          decimals={2}
                          className="text-base font-medium"
                        />
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>

          <div className="flex min-w-0 flex-col gap-4 @4xl/main:order-1">
            {subjects.length > 6 && !reordering ? (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Search subjects…")}
                  className="h-11 pl-9 md:h-9"
                />
              </div>
            ) : null}

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {query
                    ? t("No subject matches.")
                    : t("This year has no subjects yet.")}
                </p>
                {!query ? (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {yearId ? (
                      <Button
                        size="sm"
                        render={
                          <Link
                            href={`/onboarding/year/${encodeURIComponent(yearId)}?step=subjects`}
                          />
                        }
                      >
                        <SparklesIcon className="size-4" />
                        {t("Set up subjects")}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href="/subjects/new" />}
                    >
                      <PlusIcon className="size-4" />
                      {t("Add manually")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : reordering ? (
              <SortableRoot
                ids={graph.flatten().map((subject) => subject.id)}
                disabled={move.isPending}
                restrictToParent={false}
                onDrop={(activeId, overId) => {
                  const active = graph.byId(activeId)
                  const over = graph.byId(overId)
                  // A drop that crosses levels is not a reorder; ignore it
                  // rather than silently rehoming a subject.
                  if (!active || !over || active.parentId !== over.parentId) {
                    return
                  }
                  const siblings = graph
                    .flatten()
                    .filter((item) => item.parentId === active.parentId)
                    .map((item) => item.id)
                  const from = siblings.indexOf(activeId)
                  const to = siblings.indexOf(overId)
                  if (from < 0 || to < 0) return
                  const next = [...siblings]
                  next.splice(to, 0, ...next.splice(from, 1))
                  reorderSiblings(activeId, active.parentId, next)
                }}
              >
                <div className="rounded-xl border bg-card">
                  <SubjectOrderLevel
                    parentId={null}
                    depth={0}
                    subjects={graph.flatten()}
                    pending={move.isPending}
                  />
                </div>
              </SortableRoot>
            ) : (
              <ul className="overflow-hidden rounded-xl border bg-card">
                {rows.map(({ subject, depth }, index) => (
                  <SubjectRow
                    key={subject.id}
                    subject={subject}
                    depth={depth}
                    general={general}
                    first={index === 0}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * One level of the tree, draggable.
 *
 * Rendered recursively so a subject's children stay inside their own sortable
 * group: dragging within a level reorders it, and there is no way to express
 * "move this under a different parent" by accident. That change belongs to the
 * edit screen, where it is a deliberate choice rather than a slip of the wrist.
 */
function SubjectOrderLevel({
  parentId,
  depth,
  subjects,
  pending,
}: {
  parentId: string | null
  depth: number
  subjects: Subject[]
  pending: boolean
}) {
  const t = useExtracted()
  const siblings = subjects.filter((item) => item.parentId === parentId)
  if (siblings.length === 0) return null

  return (
    <SortableGroup ids={siblings.map((item) => item.id)}>
      {siblings.map((subject) => (
        <SortableRow
          key={subject.id}
          id={subject.id}
          as="div"
          disabled={pending}
          separateDropTarget
        >
          <SortableDropTarget
            className="flex min-h-13 items-center gap-2 border-b py-2 pe-3"
            style={{ paddingInlineStart: `${0.5 + depth * 1}rem` }}
          >
            <DragHandle />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{subject.name}</p>
              <p className="text-xs text-muted-foreground">
                {subject.parentId ? t("Nested subject") : t("Top level")}
              </p>
            </div>
          </SortableDropTarget>
          <SubjectOrderLevel
            parentId={subject.id}
            depth={depth + 1}
            subjects={subjects}
            pending={pending}
          />
        </SortableRow>
      ))}
    </SortableGroup>
  )
}

function SubjectRow({
  subject,
  depth,
  general,
  first,
}: {
  subject: Subject
  depth: number
  general: number | null
  first: boolean
}) {
  const t = useExtracted()
  const { graph } = useYear()
  const ratio = graph.ratio(subject.id)
  const isCategory = subject.kind === "category"
  const gradeCount = graph.allGrades(subject.id).length

  return (
    <li className={cn(!first && "border-t")}>
      <Link
        href={`/subjects/${subject.id}`}
        style={{ paddingInlineStart: `${0.75 + depth * 1}rem` }}
        className={cn(
          "flex min-h-13 items-center gap-3 py-2.5 pe-3 transition-colors hover:bg-accent/60 active:bg-accent",
          isCategory && "bg-muted/40"
        )}
      >
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate",
              isCategory
                ? "text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                : "text-sm font-medium"
            )}
          >
            {subject.name}
          </p>
          {!isCategory && gradeCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {gradeCount === 1
                ? t("1 grade")
                : t("{count} grades", { count: String(gradeCount) })}
            </p>
          ) : null}
        </div>

        {!isCategory ? (
          <CoefficientBadge coefficient={subject.coefficient} />
        ) : null}

        <div className="flex flex-col items-end">
          <AverageValue
            ratio={ratio}
            colored
            decimals={2}
            className={cn(isCategory ? "text-sm" : "text-base font-medium")}
          />
          {ratio !== null && general !== null && !isCategory ? (
            <DeltaValue delta={ratio - general} className="text-[11px]" />
          ) : null}
        </div>

        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
      </Link>
    </li>
  )
}
