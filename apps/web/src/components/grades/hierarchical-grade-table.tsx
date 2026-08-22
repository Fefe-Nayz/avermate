"use client"

import Link from "next/link"
import {
  resolveCustomAverage,
  type Grade,
  type SubjectGraph,
} from "@avermate/core"
import { ChevronRightIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { AverageValue, CoefficientBadge } from "@/components/data/value"
import { GradeResultBadge } from "@/components/grades/grade-result-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useYear } from "@/components/year/year-provider"
import { cn } from "@/lib/utils"
import { gradeTableRows, type GradeOrder } from "./grade-table-rows"

/**
 * The structural counterpart to the chronological feed: one row per subject,
 * with direct assessments kept in their hierarchy and analytical averages as
 * first-class destinations.
 *
 * Two arrangements of the same rows, because a table is not one of them on a
 * phone. Three columns that each need a usable width — a subject name, a row of
 * grade badges, an average — come to 560px before anything is drawn, so on a
 * 375px screen the whole thing scrolled sideways inside its card: the average
 * was off-screen, and reading a subject meant dragging the table back and forth
 * past the column you had just left. Below `md` each subject becomes a stacked
 * row instead — name and average on one line, badges wrapping under them — which
 * is the same information down the one axis a phone already scrolls.
 *
 * The leaves are shared rather than written twice. Only the arrangement differs,
 * and two copies of the content would be two things to keep true.
 */
export function HierarchicalGradeTable({
  query,
  order,
}: {
  query: string
  order: GradeOrder
}) {
  const t = useExtracted()
  const { customAverages, graph, year } = useYear()

  // Resolved once for both arrangements, so neither can drift from the other.
  // Which grades a query is asking about, and in what order, is decided in
  // `gradeTableRows` — rules rather than rendering, and checkable without a
  // browser.
  const lines = gradeTableRows(
    graph.flatten().map((subject) => ({
      subject,
      depth: graph.depthOf(subject.id),
    })),
    { query, order }
  ).map((row) => ({ ...row, ratio: graph.ratio(row.subject.id) }))

  /**
   * The nominated average is not listed twice.
   *
   * When a year reads its general average as one of its custom ones, both rows carry the
   * same figure under two names — and clicking either now opens the same page, since
   * `/averages/general` resolves through the nomination. So the general row takes the
   * name it is actually reading, and the custom row it duplicates drops out. The average
   * itself is untouched: it is still managed from the settings, and still has a page.
   */
  const nominatedId = year?.mainAverageId ?? null
  const nominated = nominatedId
    ? customAverages.find((average) => average.id === nominatedId)
    : undefined

  const averages = [
    {
      id: "general",
      href: "/averages/general",
      name: nominated
        ? t("General average · {name}", { name: nominated.name })
        : t("General average"),
      ratio: graph.ratio(null),
    },
    ...customAverages
      .filter((average) => average.id !== nominatedId)
      .map((average) => {
        const resolved = resolveCustomAverage(graph, average)
        return {
          id: average.id,
          href: `/averages/${average.id}`,
          name: average.name,
          ratio: resolved.graph.ratio(null, resolved.scope),
        }
      }),
  ]

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          {t("No grade matches.")}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="divide-y overflow-hidden rounded-xl border bg-card md:hidden">
        {lines.map(({ subject, depth, ratio, grades }) => (
          <div
            key={subject.id}
            className={cn(
              "flex flex-col gap-1.5 px-3 py-2.5",
              subject.kind === "category" && "bg-muted/25"
            )}
          >
            <div
              className="flex items-center gap-2"
              style={{ paddingInlineStart: indent(depth) }}
            >
              <SubjectLabel subject={subject} />
              <AverageValue
                ratio={ratio}
                showScale
                colored
                animate={false}
                className="ms-auto shrink-0 font-medium"
              />
            </div>
            {grades.length > 0 ? (
              <div style={{ paddingInlineStart: indent(depth) }}>
                <GradeBadges grades={grades} />
              </div>
            ) : null}
          </div>
        ))}
        <div className="divide-y bg-muted/50 font-medium">
          {averages.map((average) => (
            <div
              key={average.id}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <AverageLink href={average.href}>{average.name}</AverageLink>
              <AverageValue
                ratio={average.ratio}
                showScale
                colored
                animate={false}
                className="ms-auto shrink-0 font-semibold"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-48">{t("Subject")}</TableHead>
              <TableHead className="min-w-64">{t("Grades")}</TableHead>
              <TableHead className="w-28 text-right">{t("Average")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map(({ subject, depth, ratio, grades }) => (
              <TableRow
                key={subject.id}
                className={cn(subject.kind === "category" && "bg-muted/25")}
              >
                <TableCell>
                  <div
                    className="flex items-center gap-2"
                    style={{ paddingInlineStart: indent(depth) }}
                  >
                    <SubjectLabel subject={subject} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="min-h-8">
                    {grades.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <GradeBadges grades={grades} />
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <AverageValue
                    ratio={ratio}
                    showScale
                    colored
                    animate={false}
                    className="font-medium"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {averages.map((average) => (
              <TableRow key={average.id}>
                <TableCell colSpan={2}>
                  <AverageLink href={average.href}>{average.name}</AverageLink>
                </TableCell>
                <TableCell className="text-right">
                  <AverageValue
                    ratio={average.ratio}
                    showScale
                    colored
                    animate={false}
                    className="font-semibold"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableFooter>
        </Table>
      </div>
    </>
  )
}

/** Depth as an indent, capped so a deep tree cannot eat the whole column. */
function indent(depth: number): string {
  return `${Math.min(depth, 6) * 0.9}rem`
}

function SubjectLabel({
  subject,
}: {
  subject: ReturnType<SubjectGraph["flatten"]>[number]
}) {
  return (
    <>
      <Link
        href={`/subjects/${subject.id}`}
        className={cn(
          "min-w-0 truncate hover:underline",
          subject.kind === "category"
            ? "text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            : "font-medium"
        )}
      >
        {subject.name}
      </Link>
      <CoefficientBadge coefficient={subject.coefficient} />
    </>
  )
}

/**
 * The badges, in the order they were handed over.
 *
 * They used to sort themselves newest-first, which is why the page's sort control
 * appeared to do nothing in this view: whatever the reader chose, this put it
 * back. The order is the caller's decision now.
 */
function GradeBadges({ grades }: { grades: readonly Grade[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {grades.map((grade) => (
        <GradeResultBadge key={grade.id} grade={grade} />
      ))}
    </div>
  )
}

function AverageLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 min-w-0 items-center gap-1 font-medium hover:underline"
    >
      <span className="truncate">{children}</span>
      <ChevronRightIcon className="size-3.5 shrink-0" />
    </Link>
  )
}
