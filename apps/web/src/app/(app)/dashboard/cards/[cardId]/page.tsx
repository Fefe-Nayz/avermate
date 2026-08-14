"use client"

import { use } from "react"
import { notFound } from "next/navigation"
import { WidgetForm } from "@/components/cards/widget-form"
import { useYear } from "@/components/year/year-provider"

export default function EditCardPage({
  params,
}: {
  params: Promise<{ cardId: string }>
}) {
  const { cardId } = use(params)
  const { cards, isLoading } = useYear()
  const card = cards.find(
    (item) => item.id === cardId && item.surface === "overview"
  )

  if (!card) {
    if (isLoading) return null
    notFound()
  }

  return <WidgetForm mode="edit" surface="overview" initial={card} />
}
