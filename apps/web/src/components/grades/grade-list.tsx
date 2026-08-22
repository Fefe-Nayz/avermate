"use client"

import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { gradeRatio, type Grade } from "@avermate/core"
import { CoefficientBadge, ResultBadge } from "@/components/data/value"
import { Card, CardContent } from "@/components/ui/card"
import { useYear } from "@/components/year/year-provider"

/**
 * A row in one of the app's lists.
 *
 * The measurements rather than the behaviour, so a list of readings that go nowhere
 * sits at the same rhythm as one that navigates — same height, same gutters, same
 * gap — without pretending to be clickable. Every list in the app shares a card with
 * no padding of its own and a `divide-y` between rows; this is the row.
 */
export const listRowClassName = "flex min-h-12 items-center gap-3 px-4 py-2.5"

/** The same row, for the lists whose rows are links. */
export const gradeListItemClassName = `${listRowClassName} transition-colors hover:bg-accent/60 active:bg-accent`

/**
 * The shared grade list used on the dashboard and the grades timeline.
 * Keeping the complete card here prevents the two high-traffic lists from
 * drifting apart again.
 */
export function GradeList({ grades }: { grades: readonly Grade[] }) {
  const t = useExtracted()
  const format = useFormatter()
  const { graph } = useYear()

  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <ul className="divide-y">
          {grades.map((grade) => {
            const subject = graph.byId(grade.subjectId)

            return (
              <li key={grade.id}>
                <Link
                  href={`/grades/${grade.id}`}
                  className={gradeListItemClassName}
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
                  {/* The badge beside this reads the mark with its bonus in it, so a
                      paper worth 14 shows 15 and the row would otherwise disagree with
                      itself. Small and quiet: it is an annotation on the figure, not a
                      second figure. */}
                  {grade.bonus ? (
                    <span
                      className="numeric shrink-0 text-xs text-muted-foreground"
                      title={t("Bonus points")}
                    >
                      {format.number(grade.bonus, {
                        signDisplay: "always",
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  ) : null}
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
