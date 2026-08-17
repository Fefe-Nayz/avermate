"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  ChevronRightIcon,
  ListOrderedIcon,
  PlusIcon,
  TargetIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DragHandle,
  SortableList,
  SortableRow,
  sortableListClassName,
  sortableRowClassName,
  sortableRowLinkClassName,
} from "@/components/ui/sortable-list"
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
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * A status, in the vocabulary this app already reads verdicts in.
 *
 * It used to be a tinted 1px border around the whole card, at 50% opacity, on a card
 * that floated on its own. That is the weakest available signal for the most important
 * thing on the row — and card-level dress is spoken for elsewhere: the dashboard
 * reserves it for a live streak. The bands are how this app says good-or-bad
 * everywhere else, so a status says it as a chip and as the colour of its own
 * progress, and the row goes back to being a row.
 */
const STATUS_TONE = {
  secured: {
    chip: "bg-band-excellent/12 text-band-excellent",
    bar: "bg-band-excellent",
  },
  achieved: { chip: "bg-band-good/12 text-band-good", bar: "bg-band-good" },
  "on-track": { chip: "bg-primary/12 text-primary", bar: "bg-primary" },
  "at-risk": { chip: "bg-band-fair/14 text-band-fair", bar: "bg-band-fair" },
  unreachable: { chip: "bg-band-poor/14 text-band-poor", bar: "bg-band-poor" },
  "no-data": {
    chip: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/40",
  },
} as const

export default function GoalsPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { goals, yearId } = useYear()
  const { plans } = useGoalPlans()
  const statusLabel = useStatusLabel()
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null)

  const goalPlans = useMemo(() => plans(goals), [goals, plans])
  const displayedPlans = useMemo(() => {
    if (!orderedIds) return goalPlans
    const byId = new Map(goalPlans.map((plan) => [plan.goal.id, plan]))
    return orderedIds
      .map((id) => byId.get(id))
      .filter((plan): plan is (typeof goalPlans)[number] => Boolean(plan))
  }, [goalPlans, orderedIds])
  const reorder = useMutation({
    ...orpc.goals.reorder.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      }),
  })

  const reorderGoals = (next: string[]) => {
    if (reorder.isPending) return
    setOrderedIds(next)
    reorder.mutate({ goalIds: next })
  }

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

        {goalPlans.length > 1 ? (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                haptic("light")
                setOrderedIds((current) =>
                  current ? null : goalPlans.map((plan) => plan.goal.id)
                )
              }}
            >
              {orderedIds ? (
                <CheckIcon className="size-4" />
              ) : (
                <ListOrderedIcon className="size-4" />
              )}
              {orderedIds ? t("Done") : t("Reorder")}
            </Button>
          </div>
        ) : null}

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
          <SortableList
            ids={displayedPlans.map((plan) => plan.goal.id)}
            onReorder={reorderGoals}
            disabled={!orderedIds}
          >
            {/* The app's sortable list, the same object as the custom averages: one
                card, rows divided by a rule, the grip inline at the left. The grip is
                always there now rather than appearing in a reorder mode that also had
                to switch the link off — a row you cannot open is a stranger thing to
                explain than a grip you can ignore. */}
            <ul className={sortableListClassName}>
              {displayedPlans.map((plan, index) => {
                const progress =
                  plan.current === null || plan.target === 0
                    ? 0
                    : Math.min(1, Math.max(0, plan.current / plan.target))
                const next = plan.nextResults[0]
                const tone = STATUS_TONE[plan.status]

                return (
                  <SortableRow
                    key={plan.goal.id}
                    id={plan.goal.id}
                    disabled={!orderedIds}
                    className={sortableRowClassName(index)}
                  >
                    <DragHandle className="ml-1.5" />
                    <Link
                      href={`/goals/${plan.goal.id}`}
                      className={cn(sortableRowLinkClassName, "relative")}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {plan.goal.name}
                        </p>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                          <span
                            className={cn(
                              "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-4 font-medium",
                              tone.chip
                            )}
                          >
                            {statusLabel(plan.status)}
                          </span>
                          {/* What to do about it, on the same line as the verdict. It
                              was a third paragraph below a progress bar, which is
                              where a reader scanning a list never reached. */}
                          {plan.status === "unreachable" ? (
                            <span className="min-w-0 truncate text-muted-foreground">
                              {t("Not reachable any more")}
                            </span>
                          ) : plan.gap !== null &&
                            plan.gap > 0 &&
                            next?.achievable ? (
                            <span className="min-w-0 truncate text-muted-foreground">
                              {t("Next in {subject}:", {
                                subject: next.subject.name,
                              })}{" "}
                              <AverageValue
                                ratio={next.requiredRatio}
                                animate={false}
                                showScale
                                colored
                                className="font-medium"
                              />
                            </span>
                          ) : plan.gap !== null && plan.gap <= 0 ? (
                            <span className="min-w-0 truncate text-muted-foreground">
                              {t("Ahead by")}{" "}
                              <DeltaValue
                                delta={-plan.gap}
                                className="font-medium"
                              />
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* The reading, then the target it is measured against — set the
                          way every other list in the app sets a figure. */}
                      <div className="shrink-0 text-right">
                        <AverageValue
                          ratio={plan.current}
                          className="text-sm font-medium"
                        />
                        <p className="numeric text-[11px] text-muted-foreground">
                          {t("of")}{" "}
                          <AverageValue
                            ratio={plan.target}
                            animate={false}
                            showScale
                          />
                        </p>
                      </div>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />

                      {/* Progress as a rail on the row's own bottom edge, tinted by
                          status. It was a bar in the flow, costing a line of height
                          per goal and repeating in colour what the chip now says;
                          here it reads along the row it belongs to and takes no
                          height at all. */}
                      <span
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-muted/40"
                      >
                        <span
                          className={cn(
                            "block h-full transition-[width] duration-500",
                            tone.bar
                          )}
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </span>
                    </Link>
                  </SortableRow>
                )
              })}
            </ul>
          </SortableList>
        )}
      </div>
    </>
  )
}
