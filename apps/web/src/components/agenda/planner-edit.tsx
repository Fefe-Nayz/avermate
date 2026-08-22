"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { orpc } from "@/lib/orpc"
import type { PlannerItem } from "./agenda-model"
import { PlannerItemForm } from "./planner-item-form"

export function PlannerEdit({
  itemId,
  yearId,
}: {
  itemId: string
  yearId: string
}) {
  const t = useExtracted()
  const query = useQuery(
    orpc.planner.list.queryOptions({
      input: { yearId, includeCompleted: true },
      staleTime: 30_000,
    })
  )
  const item = ((query.data ?? []) as PlannerItem[]).find(
    (candidate) => candidate.id === itemId
  )

  if (query.isPending) return null
  if (query.isError) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("The agenda could not be loaded.")}</EmptyTitle>
          <EmptyDescription>
            {query.error.message || t("This item could not be loaded.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/agenda" />}>
          {t("Back to agenda")}
        </Button>
      </Empty>
    )
  }
  if (!item) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Agenda item not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted or belong to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/agenda" />}>
          {t("Back to agenda")}
        </Button>
      </Empty>
    )
  }

  return <PlannerItemForm mode="edit" initial={item} />
}
