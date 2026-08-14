"use client"

import Link from "next/link"
import { resolveCustomAverage, type SubjectGraph } from "@avermate/core"
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

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          {t("No grade matches.")}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-48">{t("Subject")}</TableHead>
            <TableHead className="min-w-64">{t("Grades")}</TableHead>
            <TableHead className="w-28 text-right">{t("Average")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((subject) => (
            <SubjectRow key={subject.id} graph={graph} subjectId={subject.id} />
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>
              <Link
                href="/averages/general"
                className="inline-flex min-h-9 items-center gap-1 font-medium hover:underline"
              >
                {t("General average")}
                <ChevronRightIcon className="size-3.5" />
              </Link>
            </TableCell>
            <TableCell className="text-right">
              <AverageValue
                ratio={graph.ratio(null)}
                showScale
                colored
                animate={false}
                className="font-semibold"
              />
            </TableCell>
          </TableRow>
          {customAverages.map((average) => {
            const resolved = resolveCustomAverage(graph, average)
            return (
              <TableRow key={average.id}>
                <TableCell colSpan={2}>
                  <Link
                    href={`/averages/${average.id}`}
                    className="inline-flex min-h-9 items-center gap-1 font-medium hover:underline"
                  >
                    {average.name}
                    <ChevronRightIcon className="size-3.5" />
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <AverageValue
                    ratio={resolved.graph.ratio(null, resolved.scope)}
                    showScale
                    colored
                    animate={false}
                    className="font-semibold"
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableFooter>
      </Table>
    </div>
  )
}

function SubjectRow({
  graph,
  subjectId,
}: {
  graph: SubjectGraph
  subjectId: string
}) {
  const subject = graph.byId(subjectId)
  if (!subject) return null
  const depth = graph.depthOf(subject.id)

  return (
    <TableRow className={cn(subject.kind === "category" && "bg-muted/25")}>
      <TableCell>
        <div
          className="flex items-center gap-2"
          style={{ paddingInlineStart: `${Math.min(depth, 6) * 0.9}rem` }}
        >
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
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {subject.grades.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            [...subject.grades]
              .sort(
                (left, right) =>
                  right.passedAt.getTime() - left.passedAt.getTime()
              )
              .map((grade) => <GradeResultBadge key={grade.id} grade={grade} />)
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <AverageValue
          ratio={graph.ratio(subject.id)}
          showScale
          colored
          animate={false}
          className="font-medium"
        />
      </TableCell>
    </TableRow>
  )
}
