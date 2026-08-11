"use client"

import Link from "next/link"
import { use } from "react"
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

  const grade = yearGraph.allGrades().find((item) => item.id === gradeId)

  if (!grade) {
    if (isLoading) return null
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

  return (
    <GradeForm
      mode="edit"
      initial={{
        id: grade.id,
        name: grade.name,
        subjectId: grade.subjectId,
        value: String(grade.value),
        outOf: String(grade.outOf),
        coefficient: String(grade.coefficient),
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
