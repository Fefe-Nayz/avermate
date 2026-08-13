"use client"

import Link from "next/link"
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { gradeRatio } from "@avermate/core"
import { Card, CardContent } from "@/components/ui/card"
import { ResultBadge, CoefficientBadge } from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"

/** The last few results, newest first — the app's most-checked list. */
export function RecentGrades({ limit = 6 }: { limit?: number }) {
  const t = useExtracted()
  const format = useFormatter()
  const { graph } = useYear()

  const grades = graph.allGrades().slice(-limit).reverse()
  if (grades.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("Latest results")}</h2>
        <Link
          href="/grades"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("See all")}
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>

      <Card className="py-2">
        <CardContent className="px-2">
          <ul>
            {grades.map((grade) => {
              const subject = graph.byId(grade.subjectId)
              return (
                <li key={grade.id}>
                  <Link
                    href={`/grades/${grade.id}`}
                    className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent active:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {grade.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {subject?.name}
                        {" · "}
                        {format.dateTime(grade.passedAt, {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    </div>
                    <CoefficientBadge coefficient={grade.coefficient} />
                    <ResultBadge ratio={gradeRatio(grade)} />
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
