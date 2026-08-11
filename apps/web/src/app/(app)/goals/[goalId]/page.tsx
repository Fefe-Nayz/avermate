"use client"

import Link from "next/link"
import { use, useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2Icon, PencilIcon, RotateCcwIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { GoalPlanView } from "@/components/goals/goal-plan-view"
import { useYear } from "@/components/year/year-provider"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

export default function GoalPage({
  params,
}: {
  params: Promise<{ goalId: string }>
}) {
  const { goalId } = use(params)
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { goals, isLoading, yearId } = useYear()
  const { plan: planOf } = useGoalPlans()

  const goal = goals.find((item) => item.id === goalId)
  const plan = useMemo(() => (goal ? planOf(goal) : null), [goal, planOf])
  const markAchieved = useMutation({
    ...orpc.goals.markAchieved.mutationOptions(),
    onSuccess: async (_, variables) => {
      haptic("success")
      toast.success(
        variables.achieved ? t("Goal marked as achieved") : t("Goal reopened")
      )
      await queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The goal could not be updated."))
    },
  })

  if (!goal || !plan) {
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
    <>
      <PageMeta title={goal.name} />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Edit")}
          render={<Link href={`/goals/${goalId}/edit`} />}
        >
          <PencilIcon className="size-4" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <h1 className="text-2xl font-semibold tracking-tight">{goal.name}</h1>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/goals/${goalId}/edit`} />}
          >
            <PencilIcon className="size-4" />
            {t("Edit")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {goal.achievedAt ? t("Achieved") : t("Progress tracking")}
            </p>
            <p className="text-xs text-muted-foreground">
              {goal.achievedAt
                ? t(
                    "You can reopen this goal if you want to keep working on it."
                  )
                : t("Record the achievement when this target is complete.")}
            </p>
          </div>
          <Button
            variant={goal.achievedAt ? "outline" : "default"}
            size="sm"
            disabled={markAchieved.isPending}
            onClick={() =>
              markAchieved.mutate({
                goalId: goal.id,
                achieved: !goal.achievedAt,
              })
            }
          >
            {goal.achievedAt ? (
              <RotateCcwIcon className="size-4" />
            ) : (
              <CheckCircle2Icon className="size-4" />
            )}
            {goal.achievedAt ? t("Reopen") : t("Mark as achieved")}
          </Button>
        </div>

        <GoalPlanView plan={plan} />
      </div>
    </>
  )
}
