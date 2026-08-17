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
      <PageMeta title={grade.name} subtitle={subject?.name} />
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
            ) : null}
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

        <Card className="items-center gap-2 py-6 text-center">
          <CardContent className="flex flex-col items-center gap-2">
            <ResultBadge
              ratio={ratio}
              className="px-3 py-1.5 text-3xl"
              animate
              animateFromZero
            />
            <p className="text-sm text-muted-foreground">
              <PointsValue value={grade.value} outOf={grade.outOf} />
              {grade.coefficient !== 1 ? (
                <>
                  {" · "}
                  <span className="numeric">
                    {t("weight {coefficient}", {
                      coefficient: format.number(grade.coefficient, {
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </span>
                </>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {format.dateTime(grade.passedAt, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </CardContent>
        </Card>

        <ImpactGrid readings={impacts} title={t("Impact on averages")} />

        {grade.components.length > 0 ? (
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("What it is made of")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="flex flex-col gap-2">
                {grade.components.map((component) => (
                  <li
                    key={component.id}
                    className="flex items-center gap-3 border-b pb-2 last:border-0 last:pb-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {component.name}
                    </span>
                    <CoefficientBadge coefficient={component.coefficient} />
                    <ResultBadge
                      ratio={gradeRatio(component)}
                      showScale={false}
                      className="text-sm"
                    />
                    <span className="numeric w-20 text-right text-xs text-muted-foreground">
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
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">{t("Note")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {grade.note}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
