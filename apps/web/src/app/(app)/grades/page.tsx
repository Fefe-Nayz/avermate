"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowDownUpIcon, PlusIcon, SearchIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { gradeRatio } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { PeriodRail, PeriodSwitcher } from "@/components/shell/period-switcher"
import { CoefficientBadge, ResultBadge } from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"

type SortKey = "date" | "result" | "subject"

/**
 * Every result in the period, grouped by month.
 *
 * Grouping by month rather than paginating is deliberate: a school year has a
 * rhythm, and seeing "October" as a heading tells you more about a run of
 * results than a page number ever would.
 */
export default function GradesPage() {
  const t = useExtracted()
  const format = useFormatter()
  const { graph } = useYear()
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("date")

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let grades = graph.allGrades()

    if (needle) {
      grades = grades.filter((grade) =>
        `${grade.name} ${graph.byId(grade.subjectId)?.name ?? ""}`
          .toLowerCase()
          .includes(needle)
      )
    }

    if (sort === "result") {
      grades = [...grades].sort(
        (a, b) => (gradeRatio(b) ?? -1) - (gradeRatio(a) ?? -1)
      )
    } else if (sort === "subject") {
      grades = [...grades].sort((a, b) =>
        (graph.byId(a.subjectId)?.name ?? "").localeCompare(
          graph.byId(b.subjectId)?.name ?? ""
        )
      )
    } else {
      grades = [...grades].reverse()
    }

    if (sort !== "date") {
      return [{ key: "all", label: null, grades }]
    }

    const byMonth = new Map<string, typeof grades>()
    for (const grade of grades) {
      const key = `${grade.passedAt.getFullYear()}-${grade.passedAt.getMonth()}`
      const list = byMonth.get(key)
      if (list) list.push(grade)
      else byMonth.set(key, [grade])
    }

    return [...byMonth.entries()].map(([key, list]) => ({
      key,
      label: format.dateTime(list[0]?.passedAt ?? new Date(), {
        month: "long",
        year: "numeric",
      }),
      grades: list,
    }))
  }, [graph, query, sort, format])

  const total = groups.reduce((sum, group) => sum + group.grades.length, 0)

  return (
    <>
      <PageMeta
        title={t("Grades")}
        subtitle={t("{count} results", { count: String(total) })}
      />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Add grade")}
          render={<Link href="/grades/new" />}
        >
          <PlusIcon className="size-5" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Grades")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("{count} results", { count: String(total) })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodSwitcher />
            <Button size="sm" render={<Link href="/grades/new" />}>
              <PlusIcon className="size-4" />
              {t("Add grade")}
            </Button>
          </div>
        </div>

        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search grades…")}
              className="h-11 pl-9 md:h-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("Sort")}
                  className="h-11 md:h-9 md:w-9"
                />
              }
            >
              <ArrowDownUpIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => {
                  haptic("selection")
                  setSort(value as SortKey)
                }}
              >
                {/* Inside the radio group, so it labels it rather than
                    floating above as a heading with nothing attached. */}
                <DropdownMenuLabel>{t("Sort by")}</DropdownMenuLabel>
                <DropdownMenuRadioItem value="date">
                  {t("Most recent")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="result">
                  {t("Best result")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="subject">
                  {t("Subject")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {total === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {query
                ? t("No grade matches.")
                : t("Nothing recorded in this period yet.")}
            </p>
            {!query ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                render={<Link href="/grades/new" />}
              >
                <PlusIcon className="size-4" />
                {t("Add your first grade")}
              </Button>
            ) : null}
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-1.5">
              {group.label ? (
                <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </h2>
              ) : null}
              <ul className="overflow-hidden rounded-xl border bg-card">
                {group.grades.map((grade, index) => (
                  <li
                    key={grade.id}
                    className={index > 0 ? "border-t" : undefined}
                  >
                    <Link
                      href={`/grades/${grade.id}`}
                      className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/60 active:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {grade.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {graph.byId(grade.subjectId)?.name}
                          {" · "}
                          {format.dateTime(grade.passedAt, {
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </div>
                      <CoefficientBadge coefficient={grade.coefficient} />
                      <ResultBadge ratio={gradeRatio(grade)} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  )
}
