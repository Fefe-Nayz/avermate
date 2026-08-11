"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import type { Subject } from "@avermate/core"
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

/**
 * The subject tree.
 *
 * Indentation carries the hierarchy and a category is drawn as a heading
 * rather than a row with a number, so the shape of someone's year is legible
 * before they read a single average.
 */
export default function SubjectsPage() {
  const t = useExtracted()
  const { graph, subjects } = useYear()
  const [query, setQuery] = useState("")

  const general = graph.ratio(null)

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

  return (
    <>
      <PageMeta title={t("Subjects")} />
      <PageActions>
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
            <Button size="sm" render={<Link href="/subjects/new" />}>
              <PlusIcon className="size-4" />
              {t("Add subject")}
            </Button>
          </div>
        </div>

        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
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
          <p className="text-right text-xs text-muted-foreground">
            {t("{count} subjects", { count: String(subjects.length) })}
          </p>
        </div>

        {subjects.length > 6 ? (
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
    </>
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
