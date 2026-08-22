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
import { AverageForm } from "@/components/averages/average-form"
import { useYear } from "@/components/year/year-provider"
import { safeReturnPath } from "@/lib/safe-return-path"

export default function EditAveragePage({
  params,
  searchParams,
}: {
  params: Promise<{ averageId: string }>
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const { averageId } = use(params)
  const query = use(searchParams)
  const returnTo = safeReturnPath(query.returnTo, "/settings/averages")
  const t = useExtracted()
  const { customAverages, isLoading } = useYear()
  const average = customAverages.find((item) => item.id === averageId)

  if (!average) {
    if (isLoading) return null
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Average not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/settings/averages" />}>
          {t("Back to custom averages")}
        </Button>
      </Empty>
    )
  }

  return (
    <AverageForm
      mode="edit"
      returnTo={returnTo}
      initial={{
        id: average.id,
        name: average.name,
        bonus: average.bonus ? String(average.bonus) : "",
        entries: average.entries.map((entry) => ({
          subjectId: entry.subjectId,
          coefficient:
            entry.coefficient === null ? "" : String(entry.coefficient),
          includeChildren: entry.includeChildren,
        })),
      }}
    />
  )
}
