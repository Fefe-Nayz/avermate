"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ActivityIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  Clock3Icon,
  FileCheck2Icon,
  FileSearchIcon,
  HistoryIcon,
  ListChecksIcon,
  MinusIcon,
  RefreshCwIcon,
  SparklesIcon,
  TargetIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WifiOffIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { ConceptManagement } from "@/components/learning/concept-management"
import { LearningPlanView } from "@/components/learning/learning-plan-view"
import { LearningPrivacyControls } from "@/components/learning/learning-privacy-controls"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { useYear } from "@/components/year/year-provider"
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
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { orpc, rpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"

function percent(value: number) {
  return `${Math.round(value * 100)} %`
}

function signedPercent(value: number) {
  const points = Math.round(value * 100)
  return `${points > 0 ? "+" : ""}${points} pts`
}

function useTrendLabel() {
  const t = useExtracted()

  return (trend: string) => {
    switch (trend) {
      case "improving":
        return t("Improving")
      case "declining":
        return t("Declining")
      case "stable":
        return t("Stable")
      default:
        return t("Not enough history")
    }
  }
}

function QueryFailure({
  message,
  retry,
}: {
  message: string
  retry: () => void
}) {
  const t = useExtracted()
  return (
    <Alert variant="destructive">
      <AlertTitle>{t("Unable to load this data")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        {message}
        <Button size="sm" variant="outline" onClick={retry}>
          <RefreshCwIcon /> {t("Try again")}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function LearningClient() {
  const t = useExtracted()
  const trendLabel = useTrendLabel()
  const copyStatusLabels = useCopyStatusLabels()
  const queryClient = useQueryClient()
  const { yearId, subjects } = useYear()
  const online = useOnlineStatus()
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [availableMinutes, setAvailableMinutes] = useState(30)
  const [tab, setTab] = useState("overview")
  const scope = { yearId: yearId ?? "", subjectId }
  const concepts = useQuery({
    ...orpc.learning.concepts.list.queryOptions({ input: scope }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const mastery = useQuery({
    ...orpc.learning.mastery.list.queryOptions({ input: scope }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const copies = useQuery({
    ...orpc.learning.copies.list.queryOptions({
      input: scope,
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.some(({ analysis }) =>
        ["queued", "running"].includes(analysis.status)
      )
        ? 2_000
        : false,
  })
  const plan = useQuery({
    ...orpc.learning.plan.list.queryOptions({
      input: scope,
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const progress = useQuery({
    ...orpc.learning.progress.queryOptions({ input: scope }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: orpc.learning.key() })
  }

  const propose = useMutation({
    ...orpc.learning.plan.propose.mutationOptions(),
    onSuccess: async (items) => {
      await refresh()
      toast.success(
        t("{count} learning suggestions are ready", {
          count: String(items.length),
        })
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const recompute = useMutation({
    ...orpc.learning.mastery.recompute.mutationOptions(),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })

  const scopedSubjects = subjects.filter((subject) => !subject.parentId)
  const masteryRows = mastery.data ?? []
  const summary = progress.data?.summary ?? null

  return (
    <>
      {/*
        Say what the page is for, not which nouns it contains.
        
        "From reviewed papers to your next actions" named the pipeline plan 037
        describes without telling a student what they get out of it, which is
        why nobody could tell what this page was.
      */}
      <PageMeta
        title={t("Learning")}
        subtitle={t(
          "What your marked work shows you have learnt, and what to revise next"
        )}
      />
      <PageActions>
        <Button
          size="sm"
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
          {propose.isPending ? <Spinner /> : <SparklesIcon />}
          {t("Suggest a plan")}
        </Button>
      </PageActions>

      <main className="flex min-w-0 flex-col gap-5">
        {!online ? (
          <Alert variant="destructive">
            <WifiOffIcon />
            <AlertTitle>{t("Learning is offline")}</AlertTitle>
            <AlertDescription>
              {t(
                "Cached evidence remains readable, but analysis, structural edits, exports and planning writes are disabled until the connection returns."
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {concepts.isStale ||
        copies.isStale ||
        plan.isStale ||
        mastery.isStale ||
        progress.isStale ? (
          <Alert>
            <Clock3Icon />
            <AlertTitle>{t("Some learning data may be stale")}</AlertTitle>
            <AlertDescription>
              {t(
                "Avermate keeps revision fences on every write. Refresh before acting if another tab changed the same evidence or concept."
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <div
          className="no-scrollbar flex min-w-0 gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label={t("Filter learning by subject")}
        >
          <Button
            size="sm"
            variant={subjectId === null ? "default" : "outline"}
            aria-pressed={subjectId === null}
            onClick={() => setSubjectId(null)}
          >
            {t("All subjects")}
          </Button>
          {scopedSubjects.map((subject) => (
            <Button
              key={subject.id}
              size="sm"
              variant={subjectId === subject.id ? "default" : "outline"}
              aria-pressed={subjectId === subject.id}
              onClick={() => setSubjectId(subject.id)}
            >
              {subject.name}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t("Evidence coverage")}</CardDescription>
              <CardTitle className="numeric text-2xl">
                {summary
                  ? `${summary.measuredObjectiveCount}/${summary.objectiveCount}`
                  : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {summary?.objectiveCount
                  ? t("{coverage} of objectives have reviewed evidence.", {
                      coverage: percent(summary.coverage),
                    })
                  : t("No objective is measurable in this scope yet.")}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t("Measured estimate")}</CardDescription>
              <CardTitle className="numeric text-2xl">
                {summary?.estimate === null || summary?.estimate === undefined
                  ? t("Not measured")
                  : percent(summary.estimate)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("Only objectives with included evidence contribute.")}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t("Direction")}</CardDescription>
              <CardTitle className="text-2xl">
                {summary ? trendLabel(summary.trend) : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {summary?.delta === null || summary?.delta === undefined
                  ? t("Two measured snapshots are needed for a trend.")
                  : t("Change of {delta} across comparable objectives.", {
                      delta: signedPercent(summary.delta),
                    })}
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList
            variant="line"
            className="no-scrollbar max-w-full justify-start overflow-x-auto overflow-y-hidden"
          >
            <TabsTrigger value="overview">
              <ActivityIcon data-icon="inline-start" />
              {t("Overview")}
            </TabsTrigger>
            <TabsTrigger value="plan">{t("Plan")}</TabsTrigger>
            <TabsTrigger value="mastery">{t("Objectives")}</TabsTrigger>
            <TabsTrigger value="copies">{t("Papers")}</TabsTrigger>
            <TabsTrigger value="concepts">{t("Concepts")}</TabsTrigger>
            <TabsTrigger value="history">
              {t("Measurement history")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            {progress.isLoading ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
            ) : progress.isError ? (
              <QueryFailure
                message={progress.error.message}
                retry={() => progress.refetch()}
              />
            ) : (
              <LearningOverview
                data={progress.data}
                onOpenPlan={() => setTab("plan")}
                onOpenObjectives={() => setTab("mastery")}
              />
            )}
          </TabsContent>

          <TabsContent value="mastery" className="mt-4">
            {mastery.isLoading ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
              </div>
            ) : mastery.isError ? (
              <QueryFailure
                message={mastery.error.message}
                retry={() => mastery.refetch()}
              />
            ) : masteryRows.length === 0 ? (
              <LearningEmpty
                icon={<TargetIcon />}
                title={t("No objectives in this scope")}
                description={t(
                  "Create concepts and objectives, then link a paper or quiz to them."
                )}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {masteryRows.map(({ objective, concept, measurement }) => (
                  <Card key={objective.id} size="sm">
                    <CardHeader>
                      <div className="min-w-0">
                        <CardDescription>
                          {concept.localLabel ?? concept.canonicalLabel}
                        </CardDescription>
                        <CardTitle className="mt-1 text-base">
                          {objective.statement}
                        </CardTitle>
                      </div>
                      <Badge variant="outline">
                        {measurement
                          ? t("{count} evidence items", {
                              count: String(measurement.evidenceCount),
                            })
                          : t("Not measured")}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      {measurement ? (
                        <Progress value={measurement.estimate * 100}>
                          <ProgressLabel>{t("Estimate")}</ProgressLabel>
                          <ProgressValue>
                            {() =>
                              `${percent(measurement.estimate)} · ${percent(measurement.low)}–${percent(measurement.high)}`
                            }
                          </ProgressValue>
                        </Progress>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "Nothing here can be measured yet, so no level or artificial midpoint is shown."
                          )}
                        </p>
                      )}
                    </CardContent>
                    <CardFooter className="justify-between">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!online || recompute.isPending}
                        onClick={() =>
                          recompute.mutate({ objectiveId: objective.id })
                        }
                      >
                        <RefreshCwIcon /> {t("Recompute")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <Link href={`/learning/objectives/${objective.id}`} />
                        }
                      >
                        {t("Why?")} <ChevronRightIcon />
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="copies" className="mt-4">
            {copies.isLoading ? (
              <Skeleton className="h-48" />
            ) : copies.isError ? (
              <QueryFailure
                message={copies.error.message}
                retry={() => copies.refetch()}
              />
            ) : !copies.data?.length ? (
              <LearningEmpty
                icon={<FileSearchIcon />}
                title={t("No analyzed papers")}
                description={t(
                  "Attach a paper to a grade, then start its analysis."
                )}
                action={
                  <Button render={<Link href="/grades" />}>
                    {t("Open grades")}
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <ul className="divide-y">
                  {copies.data.map(({ analysis, gradeName, subjectName }) => (
                    <li key={analysis.id}>
                      <Link
                        href={`/learning/copies/${analysis.id}`}
                        className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <FileCheck2Icon className="size-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {gradeName}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {subjectName}
                          </span>
                        </span>
                        <Badge variant="outline">
                          {copyStatusLabels[analysis.status] ?? analysis.status}
                        </Badge>
                        <ChevronRightIcon className="size-4 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="concepts" className="mt-4">
            <ConceptManagement
              data={concepts.data}
              loading={concepts.isLoading}
              error={concepts.error?.message}
              onChanged={refresh}
              subjectId={subjectId}
              yearId={yearId}
              online={online}
            />
          </TabsContent>

          <TabsContent value="plan" className="mt-4">
            <LearningPlanView
              rows={plan.data ?? []}
              loading={plan.isLoading}
              error={plan.error?.message}
              stale={plan.isStale}
              online={online}
              onChanged={refresh}
              yearId={yearId}
              subjectId={subjectId}
              availableMinutes={availableMinutes}
              onAvailableMinutes={setAvailableMinutes}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {progress.isLoading ? (
              <Skeleton className="h-64" />
            ) : progress.isError ? (
              <QueryFailure
                message={progress.error.message}
                retry={() => progress.refetch()}
              />
            ) : (
              <ProgressTimeline data={progress.data} />
            )}
          </TabsContent>
        </Tabs>

        <LearningPrivacyControls
          online={online}
          providers={(copies.data ?? []).map(({ analysis }) => ({
            provider: analysis.provider,
            model: analysis.model,
            modelRevision: analysis.modelRevision,
          }))}
        />
      </main>
    </>
  )
}

function useCopyStatusLabels(): Record<string, string> {
  const t = useExtracted()
  return {
    queued: t("Queued"),
    running: t("Running"),
    proposed: t("Ready to review"),
    confirmed: t("Confirmed"),
    dismissed: t("Dismissed"),
    cancelled: t("Cancelled"),
    failed: t("Failed"),
  }
}

type LearningProgressData = Awaited<ReturnType<typeof rpc.learning.progress>>

function LearningOverview({
  data,
  onOpenPlan,
  onOpenObjectives,
}: {
  data: LearningProgressData | undefined
  onOpenPlan: () => void
  onOpenObjectives: () => void
}) {
  const t = useExtracted()
  const trendLabel = useTrendLabel()
  if (!data || data.summary.objectiveCount === 0) {
    return (
      <LearningEmpty
        icon={<CircleDashedIcon />}
        title={t("Nothing is being measured yet")}
        description={t(
          "Create learning objectives, then connect reviewed papers, quizzes or other evidence. Avermate will not invent a level without them."
        )}
        action={
          <Button onClick={onOpenObjectives}>
            <TargetIcon data-icon="inline-start" />
            {t("Open objectives")}
          </Button>
        }
      />
    )
  }

  const { summary } = data
  const unmeasured = data.objectives.filter(
    (objective) => objective.measurementState === "unmeasured"
  )

  return (
    <section
      aria-labelledby="learning-overview-title"
      className="flex flex-col gap-4"
    >
      <h2 id="learning-overview-title" className="sr-only">
        {t("Learning overview")}
      </h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>{t("Next useful action")}</CardDescription>
            <CardTitle>
              {summary.nextAction?.title ?? t("Build your next revision plan")}
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
                    "This is the highest-priority active suggestion in the selected scope. Open the plan to schedule or dismiss it."
                  )
                : t(
                    "Generate a bounded plan from reviewed evidence, deadlines, prerequisites and the time you actually have."
                  )}
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={onOpenPlan}>
              <ListChecksIcon data-icon="inline-start" />
              {summary.nextAction ? t("Open the plan") : t("Build a plan")}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Measurement quality")}</CardTitle>
            <CardDescription>
              {t("Coverage, confidence and freshness stay separate from level")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={summary.coverage * 100}>
              <ProgressLabel>{t("Evidence coverage")}</ProgressLabel>
              <ProgressValue>
                {() =>
                  `${summary.measuredObjectiveCount}/${summary.objectiveCount}`
                }
              </ProgressValue>
            </Progress>
            <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-4">
              <div>
                <p className="numeric text-lg font-semibold">
                  {summary.confidenceScore === null
                    ? "—"
                    : percent(summary.confidenceScore)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("Confidence")}
                </p>
              </div>
              <div>
                <p className="numeric text-lg font-semibold">
                  {summary.freshness.fresh}
                </p>
                <p className="text-xs text-muted-foreground">{t("Fresh")}</p>
              </div>
              <div>
                <p className="numeric text-lg font-semibold">
                  {summary.freshness.aging}
                </p>
                <p className="text-xs text-muted-foreground">{t("Aging")}</p>
              </div>
              <div>
                <p className="numeric text-lg font-semibold">
                  {summary.freshness.stale}
                </p>
                <p className="text-xs text-muted-foreground">{t("Stale")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendIcon trend={summary.trend} />
            {t("Progress direction")}
          </CardTitle>
          <CardDescription>
            {summary.delta === null
              ? t(
                  "No trend is claimed until at least two measured snapshots are comparable."
                )
              : t("Average change: {delta} across {count} objectives.", {
                  delta: signedPercent(summary.delta),
                  count: String(summary.comparableObjectiveCount),
                })}
          </CardDescription>
        </CardHeader>
        {data.subjects.length ? (
          <CardContent>
            <ItemGroup className="gap-2">
              {data.subjects.map((subject) => (
                <Item
                  key={subject.subjectId ?? "unassigned"}
                  size="sm"
                  variant="outline"
                >
                  <ItemMedia variant="icon">
                    <TrendIcon trend={subject.trend} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {subject.subjectName ?? t("Unassigned objectives")}
                    </ItemTitle>
                    <ItemDescription>
                      {t("{measured}/{total} measured · {coverage} coverage", {
                        measured: String(subject.measuredObjectiveCount),
                        total: String(subject.objectiveCount),
                        coverage: percent(subject.coverage),
                      })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline">
                      {subject.estimate === null
                        ? t("Not measured")
                        : percent(subject.estimate)}
                    </Badge>
                    <Badge variant="secondary">
                      {trendLabel(subject.trend)}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Evidence still needed")}</CardTitle>
            <CardDescription>
              {t(
                "These objectives are unknown, not weak. Add or review evidence before drawing a conclusion."
              )}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{unmeasured.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {unmeasured.length ? (
              <ItemGroup className="gap-2">
                {unmeasured.slice(0, 5).map((objective) => (
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
                        <ChevronRightIcon data-icon="inline-end" />
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
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Recurring difficulties")}</CardTitle>
            <CardDescription>
              {t("Confirmed patterns observed more than once")}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">
                {data.recurringDifficulties.length}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {data.recurringDifficulties.length ? (
              <ItemGroup className="gap-2">
                {data.recurringDifficulties.slice(0, 5).map((difficulty) => (
                  <Item key={difficulty.taxonomy} size="sm" variant="outline">
                    <ItemMedia variant="icon">
                      <TargetIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {taxonomyLabel(difficulty.taxonomy)}
                      </ItemTitle>
                      <ItemDescription>
                        {t(
                          "{count} observations across {objectives} objectives",
                          {
                            count: String(difficulty.observationCount),
                            objectives: String(difficulty.objectiveCount),
                          }
                        )}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="secondary">
                        {t("severity {severity}", {
                          severity: percent(difficulty.averageSeverity),
                        })}
                      </Badge>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("No recurring confirmed pattern in this scope.")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "improving") return <TrendingUpIcon />
  if (trend === "declining") return <TrendingDownIcon />
  if (trend === "stable") return <MinusIcon />
  return <CircleDashedIcon />
}

function taxonomyLabel(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function LearningEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <Empty className="border py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

function ProgressTimeline({
  data,
}: {
  data:
    | {
        disclaimer: string
        projections: Array<{
          projection: {
            id: string
            estimate: number
            low: number
            high: number
            evidenceCount: number
            createdAt: Date
          }
          objective: { statement: string }
          concept: { canonicalLabel: string; localLabel: string | null }
        }>
        schoolGrades: Array<{
          id: string
          name: string
          value: number
          outOf: number
          passedAt: Date
        }>
      }
    | undefined
}) {
  const t = useExtracted()
  const format = useFormatter()
  const measuredProjections =
    data?.projections.filter((row) => row.projection.evidenceCount > 0) ?? []
  if (!data || (!measuredProjections.length && !data.schoolGrades.length))
    return (
      <LearningEmpty
        icon={<HistoryIcon />}
        title={t("No history yet")}
        description={t(
          "Estimates and results will appear here. They show what tends to go together, not what causes what."
        )}
      />
    )
  const events = [
    ...measuredProjections.map((row) => ({
      id: row.projection.id,
      at: row.projection.createdAt,
      kind: "projection" as const,
      title: row.objective.statement,
      detail: t("{estimate} · interval {low}–{high}", {
        estimate: percent(row.projection.estimate),
        low: percent(row.projection.low),
        high: percent(row.projection.high),
      }),
    })),
    ...data.schoolGrades.map((grade) => ({
      id: grade.id,
      at: grade.passedAt,
      kind: "grade" as const,
      title: grade.name,
      detail: `${grade.value}/${grade.outOf}`,
    })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime())
  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <HistoryIcon />
        <AlertTitle>{t("A cautious longitudinal view")}</AlertTitle>
        <AlertDescription>
          {t(
            "This view places estimates and school results on the same timeline without claiming that one caused the other."
          )}
        </AlertDescription>
      </Alert>
      <ol className="relative ml-3 border-l pl-5">
        {events.map((event) => (
          <li
            key={`${event.kind}:${event.id}`}
            className="relative pb-5 last:pb-0"
          >
            <span className="absolute top-1 -left-[1.58rem] size-3 rounded-full border-2 border-background bg-primary" />
            <p className="text-xs text-muted-foreground">
              {format.dateTime(event.at, { dateStyle: "medium" })} ·{" "}
              {event.kind === "grade"
                ? t("School result")
                : t("Avermate projection")}
            </p>
            <p className="text-sm font-medium">{event.title}</p>
            <p className="text-sm text-muted-foreground">{event.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
