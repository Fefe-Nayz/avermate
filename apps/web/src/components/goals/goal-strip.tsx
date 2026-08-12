"use client"

import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import type { GoalPlan } from "@avermate/core"
import { AverageValue } from "@/components/data/value"
import { cn } from "@/lib/utils"

const STATUS_STYLE: Record<GoalPlan["status"], string> = {
  achieved: "border-band-good/50 bg-band-good/8",
  secured: "border-band-excellent/50 bg-band-excellent/8",
  "on-track": "border-primary/40 bg-primary/6",
  "at-risk": "border-band-fair/50 bg-band-fair/8",
  unreachable: "border-band-poor/50 bg-band-poor/8",
  "no-data": "border-border bg-card",
}

export function useStatusLabel() {
  const t = useExtracted()
  return (status: GoalPlan["status"]): string =>
    ({
      achieved: t("Reached"),
      secured: t("Locked in"),
      "on-track": t("On track"),
      "at-risk": t("Needs work"),
      unreachable: t("Out of reach"),
      "no-data": t("No data yet"),
    })[status]
}

/** Pinned goals, at a glance, on the dashboard. */
export function GoalStrip({ plans }: { plans: GoalPlan[] }) {
  const t = useExtracted()
  const statusLabel = useStatusLabel()

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("Your goals")}</h2>
        <Link
          href="/goals"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("All goals")}
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>

      <div className="snap-rail -mx-4 [--rail-inset:1rem] md:mx-0 md:grid md:grid-cols-3 md:[--rail-inset:0px]">
        {plans.map((plan) => {
          const progress =
            plan.current === null || plan.target === 0
              ? 0
              : Math.min(1, Math.max(0, plan.current / plan.target))

          return (
            <Link
              key={plan.goal.id}
              href={`/goals/${plan.goal.id}`}
              className={cn(
                "flex w-64 flex-col gap-2 rounded-xl border p-3.5 transition-colors md:w-auto",
                STATUS_STYLE[plan.status]
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {plan.goal.name}
                </p>
                <span className="shrink-0 rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-medium">
                  {statusLabel(plan.status)}
                </span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <AverageValue
                  ratio={plan.current}
                  className="text-xl font-semibold"
                />
                <span className="text-xs text-muted-foreground">{t("of")}</span>
                <AverageValue
                  ratio={plan.target}
                  animate={false}
                  showScale
                  className="text-xs text-muted-foreground"
                />
              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-background/70">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500",
                    plan.status === "unreachable"
                      ? "bg-negative"
                      : plan.status === "achieved" || plan.status === "secured"
                        ? "bg-positive"
                        : "bg-primary"
                  )}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
