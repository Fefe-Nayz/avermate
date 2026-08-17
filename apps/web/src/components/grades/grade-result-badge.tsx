"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useFormatter, useLocale, useExtracted } from "next-intl"
import {
  formatPoints,
  gradeImpact,
  gradeRatio,
  periodAt,
  type Grade,
  type Period,
} from "@avermate/core"
import {
  CoefficientBadge,
  DeltaValue,
  PointsValue,
  ResultBadge,
} from "@/components/data/value"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { useYear } from "@/components/year/year-provider"
import { cn } from "@/lib/utils"

export function gradePeriod(
  grade: Pick<Grade, "periodId" | "passedAt">,
  periods: readonly Period[]
): Period | null {
  return (
    periods.find((period) => period.id === grade.periodId) ??
    periodAt(periods, grade.passedAt)
  )
}

/** A compact result that previews the underlying grade on hover or focus. */
export function GradeResultBadge({
  grade,
  className,
  showResultSummary = true,
}: {
  grade: Grade
  className?: string
  showResultSummary?: boolean
}) {
  const t = useExtracted()
  const locale = useLocale()
  const format = useFormatter()
  const { graph, periods } = useYear()
  const [open, setOpen] = useState(false)
  const subject = graph.byId(grade.subjectId)
  const period = gradePeriod(grade, periods)
  const ratio = gradeRatio(grade)
  const hasGrade = graph
    .byId(grade.subjectId)
    ?.grades.some((item) => item.id === grade.id)
  const impacts = useMemo(() => {
    if (!open || !hasGrade) return null
    return {
      subject: gradeImpact(graph, grade.id, grade.subjectId),
      general: gradeImpact(graph, grade.id, null),
    }
  }, [grade.id, grade.subjectId, graph, hasGrade, open])
  const accessibleResult = formatPoints(grade.value, grade.outOf, { locale })
  /**
   * The weight belongs in the name too, not only in the chip.
   *
   * A screen reader gets the badge as one link; `×3` beside it would either be
   * read as a stray symbol or skipped, so the weight is said in words — and only
   * when there is one to say, matching what the chip decides to draw.
   */
  const accessibleLabel =
    grade.coefficient === 1
      ? `${grade.name}: ${accessibleResult}`
      : `${grade.name}: ${accessibleResult}, ${t("Weight")} ${grade.coefficient.toLocaleString(
          locale,
          { maximumFractionDigits: 2 }
        )}`

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        delay={350}
        closeDelay={200}
        render={
          <Link
            href={`/grades/${grade.id}`}
            aria-label={accessibleLabel}
            className={cn(
              "inline-flex items-center gap-1 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              className
            )}
          />
        }
      >
        <ResultBadge ratio={ratio} />
        {/* The weight, on the badge rather than only inside the hover card.
            A row of grades is what explains the average beside it, and a 15/20
            counting three times explains it very differently from one counting
            once — a reader following a subject's average could not see which was
            which without opening every grade in turn. On touch that hover card
            is a deliberate long press, so on a phone the weight was effectively
            not there at all.

            `CoefficientBadge` draws nothing at a coefficient of one, which is
            most grades: the ordinary row is unchanged and only the grades that
            actually pull on the average announce themselves. */}
        <CoefficientBadge coefficient={grade.coefficient} />
      </HoverCardTrigger>

      <HoverCardContent
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="max-h-(--available-height) w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain p-0"
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug text-muted-foreground">
                {subject?.name ?? t("Subject")}
                {period ? ` · ${period.name}` : ""}
              </p>
              <p className="mt-0.5 text-base leading-snug font-semibold break-words">
                {grade.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {format.dateTime(grade.passedAt, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
            <ResultBadge ratio={ratio} className="shrink-0 text-base" />
          </div>

          {showResultSummary ? (
            <dl
              className={cn(
                "grid gap-2 rounded-md bg-muted/45 p-2.5",
                "grid-cols-2"
              )}
            >
              <div className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">
                  {t("Result")}
                </dt>
                <dd className="mt-0.5 text-sm font-medium">
                  <PointsValue value={grade.value} outOf={grade.outOf} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">
                  {t("Weight")}
                </dt>
                <dd className="mt-0.5">
                  <CoefficientBadge
                    coefficient={grade.coefficient}
                    showWhenOne
                  />
                </dd>
              </div>
            </dl>
          ) : (
            <div className="flex min-h-7 items-center justify-between gap-2 rounded-md bg-muted/45 p-2.5 text-xs">
              <span className="text-muted-foreground">{t("Weight")}</span>
              <span className="min-w-0">
                <CoefficientBadge coefficient={grade.coefficient} showWhenOne />
              </span>
            </div>
          )}

          {/* Before the impact, for the same reason as on the grade's own page:
              a composite mark's parts describe what the mark *is*, and the impact
              describes what it did. Describe first. */}
          {grade.components.length > 0 ? (
            <section className="border-t pt-3">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t("What it is made of")}
              </h3>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {grade.components.slice(0, 4).map((component) => (
                  <li
                    key={component.id}
                    className="flex min-w-0 items-start gap-2 text-xs"
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {component.name}
                    </span>
                    {/* The badge, not `×3 · ` written out by hand. It was the one
                        place in the app that spelled a weight itself instead of
                        using the component made for it — so it had its own
                        separator, its own rounding, and no way to pick up a change
                        the badge makes. `CoefficientBadge` draws nothing at a
                        weight of one, which is what the conditional here was for. */}
                    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                      <CoefficientBadge coefficient={component.coefficient} />
                      <PointsValue
                        value={component.value}
                        outOf={component.outOf}
                      />
                    </span>
                  </li>
                ))}
                {grade.components.length > 4 ? (
                  <li className="text-xs text-muted-foreground">
                    {t("+{count} more", {
                      count: String(grade.components.length - 4),
                    })}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {impacts &&
          (impacts.subject.delta !== null || impacts.general.delta !== null) ? (
            <section className="border-t pt-3">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t("Impact on averages")}
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <p className="text-xs break-words text-muted-foreground">
                    {subject?.name ?? t("Subject")}
                  </p>
                  <DeltaValue
                    delta={impacts.subject.delta}
                    className="mt-0.5 block text-sm font-semibold"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {t("General average")}
                  </p>
                  <DeltaValue
                    delta={impacts.general.delta}
                    className="mt-0.5 block text-sm font-semibold"
                  />
                </div>
              </div>
            </section>
          ) : null}

          {grade.note ? (
            <section className="border-t pt-3">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t("Note")}
              </h3>
              <p className="mt-1 line-clamp-4 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                {grade.note}
              </p>
            </section>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
