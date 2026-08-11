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
import { GoalForm } from "@/components/goals/goal-form"
import { useYear } from "@/components/year/year-provider"

export default function EditGoalPage({
  params,
}: {
  params: Promise<{ goalId: string }>
}) {
  const { goalId } = use(params)
  const t = useExtracted()
  const { goals, isLoading } = useYear()
  const goal = goals.find((item) => item.id === goalId)

  if (!goal) {
    if (isLoading) return null
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Goal not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/goals" />}>
          {t("Back to goals")}
        </Button>
      </Empty>
    )
  }

  return (
    <GoalForm
      mode="edit"
      initial={{
        id: goal.id,
        name: goal.name,
        kind: goal.kind,
        referenceId: goal.referenceId,
        targetRatio: goal.targetRatio,
        periodId: goal.periodId,
        isPinned: (goal as { isPinned?: boolean }).isPinned ?? false,
      }}
    />
  )
}
