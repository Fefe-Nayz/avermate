"use client"

import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"
import { useFormatter } from "next-intl"
import { gradeRatio, type Grade } from "@avermate/core"
import { CoefficientBadge, ResultBadge } from "@/components/data/value"
import { Card, CardContent } from "@/components/ui/card"
import { useYear } from "@/components/year/year-provider"

/**
 * The shared grade list used on the dashboard and the grades timeline.
 * Keeping the complete card here prevents the two high-traffic lists from
 * drifting apart again.
 */
export function GradeList({ grades }: { grades: readonly Grade[] }) {
  const format = useFormatter()
  const { graph } = useYear()

  return (
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
                    <p className="truncate text-sm font-medium">{grade.name}</p>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                      <span className="min-w-0 truncate font-medium text-foreground/75">
                        {subject?.name}
                      </span>
                      <span
                        aria-hidden
                        className="size-1 shrink-0 rounded-full bg-muted-foreground/45"
                      />
                      <time
                        dateTime={grade.passedAt.toISOString()}
                        className="shrink-0 text-muted-foreground"
                      >
                        {format.dateTime(grade.passedAt, {
                          day: "numeric",
                          month: "short",
                        })}
                      </time>
                    </div>
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
  )
}
