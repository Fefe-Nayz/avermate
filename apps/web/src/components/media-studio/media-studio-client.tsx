"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  FileOutputIcon,
  PlusIcon,
  Settings2Icon,
  SparklesIcon,
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ItemGroup } from "@/components/ui/item"
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
import { ArtifactDetailPanel } from "./artifact-detail-panel"
import { WorkflowActivityPanel } from "./workflow-activity-panel"
import { ArtifactOutputDialog } from "./artifact-output-dialog"
import {
  CreateArtifactDialog,
  type ArtifactPlanSeed,
  type ArtifactPlanValue,
} from "./create-artifact-dialog"
import {
  selectedArtifactFromResults,
  TERMINAL_WORKFLOW_STATUSES,
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

export function MediaStudioClient({
  initialProjectId = null,
  initialArtifactId = null,
}: {
  initialProjectId?: string | null
  initialArtifactId?: string | null
}) {
  const t = useExtracted()
  const format = useFormatter()
  const isOnline = useOnlineStatus()
  const { artifactKindLabel, capabilityReason } = useMediaStudioCopy()
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState<string | null>(initialProjectId)
  const [tab, setTab] = useState(initialArtifactId ? "artifacts" : "workflows")
  const [createOpen, setCreateOpen] = useState(false)
  const [createSeed, setCreateSeed] = useState<ArtifactPlanSeed | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    initialArtifactId
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

  const selectedArtifact = selectedArtifactFromResults(
    artifactsQuery.data,
    selectedArtifactId
  )
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
      description: t(
        "Imports the subtitle tracks you allowed, exactly as they are."
      ),
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
      description: t("Runs the reviewed script in a sandbox."),
    },
  ]
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
                "What is already downloaded stays readable. Anything new waits until you are back online."
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
                {t("What the studio can make")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("Each one is checked before it is offered.")}
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
            /* One bordered list, not a card per capability. Each of these is a
               label, a sentence and a status word; six frames around that is
               six frames too many, and the grid made a short list look like a
               dashboard. */
            <ul className="divide-y rounded-xl border">
              {capabilities.map((item) => {
                const capability = capabilitiesQuery.data?.[item.key]
                return (
                  <li
                    key={item.key}
                    className="flex flex-wrap items-start gap-x-4 gap-y-1 p-3"
                  >
                    <div className="min-w-48 flex-1">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-pretty text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {capability
                          ? capabilityReason(capability)
                          : t("Checking…")}
                      </span>
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
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* This one stays its own panel: it is a permission you grant, not a
              status you read, and it is the only thing on the screen that can
              reach outside Avermate. */}
          <div
            id="video-audio-fallback"
            className="mt-3 scroll-mt-24 rounded-xl border p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">
                  {t("Taking the sound from a video")}
                </h3>
                <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
                  {t(
                    "When a video has no subtitles we can read, we can transcribe its sound instead — but only if you allow it here. Allowing it downloads nothing by itself."
                  )}
                </p>
              </div>
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
                      ? t("Allowed")
                      : t("Not allowed")}
                </Badge>
              )}
            </div>
            <p className="mt-2 max-w-prose text-sm text-pretty text-muted-foreground">
              {videoConsentQuery.data?.revision === "video-audio-extraction.v1"
                ? t(
                    "Audio extraction starts only when you request it. It is not available for protected, private, authenticated, age-restricted or publisher-blocked media."
                  )
                : (videoConsentQuery.data?.notice ??
                  t(
                    "Only the video you ask for is processed, and the platform's own rules still apply."
                  ))}
            </p>
            {videoConsentQuery.data?.active &&
            videoConsentQuery.data.acceptedAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Allowed on {date}", {
                  date: format.dateTime(
                    new Date(videoConsentQuery.data.acceptedAt),
                    { dateStyle: "medium", timeStyle: "short" }
                  ),
                })}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
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
                {t("Withdraw")}
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
                {t("Allow it")}
              </Button>
            </div>
          </div>
        </section>

        <Separator />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            variant="line"
            className="no-scrollbar max-w-full overflow-x-auto overflow-y-hidden"
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
            <WorkflowActivityPanel
              workflowsQuery={workflowsQuery}
              selectedWorkflow={selectedWorkflow}
              workflow={workflow}
              artifactKindLabel={artifactKindLabel}
              setCreateOpen={setCreateOpen}
              setSelectedRunId={setSelectedRunId}
              approve={approve}
              retry={retry}
              cancel={cancel}
              isOnline={isOnline}
              formatDate={formatDate}
            />
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
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
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
                      "It appears here as soon as planning starts, and every version stays available to compare."
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

                <ArtifactDetailPanel
                  selectedArtifact={selectedArtifact}
                  selectedRevision={selectedRevision}
                  comparisonRevision={comparisonRevision}
                  compareRevisionId={compareRevisionId}
                  revisionsQuery={revisionsQuery}
                  manifestQuery={manifestQuery}
                  setState={setState}
                  promote={promote}
                  isOnline={isOnline}
                  formatDate={formatDate}
                  artifactKindLabel={artifactKindLabel}
                  setPreviewOpen={setPreviewOpen}
                  setCreateOpen={setCreateOpen}
                  setCreateSeed={setCreateSeed}
                  setCompareRevisionId={setCompareRevisionId}
                  setSelectedRevisionId={setSelectedRevisionId}
                />
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
