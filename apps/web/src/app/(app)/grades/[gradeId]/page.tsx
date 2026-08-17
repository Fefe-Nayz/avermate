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
  const { customAverages, graph } = useYear()

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
      <PageMeta title={grade.name} subtitle={subject?.name} backHref="/grades" />
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

      <div className="flex flex-col gap-5">
        <Card className="overflow-hidden gap-0 border-border/70 py-0 shadow-sm">
          <div className="h-1 bg-primary/80" aria-hidden="true" />
          <CardContent className="grid p-0 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="flex min-w-0 flex-col justify-between gap-8 p-5 md:p-7">
              <div className="space-y-3">
                {subject ? (
                  <Link
                    href={`/subjects/${subject.id}`}
                    className="inline-flex w-fit rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {subject.name}
                  </Link>
                ) : null}

                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                      {grade.name}
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {format.dateTime(grade.passedAt, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="hidden shrink-0 md:inline-flex"
                    render={<Link href={`/grades/${gradeId}/edit`} />}
                  >
                    <PencilIcon className="size-4" />
                    {t("Edit")}
                  </Button>
                </div>
              </div>

              {grade.coefficient !== 1 ? (
                <div className="flex flex-wrap gap-2">
                  <span className="numeric inline-flex items-center rounded-lg border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                    {t("weight {coefficient}", {
                      coefficient: format.number(grade.coefficient, {
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex min-h-44 flex-col items-center justify-center border-t bg-muted/35 p-6 text-center md:min-h-full md:border-t-0 md:border-l">
              <ResultBadge
                ratio={ratio}
                className="px-4 py-2 text-4xl shadow-sm"
                animate
                animateFromZero
              />
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                <PointsValue value={grade.value} outOf={grade.outOf} />
              </p>
            </div>
          </CardContent>
        </Card>

        <ImpactGrid readings={impacts} title={t("Impact on averages")} />

        {grade.components.length > 0 ? (
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="border-b px-4 py-4 md:px-5">
              <CardTitle className="text-sm font-medium">
                {t("What it is made of")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 md:p-3">
              <ul className="flex flex-col gap-1.5">
                {grade.components.map((component) => (
                  <li
                    key={component.id}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {component.name}
                    </span>
                    <CoefficientBadge coefficient={component.coefficient} />
                    <ResultBadge
                      ratio={gradeRatio(component)}
                      showScale={false}
                      className="text-sm"
                    />
                    <span className="numeric hidden w-20 text-right text-xs text-muted-foreground sm:block">
                      <PointsValue
                        value={component.value}
                        outOf={component.outOf}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {grade.note ? (
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="border-b px-4 py-4 md:px-5">
              <CardTitle className="text-sm font-medium">{t("Note")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4 md:px-5 md:py-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                {grade.note}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
