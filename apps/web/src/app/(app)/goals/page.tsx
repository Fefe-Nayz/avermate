"use client"

import Link from "next/link"
import { useMemo } from "react"
import { PlusIcon, TargetIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { useStatusLabel } from "@/components/goals/goal-strip"
import { useYear } from "@/components/year/year-provider"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { cn } from "@/lib/utils"

const STATUS_STYLE = {
  achieved: "border-band-good/50",
  secured: "border-band-excellent/50",
  "on-track": "border-primary/40",
  "at-risk": "border-band-fair/50",
  unreachable: "border-band-poor/50",
  "no-data": "border-border",
} as const

export default function GoalsPage() {
  const t = useExtracted()
  const { goals } = useYear()
  const { plans } = useGoalPlans()
  const statusLabel = useStatusLabel()

  const goalPlans = useMemo(() => plans(goals), [goals, plans])

  return (
    <>
      <PageMeta
        title={t("Goals")}
        subtitle={t("Targets, and what it takes to reach them")}
      />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("New goal")}
          render={<Link href="/goals/new" />}
        >
          <PlusIcon className="size-5" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Goals")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("Targets, and what it takes to reach them")}
            </p>
          </div>
          <Button size="sm" render={<Link href="/goals/new" />}>
            <PlusIcon className="size-4" />
            {t("New goal")}
          </Button>
        </div>

        {goalPlans.length === 0 ? (
          <Empty className="rounded-xl border border-dashed py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TargetIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No goals yet")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Set a target and Avermate works out the mark each subject needs — and tells you when it stops being reachable."
                )}
              </EmptyDescription>
            </EmptyHeader>
            <Button render={<Link href="/goals/new" />}>
              <PlusIcon className="size-4" />
              {t("Set your first goal")}
            </Button>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {goalPlans.map((plan) => {
              const progress =
                plan.current === null || plan.target === 0
                  ? 0
                  : Math.min(1, Math.max(0, plan.current / plan.target))
              const next = plan.nextResults[0]

              return (
                <li key={plan.goal.id}>
                  <Link
                    href={`/goals/${plan.goal.id}`}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40 active:bg-accent",
                      STATUS_STYLE[plan.status]
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{plan.goal.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {statusLabel(plan.status)}
                        </p>
                      </div>
                      <div className="text-right">
                        <AverageValue
                          ratio={plan.current}
                          className="text-xl font-semibold"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("of")}{" "}
                          <AverageValue
                            ratio={plan.target}
                            animate={false}
                            showScale
                          />
                        </p>
                      </div>
                    </div>

                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-500",
                          plan.status === "unreachable"
                            ? "bg-negative"
                            : plan.status === "achieved" ||
                                plan.status === "secured"
                              ? "bg-positive"
                              : "bg-primary"
                        )}
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>

                    {plan.status === "unreachable" ? (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "Not reachable any more, even with perfect results."
                        )}
                      </p>
                    ) : plan.gap !== null &&
                      plan.gap > 0 &&
                      next?.achievable ? (
                      <p className="text-xs text-muted-foreground">
                        {t("Next result in {subject} needs to be", {
                          subject: next.subject.name,
                        })}{" "}
                        <AverageValue
                          ratio={next.requiredRatio}
                          animate={false}
                          showScale
                          colored
                          className="font-medium"
                        />
                      </p>
                    ) : plan.gap !== null && plan.gap <= 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t("Ahead of target by")}{" "}
                        <DeltaValue delta={-plan.gap} className="font-medium" />
                      </p>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
