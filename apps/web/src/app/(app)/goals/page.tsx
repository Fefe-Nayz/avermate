"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  ChevronRightIcon,
  LayersIcon,
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
import type { GoalPlan } from "@avermate/core"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { useStickyState } from "@/hooks/use-sticky-state"
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

/**
 * The order the groups are read in, when they are grouped.
 *
 * Not best-to-worst. A page of goals is a page about what to do next, so the ones
 * asking for something come first — the two that need work, then the one on course,
 * then the ones already won, then the ones with nothing to say yet. Reading it top to
 * bottom is reading your attention in the order it is owed.
 */
const STATUS_ORDER = [
  "at-risk",
  "unreachable",
  "on-track",
  "achieved",
  "secured",
  "no-data",
] as const

export default function GoalsPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { goals, yearId } = useYear()
  const { plans } = useGoalPlans()
  const statusLabel = useStatusLabel()
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null)
  /**
   * Grouped by status, or in the order the account arranged.
   *
   * Sticky, because it is how someone reads this page rather than something they
   * decide once per visit. It composes with arranging rather than excluding it —
   * see `reorderWithin`.
   */
  const [grouped, setGrouped] = useStickyState("goals:grouped", false)

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

  /**
   * A drag inside one status group, written into the one order there is.
   *
   * Grouping and arranging look like they cannot coexist — the groups come out of the
   * data and there is a single stored sequence — but a drag inside a group says
   * something that sequence holds perfectly well: *this* at-risk goal before *that*
   * one. So the group's new order is woven back into the slots the group already
   * occupied, and every goal outside it keeps its place. The same weave the phone
   * uses to reorder visible cards without disturbing the hidden ones.
   *
   * Dragging between groups is the gesture that would mean nothing, since a status is
   * computed rather than chosen. It is impossible rather than refused: each group is
   * its own sortable list, so there is nowhere else for a row to land.
   */
  const reorderWithin = (nextGroupIds: string[]) => {
    const moved = new Set(nextGroupIds)
    const queue = [...nextGroupIds]
    reorderGoals(
      displayedPlans.map((plan) =>
        moved.has(plan.goal.id) ? (queue.shift() as string) : plan.goal.id
      )
    )
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
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                haptic("light")
                setGrouped(!grouped)
              }}
            >
              <LayersIcon className="size-4" />
              {grouped ? t("Your order") : t("By status")}
            </Button>
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
        ) : grouped ? (
          // Groups, in the order attention is owed rather than best to worst.
          // Each is its own sortable list, so arranging works here too: a drag
          // rearranges the goals inside one status and cannot carry a goal into a
          // status it did not earn.
          <div className="flex flex-col gap-4">
            {STATUS_ORDER.flatMap((status) => {
              const group = displayedPlans.filter(
                (plan) => plan.status === status
              )
              if (group.length === 0) return []
              return [
                <div key={status} className="flex flex-col gap-2">
                  <p className="px-1 text-xs font-medium text-muted-foreground">
                    {statusLabel(status)}
                  </p>
                  <SortableList
                    ids={group.map((plan) => plan.goal.id)}
                    onReorder={reorderWithin}
                    disabled={!orderedIds}
                  >
                    <ul className={sortableListClassName}>
                      {group.map((plan, index) => (
                        <SortableRow
                          key={plan.goal.id}
                          id={plan.goal.id}
                          disabled={!orderedIds}
                          className={sortableRowClassName(index)}
                        >
                          {orderedIds ? (
                            <DragHandle className="ml-1.5" />
                          ) : null}
                          <GoalRow plan={plan} statusLabel={statusLabel} />
                        </SortableRow>
                      ))}
                    </ul>
                  </SortableList>
                </div>,
              ]
            })}
          </div>
        ) : (
          <SortableList
            ids={displayedPlans.map((plan) => plan.goal.id)}
            onReorder={reorderGoals}
            disabled={!orderedIds}
          >
            {/* The app's sortable list, the same object as the custom averages:
                  one card, rows divided by a rule, the grip inline at the left. */}
            <ul className={sortableListClassName}>
              {displayedPlans.map((plan, index) => (
                <SortableRow
                  key={plan.goal.id}
                  id={plan.goal.id}
                  disabled={!orderedIds}
                  className={sortableRowClassName(index)}
                >
                  {/* Only while reordering. The grip is the only affordance on
                        this page that does nothing outside its mode, and a row you
                        can open should not carry a control that cannot be used. */}
                  {orderedIds ? <DragHandle className="ml-1.5" /> : null}
                  <GoalRow plan={plan} statusLabel={statusLabel} />
                </SortableRow>
              ))}
            </ul>
          </SortableList>
        )}
      </div>
    </>
  )
}

/**
 * One goal, as a row.
 *
 * Its own component because the page draws it two ways — inside a sortable list when
 * the account is arranging them, and inside plain status groups when it is reading
 * them — and a row copied into both shapes is a row that stops matching itself.
 */
function GoalRow({
  plan,
  statusLabel,
}: {
  plan: GoalPlan
  statusLabel: (status: GoalPlan["status"]) => string
}) {
  const t = useExtracted()
  const progress =
    plan.current === null || plan.target === 0
      ? 0
      : Math.min(1, Math.max(0, plan.current / plan.target))
  const next = plan.nextResults[0]
  const tone = STATUS_TONE[plan.status]

  return (
    <Link
      href={`/goals/${plan.goal.id}`}
      className={cn(sortableRowLinkClassName, "relative")}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{plan.goal.name}</p>
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
          ) : plan.gap !== null && plan.gap > 0 && next?.achievable ? (
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
              <DeltaValue delta={-plan.gap} className="font-medium" />
            </span>
          ) : null}
        </div>
      </div>

      {/* The reading, then the target it is measured against — set the
            way every other list in the app sets a figure. */}
      <div className="shrink-0 text-right">
        <AverageValue ratio={plan.current} className="text-sm font-medium" />
        <p className="numeric text-[11px] text-muted-foreground">
          {t("of")}{" "}
          <AverageValue ratio={plan.target} animate={false} showScale />
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
  )
}
