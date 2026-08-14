"use client"

import Link from "next/link"
import { use } from "react"
import { useExtracted } from "next-intl"
import { WidgetForm } from "@/components/cards/widget-form"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { useYear } from "@/components/year/year-provider"

export default function EditInsightPage({
  params,
}: {
  params: Promise<{ cardId: string }>
}) {
  const { cardId } = use(params)
  const t = useExtracted()
  const { cards, isLoading } = useYear()
  const card = cards.find(
    (item) => item.id === cardId && item.surface === "insights"
  )

  if (!card) {
    if (isLoading) return null
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Insight not found")}</EmptyTitle>
          <EmptyDescription>{t("It may have been removed.")}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/insights" />}>
          {t("Back to Insights")}
        </Button>
      </Empty>
    )
  }

  return <WidgetForm mode="edit" surface="insights" initial={card} />
}
