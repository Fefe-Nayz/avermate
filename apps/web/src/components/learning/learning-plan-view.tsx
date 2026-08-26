"use client"

import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import {
  BookOpenCheckIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  Clock3Icon,
  Columns3Icon,
  InfoIcon,
  SparklesIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import {
  learningPlanGroup,
  learningRationaleV2,
  type LearningPlanGroup,
} from "./learning-model"

type LearningPlanRow = {
  item: {
    id: string
    status: "proposed" | "accepted" | "in-progress" | "completed" | "dismissed"
    revision: number
    planningTaskId: string | null
    activityKind: string
    estimatedMinutes: number
    rationaleJson: unknown
  }
  objective: { statement: string }
  concept: { canonicalLabel: string; localLabel: string | null }
  planningTask: {
    id: string
    scheduledAt: Date | null
    dueAt: Date | null
    status: "todo" | "doing" | "done"
  } | null
}

const minuteOptions = [15, 30, 45, 60, 90]

export function LearningPlanView({
  rows,
  loading,
  error,
  stale,
  online,
  onChanged,
  yearId,
  subjectId,
  availableMinutes,
  onAvailableMinutes,
}: {
  rows: LearningPlanRow[]
  loading: boolean
  error?: string
  stale: boolean
  online: boolean
  onChanged: () => Promise<void>
  yearId: string | null
  subjectId: string | null
  availableMinutes: number
  onAvailableMinutes: (minutes: number) => void
}) {
  const t = useExtracted()
  const propose = useMutation({
    ...orpc.learning.plan.propose.mutationOptions(),
    onSuccess: async (items) => {
      await onChanged()
      toast.success(
        t("{count} learning suggestions are ready", {
          count: String(items.length),
        })
      )
    },
    onError: (value) => toast.error(value.message),
  })
  const apply = useMutation({
    ...orpc.learning.plan.apply.mutationOptions(),
    onSuccess: async () => {
      await onChanged()
      toast.success(t("Task added to planning"))
    },
    onError: (value) => toast.error(value.message),
  })
  const status = useMutation({
    ...orpc.learning.plan.setStatus.mutationOptions(),
    onSuccess: onChanged,
    onError: (value) => toast.error(value.message),
  })
  const groups = rows.reduce<Record<LearningPlanGroup, LearningPlanRow[]>>(
    (result, row) => {
      result[learningPlanGroup(row, new Date())].push(row)
      return result
    },
    { today: [], upcoming: [], objectives: [] }
  )

  if (loading) return <Skeleton className="h-64" />
  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("Learning plan unavailable")}</AlertTitle>
        <AlertDescription>
          {error}
          <Button
            size="sm"
            variant="outline"
            disabled={!online}
            onClick={onChanged}
          >
            {t("Try again")}
          </Button>
        </AlertDescription>
      </Alert>
    )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card size="sm">
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
          <div>
            <p className="font-medium">{t("Build a time-bounded plan")}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                "Ordered by what you got wrong, what it builds on, what is due, and how recent the evidence is."
              )}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="learning-available-time">
              {t("Time available")}
            </Label>
            <Select
              value={String(availableMinutes)}
              onValueChange={(value) =>
                value && onAvailableMinutes(Number(value))
              }
            >
              <SelectTrigger id="learning-available-time" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {minuteOptions.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {t("{minutes} minutes", { minutes: String(minutes) })}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!online || !yearId || propose.isPending}
            onClick={() =>
              yearId &&
              propose.mutate({
                yearId,
                subjectId,
                limit: 5,
                availableMinutes,
              })
            }
          >
            {propose.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SparklesIcon data-icon="inline-start" />
            )}
            {t("Generate suggestions")}
          </Button>
        </CardContent>
      </Card>

      {stale ? (
        <Alert>
          <Clock3Icon />
          <AlertTitle>{t("Plan data may be stale")}</AlertTitle>
          <AlertDescription>
            {t(
              "Refresh before applying a suggestion if its evidence or task changed elsewhere. If the check cannot be made, the suggestion is not applied."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {!rows.length ? (
        <Empty className="border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenCheckIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No suggested actions")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "The plan works from the objectives you are weakest on. It does not invent extra tasks."
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              disabled={!online || !yearId || propose.isPending}
              onClick={() =>
                yearId &&
                propose.mutate({
                  yearId,
                  subjectId,
                  limit: 5,
                  availableMinutes,
                })
              }
            >
              {propose.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SparklesIcon data-icon="inline-start" />
              )}
              {t("Generate suggestions")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        (["today", "upcoming", "objectives"] as const).map((group) => (
          <PlanGroup
            key={group}
            group={group}
            rows={groups[group]}
            online={online}
            applying={apply.isPending}
            updating={status.isPending}
            onApply={(itemId, expectedRevision, scheduledAt) =>
              apply.mutate({
                itemId,
                expectedRevision,
                scheduledAt,
                dueAt: null,
              })
            }
            onDismiss={(itemId, revision) =>
              status.mutate({
                itemId,
                status: "dismissed",
                expectedRevision: revision,
              })
            }
          />
        ))
      )}
    </div>
  )
}

/**
 * Where a planned task has got to. Five ternary branches inside the render
 * before; a table here, read once per row.
 */
function planStatusLabel(
  status: string,
  t: (message: string) => string
): string {
  const labels: Record<string, string> = {
    proposed: t("Suggested"),
    accepted: t("Accepted"),
    "in-progress": t("In progress"),
    completed: t("Completed"),
  }
  return labels[status] ?? t("Dismissed")
}

function PlanGroup({
  group,
  rows,
  online,
  applying,
  updating,
  onApply,
  onDismiss,
}: {
  group: LearningPlanGroup
  rows: LearningPlanRow[]
  online: boolean
  applying: boolean
  updating: boolean
  onApply: (
    itemId: string,
    expectedRevision: number,
    scheduledAt: Date | null
  ) => void
  onDismiss: (itemId: string, revision: number) => void
}) {
  const t = useExtracted()
  if (!rows.length) return null
  const title =
    group === "today"
      ? t("Today")
      : group === "upcoming"
        ? t("Upcoming")
        : t("By objective")
  const description =
    group === "today"
      ? t("Due today, or already late.")
      : group === "upcoming"
        ? t("Scheduled for later.")
        : t("Not scheduled yet, grouped by what they work on.")
  return (
    <section aria-labelledby={`learning-plan-${group}`} className="grid gap-3">
      <div>
        <h3
          id={`learning-plan-${group}`}
          className="font-heading text-lg font-medium"
        >
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <PlanCard
            key={row.item.id}
            row={row}
            online={online}
            applying={applying}
            updating={updating}
            onApply={onApply}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  )
}

function PlanCard({
  row,
  online,
  applying,
  updating,
  onApply,
  onDismiss,
}: {
  row: LearningPlanRow
  online: boolean
  applying: boolean
  updating: boolean
  onApply: (
    itemId: string,
    expectedRevision: number,
    scheduledAt: Date | null
  ) => void
  onDismiss: (itemId: string, revision: number) => void
}) {
  const t = useExtracted()
  const activityLabels = useActivityLabels()
  const format = useFormatter()
  const { item, objective, concept, planningTask } = row
  const rationale = learningRationaleV2(item.rationaleJson)
  const taskDates = [planningTask?.scheduledAt, planningTask?.dueAt].filter(
    (date): date is Date => Boolean(date)
  )
  const taskDate = taskDates.length
    ? new Date(Math.min(...taskDates.map((date) => date.getTime())))
    : null
  return (
    <Card size="sm">
      <CardHeader>
        <div>
          <CardDescription>
            {concept.localLabel ?? concept.canonicalLabel}
          </CardDescription>
          <CardTitle className="mt-1 text-base">
            {objective.statement}
          </CardTitle>
        </div>
        <Badge variant="outline">{planStatusLabel(item.status, t)}</Badge>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <ClipboardListIcon className="size-4" />
          <span>{activityLabels[item.activityKind] ?? item.activityKind}</span>
          <span>·</span>
          <span>
            {t("{minutes} minutes", { minutes: String(item.estimatedMinutes) })}
          </span>
          {taskDate ? (
            <>
              <span>·</span>
              <time dateTime={taskDate.toISOString()}>
                {format.dateTime(taskDate, {
                  dateStyle: "medium",
                  timeStyle: planningTask?.scheduledAt ? "short" : undefined,
                })}
              </time>
            </>
          ) : null}
        </div>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            {t("Why this action?")}
          </summary>
          {rationale ? (
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <Reason label={t("Policy revision")} value="v2" />
              <Reason
                label={t("Ranking score")}
                value={`${Math.round(rationale.score * 100)} %`}
              />
              <Reason
                label={t("Available time")}
                value={t("{minutes} minutes", {
                  minutes: String(rationale.availableMinutes),
                })}
              />
              <Reason
                label={t("Evidence freshness")}
                value={
                  rationale.freshnessDays === null
                    ? t("Unknown")
                    : t("{days} days", {
                        days: String(Math.round(rationale.freshnessDays)),
                      })
                }
              />
              <Reason
                label={t("Due-work urgency")}
                value={`${Math.round(rationale.dueUrgency * 100)} %`}
              />
              <Reason
                label={t("Unmet prerequisites")}
                value={String(rationale.unmetPrerequisiteIds.length)}
              />
              <Reason
                label={t("Weak objectives depending on this")}
                value={String(rationale.neededByWeakObjectiveIds.length)}
              />
              <Reason
                label={t("Estimate interval")}
                value={
                  rationale.interval
                    ? `${Math.round(rationale.interval[0] * 100)}–${Math.round(rationale.interval[1] * 100)} %`
                    : t("No evidence")
                }
              />
            </dl>
          ) : (
            <Alert className="mt-3">
              <InfoIcon />
              <AlertTitle>{t("Legacy rationale")}</AlertTitle>
              <AlertDescription>
                {t(
                  "This suggestion predates the inspectable v2 policy. Regenerate the plan before relying on its ranking."
                )}
              </AlertDescription>
            </Alert>
          )}
        </details>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        {planningTask && item.planningTaskId ? (
          <>
            <Button
              size="sm"
              variant="outline"
              render={
                <Link href={`/planning/agenda?task=${item.planningTaskId}`} />
              }
            >
              <ClipboardListIcon data-icon="inline-start" />
              {t("Open agenda")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              render={
                <Link href={`/planning/calendar?task=${item.planningTaskId}`} />
              }
            >
              <CalendarDaysIcon data-icon="inline-start" />
              {t("Open calendar")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              render={
                <Link href={`/planning/tasks?task=${item.planningTaskId}`} />
              }
            >
              <Columns3Icon data-icon="inline-start" />
              {t("Open kanban")}
            </Button>
          </>
        ) : item.status === "proposed" ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={!online || updating}
              onClick={() => onDismiss(item.id, item.revision)}
            >
              {t("Dismiss")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!online || applying}
              onClick={() => onApply(item.id, item.revision, null)}
            >
              <CalendarPlusIcon data-icon="inline-start" />
              {t("Add to objective backlog")}
            </Button>
            <Button
              size="sm"
              disabled={!online || applying}
              onClick={() => onApply(item.id, item.revision, new Date())}
            >
              {applying ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CheckCircle2Icon data-icon="inline-start" />
              )}
              {t("Schedule today")}
            </Button>
          </>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function Reason({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function useActivityLabels(): Record<string, string> {
  const t = useExtracted()
  return {
    "review-sheet": t("Review sheet"),
    exercise: t("Exercise"),
    quiz: t("Quiz"),
    "course-review": t("Course review"),
    "oral-recall": t("Oral recall"),
    artifact: t("Artifact"),
  }
}
