"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  Clock3Icon,
  EyeIcon,
  FileOutputIcon,
  FilmIcon,
  HistoryIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { ArtifactOutputDialog } from "./artifact-output-dialog"
import {
  CreateArtifactDialog,
  type ArtifactPlanSeed,
  type ArtifactPlanValue,
} from "./create-artifact-dialog"
import {
  TERMINAL_WORKFLOW_STATUSES,
  stageCanApprove,
  stageCanRetry,
  stageProgress,
  workflowStatusVariant,
} from "./media-studio-model"
import { useMediaStudioCopy } from "./media-studio-copy"

function formatDate(
  format: ReturnType<typeof useFormatter>,
  value: string | Date | null | undefined
) {
  if (!value) return "—"
  return format.dateTime(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function MediaStudioClient() {
  const t = useExtracted()
  const format = useFormatter()
  const isOnline = useOnlineStatus()
  const {
    artifactKindLabel,
    capabilityReason,
    stageLabel,
    workflowStatusLabel,
  } = useMediaStudioCopy()
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [tab, setTab] = useState("workflows")
  const [createOpen, setCreateOpen] = useState(false)
  const [createSeed, setCreateSeed] = useState<ArtifactPlanSeed | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null
  )
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null
  )
  const [previewOpen, setPreviewOpen] = useState(false)
  const [compareRevisionId, setCompareRevisionId] = useState<string | null>(
    null
  )
  const projectsQuery = useQuery({
    ...orpc.projects.list.queryOptions({ input: { include: "all" } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const capabilitiesQuery = useQuery({
    ...orpc.mediaStudio.capabilities.queryOptions(),
    staleTime: 30_000,
  })
  const videoConsentQuery = useQuery({
    ...orpc.mediaStudio.videoExtractionConsent.queryOptions(),
    staleTime: 30_000,
  })
  const workflowsInput = { projectId, artifactId: null, limit: 50 }
  const workflowsQuery = useQuery({
    ...orpc.mediaStudio.listWorkflows.queryOptions({ input: workflowsInput }),
    refetchInterval: (query) =>
      query.state.data?.some(
        (run) => !TERMINAL_WORKFLOW_STATUSES.has(run.status)
      )
        ? 1_500
        : false,
  })
  const artifactsInput = { projectId }
  const artifactsQuery = useQuery({
    ...orpc.mediaStudio.listArtifacts.queryOptions({ input: artifactsInput }),
  })

  const selectedWorkflow =
    workflowsQuery.data?.find((run) => run.id === selectedRunId) ??
    workflowsQuery.data?.[0] ??
    null
  const workflowQuery = useQuery({
    ...orpc.mediaStudio.getWorkflow.queryOptions({
      input: { runId: selectedWorkflow?.id ?? "_" },
    }),
    enabled: Boolean(selectedWorkflow),
    refetchInterval: (query) =>
      query.state.data &&
      !TERMINAL_WORKFLOW_STATUSES.has(query.state.data.status)
        ? 1_500
        : false,
  })
  const workflow = workflowQuery.data ?? selectedWorkflow

  const selectedArtifact =
    artifactsQuery.data?.find(
      (artifact) => artifact.id === selectedArtifactId
    ) ??
    artifactsQuery.data?.[0] ??
    null
  const revisionsQuery = useQuery({
    ...orpc.mediaStudio.listRevisions.queryOptions({
      input: { artifactId: selectedArtifact?.id ?? "_" },
    }),
    enabled: Boolean(selectedArtifact),
  })
  const selectedRevision =
    revisionsQuery.data?.find(
      (revision) => revision.id === selectedRevisionId
    ) ??
    revisionsQuery.data?.find((revision) => revision.current) ??
    revisionsQuery.data?.[0] ??
    null
  const comparisonRevision =
    revisionsQuery.data?.find(
      (revision) => revision.id === compareRevisionId
    ) ?? null
  const manifestQuery = useQuery({
    ...orpc.mediaStudio.getManifest.queryOptions({
      input: { artifactRevisionId: selectedRevision?.id ?? "_" },
    }),
    enabled: Boolean(selectedRevision),
    staleTime: Number.POSITIVE_INFINITY,
  })

  async function refreshStudio() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.mediaStudio.listWorkflows.queryKey({
          input: workflowsInput,
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.mediaStudio.listArtifacts.queryKey({
          input: artifactsInput,
        }),
      }),
      ...(selectedWorkflow
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.mediaStudio.getWorkflow.queryKey({
                input: { runId: selectedWorkflow.id },
              }),
            }),
          ]
        : []),
      ...(selectedArtifact
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.mediaStudio.listRevisions.queryKey({
                input: { artifactId: selectedArtifact.id },
              }),
            }),
          ]
        : []),
    ])
  }

  const plan = useMutation({
    ...orpc.mediaStudio.planArtifact.mutationOptions(),
    onSuccess: async (run) => {
      setCreateOpen(false)
      setSelectedRunId(run.id)
      setTab("workflows")
      await refreshStudio()
      toast.success(t("Workflow planned"))
    },
    onError: (error) => toast.error(error.message),
  })
  const cancel = useMutation({
    ...orpc.mediaStudio.cancelWorkflow.mutationOptions(),
    onSuccess: async () => {
      await refreshStudio()
      toast.success(t("Cancellation requested"))
    },
    onError: (error) => toast.error(error.message),
  })
  const approve = useMutation({
    ...orpc.mediaStudio.approveStage.mutationOptions(),
    onSuccess: async () => {
      await refreshStudio()
      toast.success(t("Stage approved"))
    },
    onError: (error) => toast.error(error.message),
  })
  const retry = useMutation({
    ...orpc.mediaStudio.retryStage.mutationOptions(),
    onSuccess: async () => {
      await refreshStudio()
      toast.success(t("Retry scheduled"))
    },
    onError: (error) => toast.error(error.message),
  })
  const promote = useMutation({
    ...orpc.mediaStudio.promoteRevision.mutationOptions(),
    onSuccess: async () => {
      await refreshStudio()
      toast.success(t("Revision published"))
    },
    onError: (error) => toast.error(error.message),
  })
  const setState = useMutation({
    ...orpc.mediaStudio.setArtifactState.mutationOptions(),
    onSuccess: async (result) => {
      await refreshStudio()
      toast.success(
        result.state === "trashed"
          ? t("Artifact moved to trash")
          : t("State updated")
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const acceptVideoExtraction = useMutation({
    ...orpc.mediaStudio.acceptVideoExtractionNotice.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.mediaStudio.videoExtractionConsent.key(),
      })
      toast.success(t("Audio-extraction fallback authorized."))
    },
    onError: (error) => toast.error(error.message),
  })
  const revokeVideoExtraction = useMutation({
    ...orpc.mediaStudio.revokeVideoExtractionNotice.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.mediaStudio.videoExtractionConsent.key(),
      })
      toast.success(t("Audio-extraction fallback revoked."))
    },
    onError: (error) => toast.error(error.message),
  })

  const projectItems = useMemo(
    () => [
      { label: t("All projects"), value: null },
      ...(projectsQuery.data ?? [])
        .filter((project) => project.deletedAt === null)
        .map((project) => ({ label: project.title, value: project.id })),
    ],
    [projectsQuery.data, t]
  )
  const capabilities = [
    {
      key: "staticHtml" as const,
      label: t("Static web pages"),
      description: t("Structured extraction without running third-party code."),
    },
    {
      key: "dynamicWebRendering" as const,
      label: t("Dynamic web pages"),
      description: t("Isolated, attested browser for JavaScript pages."),
    },
    {
      key: "platformCaptions" as const,
      label: t("Platform captions"),
      description: t("Deterministic import of authorized tracks."),
    },
    {
      key: "videoAudioExtraction" as const,
      label: t("Video audio extraction"),
      description: t("Explicit fallback governed by consent and policy."),
    },
    {
      key: "mediaTimelineRendering" as const,
      label: t("Video rendering"),
      description: t("FFmpeg composition from a versioned timeline."),
    },
    {
      key: "manimRendering" as const,
      label: t("Manim animations"),
      description: t("Reviewed DSL translated inside a conforming sandbox."),
    },
  ]
  const workflowProgress = workflow?.stages.length
    ? Math.round(
        workflow.stages.reduce(
          (sum, stage) => sum + stageProgress(stage.processed, stage.total),
          0
        ) / workflow.stages.length
      )
    : 0

  function submitPlan(value: ArtifactPlanValue) {
    plan.mutate({
      ...value,
      idempotencyKey: `web-${crypto.randomUUID()}`,
    })
  }

  return (
    <>
      <PageMeta
        title={t("Learning Studio")}
        subtitle={t(
          "Versioned, inspectable generations linked to your sources"
        )}
        backHref="/materials"
      />
      <PageActions>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/integrations"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Settings2Icon data-icon="inline-start" />
            {t("Capabilities")}
          </Link>
          <Button
            size="sm"
            onClick={() => {
              setCreateSeed(null)
              setCreateOpen(true)
            }}
            disabled={!isOnline}
          >
            <PlusIcon data-icon="inline-start" />
            {t("Create")}
          </Button>
        </div>
      </PageActions>

      <div className="flex flex-col gap-5 pb-8">
        {!isOnline ? (
          <Alert role="status">
            <CircleAlertIcon />
            <AlertTitle>{t("You are offline")}</AlertTitle>
            <AlertDescription>
              {t(
                "Published artifacts remain inspectable when cached. New workflows, approvals, retries and downloads resume after reconnection."
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        <section aria-labelledby="studio-capabilities-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="studio-capabilities-title"
                className="font-heading text-lg font-medium"
              >
                {t("Execution capabilities")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  "The interface never claims that a remote or local engine is ready before verification."
                )}
              </p>
            </div>
            <Select
              items={projectItems}
              value={projectId}
              onValueChange={(value) => {
                setProjectId(value)
                setSelectedRunId(null)
                setSelectedArtifactId(null)
              }}
            >
              <SelectTrigger
                className="w-full sm:w-56"
                aria-label={t("Filter by project")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {projectItems.map((item) => (
                    <SelectItem key={item.value ?? "all"} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {capabilitiesQuery.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>{t("Capabilities unavailable")}</AlertTitle>
              <AlertDescription>
                {capabilitiesQuery.error.message}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {capabilities.map((item) => {
                const capability = capabilitiesQuery.data?.[item.key]
                return (
                  <Card key={item.key} size="sm">
                    <CardHeader>
                      <CardTitle>{item.label}</CardTitle>
                      <CardDescription>{item.description}</CardDescription>
                      <CardAction>
                        {capabilitiesQuery.isPending ? (
                          <Skeleton className="h-5 w-20" />
                        ) : (
                          <Badge
                            variant={
                              capability?.available ? "default" : "outline"
                            }
                          >
                            {capability?.available
                              ? t("Available")
                              : t("Unavailable")}
                          </Badge>
                        )}
                      </CardAction>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      {capability
                        ? capabilityReason(capability)
                        : t("Checking…")}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
          <Card
            id="video-audio-fallback"
            className="mt-3 scroll-mt-24"
            size="sm"
          >
            <CardHeader>
              <CardTitle>{t("Video audio fallback")}</CardTitle>
              <CardDescription>
                {t(
                  "If a platform has no usable captions, extracting its audio requires a separate explicit authorization. This choice does not start a download by itself."
                )}
              </CardDescription>
              <CardAction>
                {videoConsentQuery.isPending ? (
                  <Skeleton className="h-5 w-24" />
                ) : (
                  <Badge
                    variant={
                      videoConsentQuery.isError
                        ? "destructive"
                        : videoConsentQuery.data?.active
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {videoConsentQuery.isError
                      ? t("Status unavailable")
                      : videoConsentQuery.data?.active
                        ? t("Authorized")
                        : t("Not authorized")}
                  </Badge>
                )}
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {videoConsentQuery.data?.notice ??
                  t(
                    "Only the authorized source is processed, inside the configured bounded worker. Platform rules and source policy still apply."
                  )}
              </p>
              {videoConsentQuery.data?.active &&
              videoConsentQuery.data.acceptedAt ? (
                <p className="text-xs">
                  {t("Authorized on {date}", {
                    date: format.dateTime(
                      new Date(videoConsentQuery.data.acceptedAt),
                      { dateStyle: "medium", timeStyle: "short" }
                    ),
                  })}
                </p>
              ) : null}
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  !isOnline ||
                  videoConsentQuery.isPending ||
                  videoConsentQuery.isError ||
                  !videoConsentQuery.data?.active ||
                  revokeVideoExtraction.isPending
                }
                onClick={() => revokeVideoExtraction.mutate(undefined)}
              >
                <BanIcon data-icon="inline-start" />
                {t("Revoke")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  !isOnline ||
                  videoConsentQuery.isPending ||
                  videoConsentQuery.isError ||
                  videoConsentQuery.data?.active === true ||
                  acceptVideoExtraction.isPending
                }
                onClick={() => acceptVideoExtraction.mutate({ accepted: true })}
              >
                {acceptVideoExtraction.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CheckCircle2Icon data-icon="inline-start" />
                )}
                {t("Authorize fallback")}
              </Button>
            </CardFooter>
          </Card>
        </section>

        <Separator />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            variant="line"
            className="max-w-full overflow-x-auto overflow-y-hidden"
          >
            <TabsTrigger value="workflows">
              <SparklesIcon data-icon="inline-start" />
              {t("Workflows")}
            </TabsTrigger>
            <TabsTrigger value="artifacts">
              <FileOutputIcon data-icon="inline-start" />
              {t("Artifacts")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workflows" className="pt-3">
            {workflowsQuery.error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{t("Workflows unavailable")}</AlertTitle>
                <AlertDescription>
                  {workflowsQuery.error.message}
                </AlertDescription>
              </Alert>
            ) : workflowsQuery.isPending ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
                <Skeleton className="h-96" />
                <Skeleton className="h-96" />
              </div>
            ) : !workflowsQuery.data?.length ? (
              <Empty className="min-h-80 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilmIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t("No workflows")}</EmptyTitle>
                  <EmptyDescription>
                    {t(
                      "Create a study sheet, quiz, podcast, presentation or video from a project's sources."
                    )}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    onClick={() => setCreateOpen(true)}
                    disabled={!isOnline}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {t("Plan an artifact")}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="grid min-h-[34rem] gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("Activity")}</CardTitle>
                    <CardDescription>
                      {t(
                        "{count, plural, one {# workflow} other {# workflows}}",
                        { count: workflowsQuery.data.length }
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-2">
                    <ItemGroup className="gap-1">
                      {workflowsQuery.data.map((run) => (
                        <Button
                          key={run.id}
                          variant={
                            selectedWorkflow?.id === run.id
                              ? "secondary"
                              : "ghost"
                          }
                          className="h-auto w-full justify-start px-2 py-2 text-left"
                          onClick={() => setSelectedRunId(run.id)}
                          aria-pressed={selectedWorkflow?.id === run.id}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {artifactKindLabel(run.kind)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatDate(format, run.updatedAt)}
                            </span>
                          </span>
                          <Badge variant={workflowStatusVariant(run.status)}>
                            {workflowStatusLabel(run.status)}
                          </Badge>
                        </Button>
                      ))}
                    </ItemGroup>
                  </CardContent>
                </Card>

                <Card>
                  {workflow ? (
                    <>
                      <CardHeader>
                        <CardTitle>
                          {artifactKindLabel(workflow.kind)}
                        </CardTitle>
                        <CardDescription>
                          {workflow.workflowId} · {t("version")}{" "}
                          {workflow.workflowVersion}
                        </CardDescription>
                        <CardAction>
                          <Badge
                            variant={workflowStatusVariant(workflow.status)}
                          >
                            {workflowStatusLabel(workflow.status)}
                          </Badge>
                        </CardAction>
                      </CardHeader>
                      <CardContent
                        className="flex flex-col gap-5"
                        aria-live="polite"
                        aria-busy={
                          !TERMINAL_WORKFLOW_STATUSES.has(workflow.status)
                        }
                      >
                        <Progress value={workflowProgress}>
                          <ProgressLabel>{t("Overall progress")}</ProgressLabel>
                          <ProgressValue>
                            {() => `${workflowProgress} %`}
                          </ProgressValue>
                        </Progress>

                        {workflow.reasonCode || workflow.safeError ? (
                          <Alert variant="destructive">
                            <CircleAlertIcon />
                            <AlertTitle>
                              {workflow.reasonCode || t("Workflow failed")}
                            </AlertTitle>
                            <AlertDescription>
                              {workflow.safeError ||
                                t(
                                  "The workflow cannot advance from its current state."
                                )}
                            </AlertDescription>
                          </Alert>
                        ) : null}

                        <ItemGroup>
                          {workflow.stages.map((stage) => {
                            const progress = stageProgress(
                              stage.processed,
                              stage.total
                            )
                            return (
                              <Item key={stage.id} variant="outline">
                                <ItemMedia variant="icon">
                                  {stage.status === "completed" ? (
                                    <CheckCircle2Icon className="text-primary" />
                                  ) : stage.status === "failed" ? (
                                    <CircleAlertIcon className="text-destructive" />
                                  ) : (
                                    <Clock3Icon />
                                  )}
                                </ItemMedia>
                                <ItemContent>
                                  <ItemTitle>
                                    {stage.position + 1}.{" "}
                                    {stageLabel(stage.key)}
                                    <Badge
                                      variant={workflowStatusVariant(
                                        stage.status
                                      )}
                                    >
                                      {workflowStatusLabel(stage.status)}
                                    </Badge>
                                  </ItemTitle>
                                  <ItemDescription>
                                    {stage.message ||
                                      (stage.placement === "unavailable"
                                        ? t(
                                            "No conforming placement is available."
                                          )
                                        : t("Placement: {placement}", {
                                            placement: stage.placement,
                                          }))}
                                  </ItemDescription>
                                  <Progress value={progress} className="mt-1">
                                    <ProgressValue>
                                      {() =>
                                        stage.total > 0
                                          ? `${stage.processed}/${stage.total} ${stage.unit}`
                                          : t("Waiting")
                                      }
                                    </ProgressValue>
                                  </Progress>
                                  {stage.safeError ? (
                                    <p className="text-xs text-destructive">
                                      {stage.safeError}
                                    </p>
                                  ) : null}
                                </ItemContent>
                                {stageCanApprove(stage.status) ||
                                stageCanRetry(stage.status) ? (
                                  <ItemActions>
                                    {stageCanApprove(stage.status) ? (
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          approve.mutate({
                                            runId: workflow.id,
                                            stageId: stage.id,
                                          })
                                        }
                                        disabled={
                                          !isOnline || approve.isPending
                                        }
                                      >
                                        {t("Approve")}
                                      </Button>
                                    ) : null}
                                    {stageCanRetry(stage.status) ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          retry.mutate({
                                            runId: workflow.id,
                                            stageId: stage.id,
                                          })
                                        }
                                        disabled={!isOnline || retry.isPending}
                                      >
                                        <RefreshCwIcon data-icon="inline-start" />
                                        {t("Retry")}
                                      </Button>
                                    ) : null}
                                  </ItemActions>
                                ) : null}
                              </Item>
                            )
                          })}
                        </ItemGroup>
                      </CardContent>
                      <CardFooter className="justify-between gap-3">
                        <span className="text-xs text-muted-foreground">
                          {t("Updated {date}", {
                            date: formatDate(format, workflow.updatedAt),
                          })}
                        </span>
                        {!TERMINAL_WORKFLOW_STATUSES.has(workflow.status) ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              cancel.mutate({ runId: workflow.id })
                            }
                            disabled={!isOnline || cancel.isPending}
                          >
                            <BanIcon data-icon="inline-start" />
                            {t("Cancel")}
                          </Button>
                        ) : null}
                      </CardFooter>
                    </>
                  ) : null}
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="artifacts" className="pt-3">
            {artifactsQuery.error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{t("Artifacts unavailable")}</AlertTitle>
                <AlertDescription>
                  {artifactsQuery.error.message}
                </AlertDescription>
              </Alert>
            ) : artifactsQuery.isPending ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
                <Skeleton className="h-96" />
                <Skeleton className="h-96" />
              </div>
            ) : !artifactsQuery.data?.length ? (
              <Empty className="min-h-80 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileOutputIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t("No published artifacts")}</EmptyTitle>
                  <EmptyDescription>
                    {t(
                      "An identity appears here as soon as planning starts; its revisions remain immutable and comparable."
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid min-h-[34rem] gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("Generated library")}</CardTitle>
                    <CardDescription>
                      {t(
                        "{count, plural, one {# artifact} other {# artifacts}}",
                        { count: artifactsQuery.data.length }
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-2">
                    <ItemGroup className="gap-1">
                      {artifactsQuery.data.map((artifact) => (
                        <Button
                          key={artifact.id}
                          variant={
                            selectedArtifact?.id === artifact.id
                              ? "secondary"
                              : "ghost"
                          }
                          className="h-auto w-full justify-start px-2 py-2 text-left"
                          onClick={() => {
                            setSelectedArtifactId(artifact.id)
                            setSelectedRevisionId(null)
                            setCompareRevisionId(null)
                          }}
                          aria-pressed={selectedArtifact?.id === artifact.id}
                        >
                          <FileOutputIcon data-icon="inline-start" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {artifact.title}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {artifactKindLabel(artifact.kind)}
                            </span>
                          </span>
                          <Badge variant="outline">{artifact.state}</Badge>
                        </Button>
                      ))}
                    </ItemGroup>
                  </CardContent>
                </Card>

                <Card>
                  {selectedArtifact ? (
                    <>
                      <CardHeader>
                        <CardTitle>{selectedArtifact.title}</CardTitle>
                        <CardDescription>
                          {artifactKindLabel(selectedArtifact.kind)} ·{" "}
                          {t("identity revision {revision}", {
                            revision: String(selectedArtifact.identityRevision),
                          })}
                        </CardDescription>
                        <CardAction>
                          <Badge variant="outline">
                            {selectedArtifact.state}
                          </Badge>
                        </CardAction>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-5">
                        <div>
                          <h3 className="mb-2 font-medium">{t("Revisions")}</h3>
                          {revisionsQuery.isPending ? (
                            <div
                              className="flex flex-col gap-2"
                              role="status"
                              aria-label={t("Loading revisions")}
                            >
                              <Skeleton className="h-14" />
                              <Skeleton className="h-14" />
                            </div>
                          ) : revisionsQuery.error ? (
                            <Alert variant="destructive">
                              <AlertTitle>
                                {t("Revision history unavailable")}
                              </AlertTitle>
                              <AlertDescription>
                                {revisionsQuery.error.message}
                              </AlertDescription>
                            </Alert>
                          ) : !revisionsQuery.data?.length ? (
                            <Alert>
                              <Clock3Icon />
                              <AlertTitle>
                                {t("First output pending")}
                              </AlertTitle>
                              <AlertDescription>
                                {t(
                                  "The workflow exists, but no revision has been published yet."
                                )}
                              </AlertDescription>
                            </Alert>
                          ) : (
                            <ItemGroup className="gap-2">
                              {revisionsQuery.data.map((revision) => (
                                <Item
                                  key={revision.id}
                                  variant={
                                    selectedRevision?.id === revision.id
                                      ? "muted"
                                      : "outline"
                                  }
                                  size="sm"
                                >
                                  <ItemMedia variant="icon">
                                    <HistoryIcon />
                                  </ItemMedia>
                                  <ItemContent>
                                    <ItemTitle>
                                      {t("Revision {revision}", {
                                        revision: String(revision.revision),
                                      })}
                                      {revision.current ? (
                                        <Badge>{t("Published")}</Badge>
                                      ) : null}
                                    </ItemTitle>
                                    <ItemDescription>
                                      {revision.outputMime} ·{" "}
                                      {formatDate(format, revision.createdAt)}
                                    </ItemDescription>
                                  </ItemContent>
                                  <ItemActions>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setSelectedRevisionId(revision.id)
                                        if (compareRevisionId === revision.id) {
                                          setCompareRevisionId(null)
                                        }
                                      }}
                                    >
                                      {t("Inspect")}
                                    </Button>
                                    {!revision.current ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          promote.mutate({
                                            artifactId: selectedArtifact.id,
                                            artifactRevisionId: revision.id,
                                            expectedIdentityRevision:
                                              selectedArtifact.identityRevision,
                                          })
                                        }
                                        disabled={
                                          !isOnline || promote.isPending
                                        }
                                      >
                                        <RotateCcwIcon data-icon="inline-start" />
                                        {t("Publish")}
                                      </Button>
                                    ) : null}
                                  </ItemActions>
                                </Item>
                              ))}
                            </ItemGroup>
                          )}
                        </div>

                        {selectedRevision ? (
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <h3 className="font-medium">
                                  {t("Revision {revision}", {
                                    revision: String(selectedRevision.revision),
                                  })}
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                  {t("Manifest")}{" "}
                                  {selectedRevision.manifestDigest.slice(0, 12)}
                                  …
                                </p>
                              </div>
                              <div className="flex flex-wrap justify-end gap-2">
                                {revisionsQuery.data &&
                                revisionsQuery.data.length > 1 ? (
                                  <Select
                                    value={compareRevisionId ?? "none"}
                                    onValueChange={(value) =>
                                      setCompareRevisionId(
                                        value === "none" ? null : value
                                      )
                                    }
                                  >
                                    <SelectTrigger
                                      size="sm"
                                      className="w-44"
                                      aria-label={t("Compare with revision")}
                                    >
                                      <SelectValue placeholder={t("Compare")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        <SelectItem value="none">
                                          {t("No comparison")}
                                        </SelectItem>
                                        {revisionsQuery.data
                                          .filter(
                                            (revision) =>
                                              revision.id !==
                                              selectedRevision.id
                                          )
                                          .map((revision) => (
                                            <SelectItem
                                              key={revision.id}
                                              value={revision.id}
                                            >
                                              {t("Revision {revision}", {
                                                revision: String(
                                                  revision.revision
                                                ),
                                              })}
                                            </SelectItem>
                                          ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setCreateSeed({
                                      projectId: selectedArtifact.projectId,
                                      kind: selectedArtifact.kind,
                                      title: `${selectedArtifact.title} — ${t("revision")}`,
                                      parentArtifactRevisionIds: [
                                        selectedRevision.id,
                                      ],
                                    })
                                    setCreateOpen(true)
                                  }}
                                  disabled={!isOnline}
                                >
                                  <RefreshCwIcon data-icon="inline-start" />
                                  {t("Revise")}
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => setPreviewOpen(true)}
                                  disabled={!selectedRevision.outputFileId}
                                >
                                  <EyeIcon data-icon="inline-start" />
                                  {t("Preview")}
                                </Button>
                              </div>
                            </div>

                            <Collapsible>
                              <CollapsibleTrigger
                                render={<Button variant="outline" size="sm" />}
                              >
                                <ChevronDownIcon data-icon="inline-start" />
                                {t("Manifest and provenance")}
                              </CollapsibleTrigger>
                              <CollapsibleContent className="mt-2">
                                {manifestQuery.isPending ? (
                                  <Skeleton className="h-48" />
                                ) : manifestQuery.error ? (
                                  <Alert variant="destructive">
                                    <AlertTitle>
                                      {t("Manifest unavailable")}
                                    </AlertTitle>
                                    <AlertDescription>
                                      {manifestQuery.error.message}
                                    </AlertDescription>
                                  </Alert>
                                ) : (
                                  <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                                    {JSON.stringify(
                                      manifestQuery.data,
                                      null,
                                      2
                                    )}
                                  </pre>
                                )}
                              </CollapsibleContent>
                            </Collapsible>

                            {comparisonRevision ? (
                              <Card size="sm">
                                <CardHeader>
                                  <CardTitle>
                                    {t("Revision comparison")}
                                  </CardTitle>
                                  <CardDescription>
                                    {t(
                                      "Immutable output metadata is compared side by side. Content remains available through each preview."
                                    )}
                                  </CardDescription>
                                </CardHeader>
                                <CardContent className="grid gap-3 sm:grid-cols-2">
                                  {[selectedRevision, comparisonRevision].map(
                                    (revision) => (
                                      <dl
                                        key={revision.id}
                                        className="grid gap-2 rounded-lg border p-3 text-sm"
                                      >
                                        <div>
                                          <dt className="text-xs text-muted-foreground">
                                            {t("Revision")}
                                          </dt>
                                          <dd className="font-medium">
                                            {revision.revision}
                                            {revision.current
                                              ? ` · ${t("Published")}`
                                              : ""}
                                          </dd>
                                        </div>
                                        <div>
                                          <dt className="text-xs text-muted-foreground">
                                            {t("Output")}
                                          </dt>
                                          <dd>{revision.outputMime}</dd>
                                        </div>
                                        <div>
                                          <dt className="text-xs text-muted-foreground">
                                            {t("Created")}
                                          </dt>
                                          <dd>
                                            {formatDate(
                                              format,
                                              revision.createdAt
                                            )}
                                          </dd>
                                        </div>
                                        <div>
                                          <dt className="text-xs text-muted-foreground">
                                            {t("Manifest")}
                                          </dt>
                                          <dd
                                            className="truncate font-mono text-xs"
                                            title={revision.manifestDigest}
                                          >
                                            {revision.manifestDigest}
                                          </dd>
                                        </div>
                                      </dl>
                                    )
                                  )}
                                </CardContent>
                              </Card>
                            ) : null}
                          </div>
                        ) : null}
                      </CardContent>
                      <CardFooter className="justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setState.mutate({
                              artifactId: selectedArtifact.id,
                              expectedIdentityRevision:
                                selectedArtifact.identityRevision,
                              state:
                                selectedArtifact.state === "archived"
                                  ? "active"
                                  : "archived",
                            })
                          }
                          disabled={!isOnline || setState.isPending}
                        >
                          <ArchiveIcon data-icon="inline-start" />
                          {selectedArtifact.state === "archived"
                            ? t("Reactivate")
                            : t("Archive")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setState.mutate({
                              artifactId: selectedArtifact.id,
                              expectedIdentityRevision:
                                selectedArtifact.identityRevision,
                              state: "trashed",
                            })
                          }
                          disabled={!isOnline || setState.isPending}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          {t("Move to trash")}
                        </Button>
                      </CardFooter>
                    </>
                  ) : null}
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {createOpen ? (
        <CreateArtifactDialog
          key={createSeed?.parentArtifactRevisionIds[0] ?? "new-artifact"}
          open
          onOpenChange={setCreateOpen}
          projects={projectsQuery.data ?? []}
          defaultProjectId={projectId}
          initialPlan={createSeed}
          pending={plan.isPending || !isOnline}
          onSubmit={submitPlan}
        />
      ) : null}
      {previewOpen ? (
        <ArtifactOutputDialog
          key={selectedRevision?.id ?? "no-revision"}
          open
          onOpenChange={setPreviewOpen}
          artifactTitle={selectedArtifact?.title ?? t("Artifact")}
          revision={selectedRevision}
        />
      ) : null}
    </>
  )
}
