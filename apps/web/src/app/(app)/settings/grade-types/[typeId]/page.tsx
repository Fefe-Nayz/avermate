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
import { GradeTypeForm } from "@/components/grades/grade-type-form"
import { useYear } from "@/components/year/year-provider"

export default function EditGradeTypePage({
  params,
}: {
  params: Promise<{ typeId: string }>
}) {
  const { typeId } = use(params)
  const t = useExtracted()
  const { gradeTypes, isLoading } = useYear()
  const type = gradeTypes.find((item) => item.id === typeId)

  if (!type) {
    // The same distinction the averages screen makes: nothing at all while the year is
    // still arriving, and a real answer once it has — a spinner that becomes "not found"
    // is honest, and one that never resolves is not.
    if (isLoading) return null
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Type not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          render={<Link href="/settings/grade-types" />}
        >
          {t("Back to assessment types")}
        </Button>
      </Empty>
    )
  }

  return (
    <GradeTypeForm
      mode="edit"
      initial={{
        id: type.id,
        name: type.name,
        titlePrefix: type.titlePrefix,
        coefficient: String(type.coefficient),
        outOf: String(type.outOf),
        accent: type.accent,
      }}
    />
  )
}
