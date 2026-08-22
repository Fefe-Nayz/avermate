"use client"

import Link from "next/link"
import { use } from "react"
import { useQuery } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { GradeForm } from "@/components/grades/grade-form"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"

function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export default function EditGradePage({
  params,
}: {
  params: Promise<{ gradeId: string }>
}) {
  const { gradeId } = use(params)
  const t = useExtracted()
  const { yearGraph, isLoading } = useYear()
  const detail = useQuery(orpc.grades.get.queryOptions({ input: { gradeId } }))

  const gradeInSelectedYear = yearGraph
    .allGrades()
    .some((item) => item.id === gradeId)

  if (!gradeInSelectedYear || !detail.data) {
    if (isLoading || detail.isPending) return null
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

  const grade = detail.data

  return (
    <GradeForm
      key={grade.id}
      mode="edit"
      management={grade.management}
      initial={{
        id: grade.id,
        // Carried so the flow shows which kind this was, and so saving an edit does not
        // quietly strip it.
        typeId: grade.typeId ?? null,
        name: grade.name,
        subjectId: grade.subjectId,
        value: String(grade.value),
        outOf: String(grade.outOf),
        coefficient: String(grade.coefficient),
        // Empty rather than "0", so the form opens without the bonus line unless the
        // result actually carries one.
        bonus: grade.bonus ? String(grade.bonus) : "",
        excludedFromAverage: grade.excludedFromAverage,
        passedAt: toDateInput(grade.passedAt),
        note: grade.note ?? "",
        components: grade.components.map((component) => ({
          key: component.id,
          name: component.name,
          value: String(component.value),
          outOf: String(component.outOf),
          coefficient: String(component.coefficient),
        })),
      }}
    />
  )
}
