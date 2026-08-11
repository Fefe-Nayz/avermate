"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  ListOrderedIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
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
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

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
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      }),
  })

  const moveSubject = (subject: Subject, direction: -1 | 1) => {
    const siblings = graph
      .flatten()
      .filter((item) => item.parentId === subject.parentId)
    const index = siblings.findIndex((item) => item.id === subject.id)
    const destination = index + direction
    if (
      index < 0 ||
      destination < 0 ||
      destination >= siblings.length ||
      move.isPending
    ) {
      return
    }
    const siblingIds = siblings.map((item) => item.id)
    ;[siblingIds[index], siblingIds[destination]] = [
      siblingIds[destination],
      siblingIds[index],
    ]
    haptic("selection")
    move.mutate({
      subjectId: subject.id,
      parentId: subject.parentId,
      siblingIds,
    })
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

        <Link
          href="/averages/general"
          className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent/60 active:bg-accent"
        >
          <div>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("General average")}
            </p>
            <AverageValue
              ratio={general}
              showScale
              colored
              className="text-2xl font-semibold"
            />
          </div>
          <div className="flex items-center gap-2">
            <p className="text-right text-xs text-muted-foreground">
              {t("{count} subjects", { count: String(subjects.length) })}
            </p>
            <ChevronRightIcon className="size-4 text-muted-foreground/60" />
          </div>
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
                <li key={average.id} className={cn(index > 0 && "border-t")}>
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
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                render={<Link href="/subjects/new" />}
              >
                <PlusIcon className="size-4" />
                {t("Add your first subject")}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {rows.map(({ subject, depth }, index) =>
              reordering ? (
                <SubjectOrderRow
                  key={subject.id}
                  subject={subject}
                  depth={depth}
                  first={index === 0}
                  allSubjects={graph.flatten()}
                  pending={move.isPending}
                  onMove={moveSubject}
                />
              ) : (
                <SubjectRow
                  key={subject.id}
                  subject={subject}
                  depth={depth}
                  general={general}
                  first={index === 0}
                />
              )
            )}
          </ul>
        )}
      </div>
    </>
  )
}

function SubjectOrderRow({
  subject,
  depth,
  first,
  allSubjects,
  pending,
  onMove,
}: {
  subject: Subject
  depth: number
  first: boolean
  allSubjects: Subject[]
  pending: boolean
  onMove: (subject: Subject, direction: -1 | 1) => void
}) {
  const t = useExtracted()
  const siblings = allSubjects.filter(
    (item) => item.parentId === subject.parentId
  )
  const position = siblings.findIndex((item) => item.id === subject.id)

  return (
    <li
      className={cn(
        "flex min-h-13 items-center gap-3 py-2 pe-3",
        !first && "border-t"
      )}
      style={{ paddingInlineStart: `${0.75 + depth * 1}rem` }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{subject.name}</p>
        <p className="text-xs text-muted-foreground">
          {subject.parentId ? t("Nested subject") : t("Top level")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("Move up")}
        disabled={pending || position <= 0}
        onClick={() => onMove(subject, -1)}
      >
        <ArrowUpIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("Move down")}
        disabled={pending || position < 0 || position === siblings.length - 1}
        onClick={() => onMove(subject, 1)}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    </li>
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
