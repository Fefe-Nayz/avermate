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
export function HierarchicalGradeTable({ query }: { query: string }) {
  const t = useExtracted()
  const { customAverages, graph } = useYear()
  const needle = query.trim().toLocaleLowerCase()
  const rows = graph.flatten().filter((subject) => {
    if (!needle) return true
    return (
      subject.name.toLocaleLowerCase().includes(needle) ||
      subject.grades.some((grade) =>
        grade.name.toLocaleLowerCase().includes(needle)
      )
    )
  })

  // Resolved once for both arrangements, so neither can drift from the other.
  const lines = rows.flatMap((subject) => {
    const resolved = graph.byId(subject.id)
    if (!resolved) return []
    return [
      {
        subject: resolved,
        depth: graph.depthOf(subject.id),
        ratio: graph.ratio(subject.id),
      },
    ]
  })

  const averages = [
    {
      id: "general",
      href: "/averages/general",
      name: t("General average"),
      ratio: graph.ratio(null),
    },
    ...customAverages.map((average) => {
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
        {lines.map(({ subject, depth, ratio }) => (
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
            {subject.grades.length > 0 ? (
              <div style={{ paddingInlineStart: indent(depth) }}>
                <GradeBadges grades={subject.grades} />
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
            {lines.map(({ subject, depth, ratio }) => (
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
                    {subject.grades.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <GradeBadges grades={subject.grades} />
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

function GradeBadges({ grades }: { grades: readonly Grade[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[...grades]
        .sort(
          (left, right) => right.passedAt.getTime() - left.passedAt.getTime()
        )
        .map((grade) => (
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
