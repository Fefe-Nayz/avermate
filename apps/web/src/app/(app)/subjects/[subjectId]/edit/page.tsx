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
import { SubjectForm } from "@/components/subjects/subject-form"
import { useYear } from "@/components/year/year-provider"

export default function EditSubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>
}) {
  const { subjectId } = use(params)
  const t = useExtracted()
  const { graph, isLoading } = useYear()
  const subject = graph.byId(subjectId)

  if (!subject) {
    if (isLoading) return null
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Subject not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/subjects" />}>
          {t("Back to subjects")}
        </Button>
      </Empty>
    )
  }

  return (
    <SubjectForm
      mode="edit"
      initial={{
        id: subject.id,
        name: subject.name,
        shortName: subject.shortName ?? "",
        parentId: subject.parentId,
        coefficient: String(subject.coefficient),
        kind: subject.kind,
        isMain: subject.isMain,
      }}
    />
  )
}
