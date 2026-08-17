"use client"

import Link from "next/link"
import { use } from "react"
import { PencilIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { gradeImpact, gradeRatio, resolveCustomAverage } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import {
  AverageValue,
  CoefficientBadge,
  PointsValue,
  ResultBadge,
} from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import { ImpactGrid } from "@/components/analytics/impact-grid"

/**
 * One result, and what it did.
 *
 * The impact figures are the reason this screen exists: a 12/20 means nothing
 * on its own, and everything once you know it pulled the subject down by 0.4
 * and the year by 0.05.
 */
export default function GradePage({
  params,
}: {
  params: Promise<{ gradeId: string }>
}) {
  const { gradeId } = use(params)
  const t = useExtracted()
  const format = useFormatter()
  const { customAverages, graph, scale } = useYear()

  const grade = graph.allGrades().find((item) => item.id === gradeId)

  if (!grade) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Grade not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it sits outside this period.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/grades" />}>
          {t("Back to grades")}
        </Button>
      </Empty>
    )
  }

  const subject = graph.byId(grade.subjectId)
  const ratio = gradeRatio(grade)
  const showOriginalPoints = Math.abs(grade.outOf - scale) > 0.000_001
  const formattedCoefficient = format.number(grade.coefficient, {
    maximumFractionDigits: 2,
  })
  const machineDate = grade.passedAt.toISOString()
  const fullDate = format.dateTime(grade.passedAt, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const impacts = [
    {
      id: `subject:${grade.subjectId}`,
      label: subject?.name ?? t("Subject"),
      href: subject ? `/subjects/${subject.id}` : undefined,
      impact: gradeImpact(graph, gradeId, grade.subjectId),
    },
    ...graph.ancestorsOf(grade.subjectId).map((ancestor) => ({
      id: `subject:${ancestor.id}`,
      label: ancestor.name,
      href: `/subjects/${ancestor.id}`,
      impact: gradeImpact(graph, gradeId, ancestor.id),
    })),
    {
      id: "general",
      label: t("General average"),
      href: "/averages/general",
      impact: gradeImpact(graph, gradeId, null),
    },
    ...customAverages.flatMap((average) => {
      const resolved = resolveCustomAverage(graph, average)
      if (!resolved.graph.has(grade.subjectId)) return []
      return [
        {
          id: `custom:${average.id}`,
          label: average.name,
          href: `/averages/${average.id}`,
          impact: gradeImpact(resolved.graph, gradeId, null, resolved.scope),
        },
      ]
    }),
  ]

  return (
    <>
      <PageMeta
        title={grade.name}
        subtitle={subject?.name ?? t("Subject")}
        backHref="/grades"
      />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Edit")}
          render={<Link href={`/grades/${gradeId}/edit`} />}
        >
          <PencilIcon className="size-4" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {grade.name}
            </h1>
            {subject ? (
              <Link
                href={`/subjects/${subject.id}`}
                className="text-sm text-muted-foreground hover:underline"
              >
                {subject.name}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">{t("Subject")}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/grades/${gradeId}/edit`} />}
          >
            <PencilIcon className="size-4" />
            {t("Edit")}
          </Button>
        </div>

        <section
          className="flex flex-col gap-3 pt-4"
          aria-labelledby="grade-result-title"
        >
          <Card
            data-grade-panel="result"
            className="overflow-hidden rounded-xl border-border/60 bg-card/90 py-0 shadow-sm backdrop-blur-xl"
          >
            <CardContent className="px-0">
              <div className="flex flex-col gap-1 p-4">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("Result")}
                  </p>
                  <h2 id="grade-result-title" className="sr-only">
                    {t("Grade details")}
                  </h2>
                </div>
                <AverageValue
                  ratio={ratio}
                  showScale
                  colored
                  className="w-fit text-3xl font-semibold tracking-tight "
                  animateFromZero
                />
              </div>
            </CardContent>
          </Card>

          <Card
            data-grade-panel="details"
            className="overflow-hidden rounded-xl border-border/60 py-0 shadow-sm"
          >
            <CardContent className="px-0">
              <dl
                className={
                  showOriginalPoints
                    ? "grid divide-y divide-border/70 sm:grid-cols-3 sm:divide-y-0"
                    : "grid divide-y divide-border/70 sm:grid-cols-2 sm:divide-y-0"
                }
              >
                {showOriginalPoints ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:min-h-24 sm:grid-cols-1 sm:content-between sm:border-r sm:px-6 sm:py-5">
                    <dt className="text-xs font-medium text-muted-foreground">
                      {t("Points")}
                    </dt>
                    <dd className="text-base font-semibold">
                      <PointsValue value={grade.value} outOf={grade.outOf} />
                    </dd>
                  </div>
                ) : null}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:min-h-24 sm:grid-cols-1 sm:content-between sm:border-r sm:px-6 sm:py-5">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("Weight")}
                  </dt>
                  <dd className="numeric text-base font-semibold">
                    ×{formattedCoefficient}
                  </dd>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,15rem)] items-center gap-4 px-5 py-4 sm:min-h-24 sm:grid-cols-1 sm:content-between sm:px-6 sm:py-5">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("Date")}
                  </dt>
                  <dd className="text-right text-sm font-medium sm:text-left">
                    <time dateTime={machineDate}>{fullDate}</time>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </section>

        <ImpactGrid readings={impacts} title={t("Impact on averages")} />

        {grade.components.length > 0 || grade.note ? (
          <div
            className={
              grade.components.length > 0 && grade.note
                ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.75fr)]"
                : "grid gap-4"
            }
          >
            {grade.components.length > 0 ? (
              <section aria-labelledby="grade-components-title">
                <Card className="gap-0 rounded-xl border-border/60 py-0 shadow-sm">
                  <CardHeader className="px-5 pt-5 pb-3">
                    <CardTitle
                      id="grade-components-title"
                      className="text-base font-semibold"
                    >
                      {t("What it is made of")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0">
                    <div
                      className="hidden grid-cols-[minmax(0,1fr)_5rem_7rem_6rem] gap-4 border-b bg-muted/35 px-5 py-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:grid"
                      aria-hidden="true"
                    >
                      <span>{t("Part")}</span>
                      <span className="text-right">{t("Weight")}</span>
                      <span className="text-right">{t("Points")}</span>
                      <span className="text-right">{t("Result")}</span>
                    </div>
                    <ul className="divide-y">
                      {grade.components.map((component) => (
                        <li
                          key={component.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_6rem]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {component.name}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                              <PointsValue
                                value={component.value}
                                outOf={component.outOf}
                              />
                              {" · "}
                              <span className="numeric">
                                {t("weight {coefficient}", {
                                  coefficient: format.number(
                                    component.coefficient,
                                    { maximumFractionDigits: 2 }
                                  ),
                                })}
                              </span>
                            </p>
                          </div>
                          <CoefficientBadge
                            coefficient={component.coefficient}
                            showWhenOne
                            className="hidden justify-self-end sm:inline-flex"
                          />
                          <PointsValue
                            value={component.value}
                            outOf={component.outOf}
                            className="hidden justify-self-end text-sm text-muted-foreground sm:inline"
                          />
                          <ResultBadge
                            ratio={gradeRatio(component)}
                            showScale={false}
                            className="justify-self-end text-sm"
                          />
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </section>
            ) : null}

            {grade.note ? (
              <section aria-labelledby="grade-note-title">
                <Card className="gap-0 rounded-xl border-border/60 py-0 shadow-sm">
                  <CardHeader className="px-5 pt-5 pb-3">
                    <CardTitle
                      id="grade-note-title"
                      className="text-base font-semibold"
                    >
                      {t("Note")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 py-5">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {grade.note}
                    </p>
                  </CardContent>
                </Card>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )
}
