"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CalendarRangeIcon,
  CircleDashedIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  ListChecksIcon,
  RefreshCwIcon,
  TargetIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { orpc, rpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  activeProjectLearningPlanRows,
  learningWorkspaceHref,
} from "./project-learning-model"

type LearningProgress = Awaited<ReturnType<typeof rpc.learning.progress>>
type LearningPlan = Awaited<ReturnType<typeof rpc.learning.plan.list>>
type LearningTrend = LearningProgress["summary"]["variation"]["trend"]

function percent(value: number) {
  return `${Math.round(value * 100)} %`
}

function signedPercent(value: number) {
  const points = Math.round(value * 100)
  return `${points > 0 ? "+" : ""}${points} pts`
}

function TrendIcon({ trend }: { trend: LearningTrend }) {
  if (trend === "improving") return <TrendingUpIcon />
  if (trend === "declining") return <TrendingDownIcon />
  return <CircleDashedIcon />
}

function useTrendLabel() {
  const t = useExtracted()
  return (trend: LearningTrend) => {
    switch (trend) {
      case "improving":
        return t("Improving")
      case "declining":
        return t("Declining")
      case "stable":
        return t("Stable")
      case "uncertain":
        return t("Uncertain")
      case "method-changed":
        return t("Calculation method changed")
      default:
        return t("Not enough history")
    }
  }
}

function usePlanStatusLabel() {
  const t = useExtracted()
  return (status: string) => {
    switch (status) {
      case "proposed":
        return t("Suggested")
      case "accepted":
        return t("Accepted")
      case "in-progress":
        return t("In progress")
      default:
        return t("Dismissed")
    }
  }
}

function LearningSkeleton() {
  const t = useExtracted()
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-label={t("Loading project learning summary")}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}

function ProjectLearningError({
  message,
  retry,
}: {
  message: string
  retry: () => void
}) {
  const t = useExtracted()
  return (
    <Alert variant="destructive">
      <AlertTitle>{t("Project learning summary unavailable")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        <Button size="sm" variant="outline" onClick={retry}>
          <RefreshCwIcon data-icon="inline-start" />
          {t("Try again")}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function ProjectLearningOverview({
  yearId,
  subjectId,
  yearName,
  subjectName,
  onEditProject,
}: {
  yearId: string | null
  subjectId: string | null
  yearName: string | null
  subjectName: string | null
  onEditProject: () => void
}) {
  const t = useExtracted()
  const trendLabel = useTrendLabel()
  const planStatusLabel = usePlanStatusLabel()
  const scope = { yearId: yearId ?? "", subjectId }
  const progressQuery = useQuery({
    ...orpc.learning.progress.queryOptions({ input: scope }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const planQuery = useQuery({
    ...orpc.learning.plan.list.queryOptions({ input: scope }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  if (!yearId) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarRangeIcon />
          </EmptyMedia>
          <EmptyTitle>{t("Link an academic year to this project")}</EmptyTitle>
          <EmptyDescription>
            {t(
              "Learning evidence is always scoped to an academic year. Link one before Avermate shows progress here."
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onEditProject}>
            <CalendarRangeIcon data-icon="inline-start" />
            {t("Edit project scope")}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const learningScope = { yearId, subjectId }

  if (progressQuery.isLoading) return <LearningSkeleton />

  if (progressQuery.isError) {
    return (
      <ProjectLearningError
        message={progressQuery.error.message}
        retry={() => void progressQuery.refetch()}
      />
    )
  }

  const data = progressQuery.data
  if (!data || data.summary.objectiveCount === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TargetIcon />
          </EmptyMedia>
          <EmptyTitle>
            {t("Nothing is being measured in this project yet")}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              "Create objectives in Learning for this exact year and subject scope. Avermate will not infer a level without reviewed evidence."
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            render={
              <Link href={learningWorkspaceHref("mastery", learningScope)} />
            }
          >
            <TargetIcon data-icon="inline-start" />
            {t("Open objectives in Learning")}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const { summary } = data
  const unmeasured = data.objectives.filter(
    (objective) => objective.measurementState === "unmeasured"
  )
  const activePlan = activeProjectLearningPlanRows(planQuery.data ?? [])
  const scopedSubjectName =
    subjectName ??
    data.subjects.find((subject) => subject.subjectId === subjectId)
      ?.subjectName ??
    null

  return (
    <section
      aria-labelledby="project-learning-title"
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <h2 id="project-learning-title" className="font-medium">
              {t("Learning in this project")}
            </h2>
            <p className="text-sm text-pretty text-muted-foreground">
              {t(
                "A read-only view of the same objectives, evidence and plan managed in Learning."
              )}
            </p>
          </div>
          <div
            className="flex flex-wrap gap-2"
            aria-label={t("Learning scope")}
          >
            <Badge variant="outline">
              {yearName ?? t("Linked academic year")}
            </Badge>
            <Badge variant="secondary">
              {subjectId
                ? (scopedSubjectName ?? t("Linked subject"))
                : t("All subjects in this year")}
            </Badge>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          render={
            <Link href={learningWorkspaceHref("overview", learningScope)} />
          }
        >
          <GraduationCapIcon data-icon="inline-start" />
          {t("Open full Learning workspace")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("Evidence coverage")}</CardDescription>
            <CardTitle className="numeric text-2xl">
              {summary.measuredObjectiveCount}/{summary.objectiveCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={summary.coverage * 100}>
              <ProgressLabel className="sr-only">
                {t("Evidence coverage")}
              </ProgressLabel>
              <ProgressValue>{() => percent(summary.coverage)}</ProgressValue>
            </Progress>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("Measured estimate")}</CardDescription>
            <CardTitle className="numeric text-2xl">
              {summary.estimate === null
                ? t("Not measured")
                : percent(summary.estimate)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {summary.interval
                ? t("Measured interval: {low}–{high}", {
                    low: percent(summary.interval[0]),
                    high: percent(summary.interval[1]),
                  })
                : t("No measured interval yet")}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("Estimate precision")}</CardDescription>
            <CardTitle className="numeric text-2xl">
              {summary.precision.score === null
                ? "—"
                : percent(summary.precision.score)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {t("{count} reviewed evidence items", {
                count: String(summary.evidence.itemCount),
              })}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("Direction")}</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <TrendIcon trend={summary.variation.trend} />
              {trendLabel(summary.variation.trend)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="numeric text-xs text-muted-foreground">
              {summary.variation.delta === null
                ? t("No comparable variation")
                : t("Observed variation: {delta}", {
                    delta: signedPercent(summary.variation.delta),
                  })}
            </p>
          </CardContent>
        </Card>
      </div>

      {summary.variation.trend === "method-changed" ? (
        <Alert>
          <CircleDashedIcon />
          <AlertTitle>{t("Calculation method changed")}</AlertTitle>
          <AlertDescription>
            {t(
              "The estimates remain visible, but their difference is not presented as learning progress."
            )}
          </AlertDescription>
        </Alert>
      ) : summary.variation.trend === "uncertain" ? (
        <Alert>
          <CircleDashedIcon />
          <AlertTitle>{t("The observed direction is uncertain")}</AlertTitle>
          <AlertDescription>
            {t(
              "The intervals overlap or the evidence is still too limited. Treat the variation as a signal to investigate, not a conclusion."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>{t("Next useful action")}</CardDescription>
            <CardTitle>
              {summary.nextAction?.title ?? t("No active learning action")}
            </CardTitle>
            {summary.nextAction ? (
              <CardAction>
                <Badge variant="secondary">
                  {t("{minutes} min", {
                    minutes: String(summary.nextAction.estimatedMinutes),
                  })}
                </Badge>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-pretty text-muted-foreground">
              {summary.nextAction
                ? t(
                    "This is the next active suggestion in the linked Learning plan. Open Learning to schedule, accept or dismiss it."
                  )
                : t(
                    "No active suggestion exists for this scope. Learning can build a bounded plan from reviewed evidence."
                  )}
            </p>
          </CardContent>
          <CardFooter>
            <Button
              render={
                <Link href={learningWorkspaceHref("plan", learningScope)} />
              }
            >
              <ListChecksIcon data-icon="inline-start" />
              {summary.nextAction ? t("Open the plan") : t("Build a plan")}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Evidence still needed")}</CardTitle>
            <CardDescription>
              {t(
                "These objectives are unknown, not weak. Review evidence before drawing a conclusion."
              )}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{unmeasured.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {unmeasured.length ? (
              <ItemGroup className="gap-2">
                {unmeasured.slice(0, 3).map((objective) => (
                  <Item key={objective.id} size="sm" variant="outline">
                    <ItemMedia variant="icon">
                      <CircleDashedIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{objective.statement}</ItemTitle>
                      <ItemDescription>
                        {objective.conceptLabel}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        render={
                          <Link href={`/learning/objectives/${objective.id}`} />
                        }
                      >
                        {t("Inspect")}
                        <ArrowRightIcon data-icon="inline-end" />
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("Every objective in this scope has reviewed evidence.")}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              render={
                <Link href={learningWorkspaceHref("mastery", learningScope)} />
              }
            >
              <TargetIcon data-icon="inline-start" />
              {t("Open objectives")}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Active revision plan")}</CardTitle>
          <CardDescription>
            {t(
              "A preview of the authoritative plan. Changes are made in Learning and stay linked to planning tasks."
            )}
          </CardDescription>
          <CardAction>
            <Button
              size="sm"
              variant="ghost"
              render={
                <Link href={learningWorkspaceHref("plan", learningScope)} />
              }
            >
              {t("View all")}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {planQuery.isLoading ? (
            <div
              className="flex flex-col gap-2"
              role="status"
              aria-label={t("Loading learning plan")}
            >
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : planQuery.isError ? (
            <ProjectLearningError
              message={planQuery.error.message}
              retry={() => void planQuery.refetch()}
            />
          ) : activePlan.length ? (
            <ItemGroup className="gap-2">
              {activePlan.map((row: LearningPlan[number]) => (
                <Item key={row.item.id} size="sm" variant="outline">
                  <ItemMedia variant="icon">
                    <ClipboardListIcon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{row.objective.statement}</ItemTitle>
                    <ItemDescription>
                      {row.concept.localLabel ?? row.concept.canonicalLabel}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="flex-wrap">
                    <Badge variant="outline">
                      {planStatusLabel(row.item.status)}
                    </Badge>
                    <Badge variant="secondary">
                      {t("{minutes} min", {
                        minutes: String(row.item.estimatedMinutes),
                      })}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardListIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {t("No active plan item in this scope")}
                </EmptyTitle>
                <EmptyDescription>
                  {t(
                    "Open Learning to generate suggestions from the evidence already reviewed."
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  size="sm"
                  render={
                    <Link href={learningWorkspaceHref("plan", learningScope)} />
                  }
                >
                  <ListChecksIcon data-icon="inline-start" />
                  {t("Build a plan")}
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
