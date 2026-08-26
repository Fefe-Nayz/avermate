"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRightIcon,
  Clock3Icon,
  FileCheck2Icon,
  FileSearchIcon,
  HistoryIcon,
  RefreshCwIcon,
  SparklesIcon,
  TargetIcon,
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
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"

function percent(value: number) {
  return `${Math.round(value * 100)} %`
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
  const copyStatusLabels = useCopyStatusLabels()
  const queryClient = useQueryClient()
  const { yearId, subjects } = useYear()
  const online = useOnlineStatus()
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [availableMinutes, setAvailableMinutes] = useState(30)
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
      input: { yearId: yearId ?? "" },
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
      input: { yearId: yearId ?? "" },
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const progress = useQuery({
    ...orpc.learning.progress.queryOptions({ input: { yearId: yearId ?? "" } }),
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
  const averageMastery = masteryRows.length
    ? masteryRows.reduce(
        (sum, row) => sum + (row.projection?.estimate ?? 0.5),
        0
      ) / masteryRows.length
    : null

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
        <div className="hidden items-start justify-between gap-4 md:flex">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {t("Learning")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("Every estimate remains linked to evidence you reviewed.")}
            </p>
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
            {propose.isPending ? <Spinner /> : <SparklesIcon />}
            {t("Suggest a plan")}
          </Button>
        </div>

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

        {concepts.isStale || copies.isStale || plan.isStale ? (
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t("Active objectives")}</CardDescription>
              <CardTitle className="numeric text-2xl">
                {concepts.data?.objectives.length ?? "—"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t("Average estimate")}</CardDescription>
              <CardTitle className="numeric text-2xl">
                {averageMastery === null ? "—" : percent(averageMastery)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t("Papers to review")}</CardDescription>
              <CardTitle className="numeric text-2xl">
                {
                  (copies.data ?? []).filter(({ analysis }) =>
                    ["proposed", "failed"].includes(analysis.status)
                  ).length
                }
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <LearningPrivacyControls
          online={online}
          providers={(copies.data ?? []).map(({ analysis }) => ({
            provider: analysis.provider,
            model: analysis.model,
            modelRevision: analysis.modelRevision,
          }))}
        />

        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          <Button
            size="sm"
            variant={subjectId === null ? "default" : "outline"}
            onClick={() => setSubjectId(null)}
          >
            {t("All subjects")}
          </Button>
          {scopedSubjects.map((subject) => (
            <Button
              key={subject.id}
              size="sm"
              variant={subjectId === subject.id ? "default" : "outline"}
              onClick={() => setSubjectId(subject.id)}
            >
              {subject.name}
            </Button>
          ))}
        </div>

        <Tabs defaultValue="mastery" className="min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="mastery">{t("Mastery")}</TabsTrigger>
            <TabsTrigger value="copies">{t("Papers")}</TabsTrigger>
            <TabsTrigger value="concepts">{t("Concepts")}</TabsTrigger>
            <TabsTrigger value="plan">{t("Plan")}</TabsTrigger>
            <TabsTrigger value="progress">{t("Progress")}</TabsTrigger>
          </TabsList>

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
                {masteryRows.map(({ objective, concept, projection }) => (
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
                        {projection
                          ? t("{count} evidence items", {
                              count: String(projection.evidenceCount),
                            })
                          : t("No evidence")}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      {projection ? (
                        <Progress value={projection.estimate * 100}>
                          <ProgressLabel>{t("Estimate")}</ProgressLabel>
                          <ProgressValue>
                            {() =>
                              `${percent(projection.estimate)} · ${percent(projection.low)}–${percent(projection.high)}`
                            }
                          </ProgressValue>
                        </Progress>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "Nothing here can be measured yet, so no level is shown."
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

          <TabsContent value="progress" className="mt-4">
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
  if (!data || (!data.projections.length && !data.schoolGrades.length))
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
    ...data.projections.map((row) => ({
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
