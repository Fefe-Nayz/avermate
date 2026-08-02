"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { PencilIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageActions, PageMeta } from "@/components/shell/page-chrome";
import { GoalPlanView } from "@/components/goals/goal-plan-view";
import { useYear } from "@/components/year/year-provider";
import { useGoalPlans } from "@/hooks/use-goal-plans";

export default function GoalPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const { goalId } = use(params);
  const t = useExtracted();
  const { goals, isLoading } = useYear();
  const { plan: planOf } = useGoalPlans();

  const goal = goals.find((item) => item.id === goalId);
  const plan = useMemo(() => (goal ? planOf(goal) : null), [goal, planOf]);

  if (!goal || !plan) {
    if (isLoading) return null;
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
    );
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

        <GoalPlanView plan={plan} />
      </div>
    </>
  );
}
