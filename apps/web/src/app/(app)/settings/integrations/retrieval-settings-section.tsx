"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DatabaseZapIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { SettingsSection } from "@/components/settings/settings-section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Progress, ProgressValue } from "@/components/ui/progress"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"

type ConsentTarget = {
  provider: "gemini" | "cohere"
  capability: "embedding" | "rerank"
  action: "grant" | "revoke"
  disclosureRevision: string
  summary: string
}

function dateLabel(
  format: ReturnType<typeof useFormatter>,
  value: string | null | undefined
) {
  if (!value) return "—"
  return format.dateTime(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function generationProgress(indexed: number, expected: number) {
  if (expected <= 0) return indexed > 0 ? 100 : 0
  return Math.min(100, Math.max(0, Math.round((indexed / expected) * 100)))
}

function ProviderReadinessCard({
  label,
  description,
  provider,
  placement,
  capability,
  configured,
  credentialReady,
  consentReady,
  disclosureRevision,
  disclosure,
  onConsent,
  credentialManaged = true,
  consentManaged = true,
  disabled = false,
}: {
  label: string
  description: string
  provider: "gemini" | "cohere"
  placement: string | null
  capability: "embedding" | "rerank"
  configured: boolean
  credentialReady: boolean
  consentReady: boolean
  disclosureRevision: string
  disclosure: string
  onConsent: (target: ConsentTarget) => void
  credentialManaged?: boolean
  consentManaged?: boolean
  disabled?: boolean
}) {
  const t = useExtracted()
  const ready = configured && credentialReady && consentReady
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={ready ? "default" : "outline"}>
            {ready ? t("Ready") : t("Setup required")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2">
          <Item size="xs" variant="muted">
            <ItemMedia variant="icon">
              {configured ? <CheckCircle2Icon /> : <CircleAlertIcon />}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t("Server placement")}</ItemTitle>
              <ItemDescription>
                {configured
                  ? placement === "node"
                    ? t("Paired Node")
                    : placement === "managed"
                      ? t("Managed service")
                      : placement === "hosted-core"
                        ? t("Direct BYOK")
                        : placement === "full-self-host" ||
                            placement === "local-or-node"
                          ? t("Local or self-hosted route")
                          : t("Avermate Core")
                  : t("Adapter not configured")}
              </ItemDescription>
            </ItemContent>
          </Item>
          {credentialManaged ? (
            <Item size="xs" variant="muted">
              <ItemMedia variant="icon">
                {credentialReady ? <KeyRoundIcon /> : <CircleAlertIcon />}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t("Personal key")}</ItemTitle>
                <ItemDescription>
                  {credentialReady ? t("Validated") : t("Add a provider key")}
                </ItemDescription>
              </ItemContent>
            </Item>
          ) : null}
          <Item size="xs" variant="muted">
            <ItemMedia variant="icon">
              {consentReady ? <ShieldCheckIcon /> : <ShieldXIcon />}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {consentManaged ? t("Data consent") : t("Local processing")}
              </ItemTitle>
              <ItemDescription>
                {consentManaged
                  ? consentReady
                    ? t("Consent active")
                    : t("Explicit consent required")
                  : t("No data is sent to a cloud provider")}
              </ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        {credentialManaged && !credentialReady ? (
          <Button
            size="sm"
            variant="outline"
            render={<Link href="/settings/integrations#ai-keys" />}
          >
            <KeyRoundIcon data-icon="inline-start" />
            {t("Add a key")}
          </Button>
        ) : (
          <span />
        )}
        {consentManaged ? (
          <Button
            size="sm"
            variant={consentReady ? "destructive" : "default"}
            disabled={disabled}
            onClick={() =>
              onConsent({
                provider,
                capability,
                action: consentReady ? "revoke" : "grant",
                disclosureRevision,
                summary: disclosure,
              })
            }
          >
            {consentReady ? t("Revoke") : t("Review and authorize")}
          </Button>
        ) : (
          <Badge variant="outline">{t("No cloud egress")}</Badge>
        )}
      </CardFooter>
    </Card>
  )
}

function ProjectRetrievalEditor({
  project,
  embeddingSpaces,
  rerankSpaceId,
  advancedReady,
  online,
  pending,
  onSave,
}: {
  project: {
    id: string
    revision: number
    retrievalMode: string
    retrievalFallbackPolicy: string
    embeddingSpaceId: string | null
    rerankSpaceId: string | null
  }
  embeddingSpaces: readonly { id: string; createdAt: string | null }[]
  rerankSpaceId: string | null
  advancedReady: boolean
  online: boolean
  pending: boolean
  onSave: (value: {
    projectId: string
    revision: number
    retrievalMode: "lexical-only" | "advanced-auto"
    fallbackPolicy: "fail" | "lexical-only" | "hybrid-without-rerank"
    embeddingSpaceId: string | null
    rerankSpaceId: string | null
  }) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const [mode, setMode] = useState<"lexical-only" | "advanced-auto">(
    project.retrievalMode === "advanced-auto" ? "advanced-auto" : "lexical-only"
  )
  const [fallback, setFallback] = useState<
    "fail" | "lexical-only" | "hybrid-without-rerank"
  >(
    project.retrievalFallbackPolicy === "fail" ||
      project.retrievalFallbackPolicy === "hybrid-without-rerank"
      ? project.retrievalFallbackPolicy
      : "lexical-only"
  )
  const [embeddingSpaceId, setEmbeddingSpaceId] = useState<string | null>(
    project.embeddingSpaceId ?? embeddingSpaces[0]?.id ?? null
  )
  const modeItems = [
    { label: t("Lexical only"), value: "lexical-only" as const },
    { label: t("Automatic advanced RAG"), value: "advanced-auto" as const },
  ]
  const fallbackItems = [
    { label: t("Fail explicitly"), value: "fail" as const },
    {
      label: t("Continue with lexical search"),
      value: "lexical-only" as const,
    },
    {
      label: t("Hybrid without reranking"),
      value: "hybrid-without-rerank" as const,
    },
  ]
  const spaceItems = embeddingSpaces.map((space) => ({
    label: `${space.id.slice(0, 18)}… · ${dateLabel(format, space.createdAt)}`,
    value: space.id,
  }))

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>{t("Search mode")}</FieldLabel>
        <Select
          items={modeItems}
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          {t(
            "Advanced mode searches by keyword and by meaning, merges the two rankings, drops near-duplicates, re-scores what is left, pulls in the surrounding passages and cites each one exactly."
          )}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel>{t("Fallback policy")}</FieldLabel>
        <Select
          items={fallbackItems}
          value={fallback}
          onValueChange={(value) => {
            if (value) setFallback(value)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {fallbackItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          {t(
            "The lexical index is always preserved; changing models never deletes it."
          )}
        </FieldDescription>
      </Field>

      {mode === "advanced-auto" ? (
        <Field>
          <FieldLabel>{t("Embedding model is fixed")}</FieldLabel>
          <Select
            items={spaceItems}
            value={embeddingSpaceId}
            onValueChange={setEmbeddingSpaceId}
            disabled={!spaceItems.length}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  spaceItems.length ? t("Choose a space") : t("No active space")
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {spaceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {t(
              "Dimensions, model, preprocessing and placement are part of the identity. A change creates a new generation."
            )}
          </FieldDescription>
        </Field>
      ) : null}

      {mode === "advanced-auto" && !advancedReady ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t("Advanced pipeline incomplete")}</AlertTitle>
          <AlertDescription>
            {t(
              "A key, explicit consent, an active embedding space and a configured reranker are required. Lexical search remains available."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={
            pending ||
            !online ||
            (mode === "advanced-auto" &&
              (!advancedReady || !embeddingSpaceId || !rerankSpaceId))
          }
          onClick={() =>
            onSave({
              projectId: project.id,
              revision: project.revision,
              retrievalMode: mode,
              fallbackPolicy: fallback,
              embeddingSpaceId:
                mode === "advanced-auto" ? embeddingSpaceId : null,
              rerankSpaceId: mode === "advanced-auto" ? rerankSpaceId : null,
            })
          }
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t("Save project retrieval")}
        </Button>
      </div>
    </FieldGroup>
  )
}

export function RetrievalSettingsSection() {
  const t = useExtracted()
  const format = useFormatter()
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [consentTarget, setConsentTarget] = useState<ConsentTarget | null>(null)
  const [clearIndexOpen, setClearIndexOpen] = useState(false)

  const readiness = useQuery({
    ...orpc.retrieval.readiness.queryOptions(),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) =>
        ["queued", "running", "pending"].includes(job.status)
      )
        ? 1_500
        : false,
  })
  const projects = useQuery({
    ...orpc.projects.list.queryOptions({ input: { include: "live" } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const project = useQuery({
    ...orpc.projects.get.queryOptions({
      input: { projectId: projectId ?? "_" },
    }),
    enabled: Boolean(projectId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const traces = useQuery({
    ...orpc.retrieval.traces.queryOptions({ input: { limit: 10 } }),
  })
  const evaluations = useQuery({
    ...orpc.retrieval.evaluations.queryOptions({ input: { limit: 5 } }),
  })

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.retrieval.readiness.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.retrieval.traces.queryKey({ input: { limit: 10 } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.retrieval.evaluations.queryKey({ input: { limit: 5 } }),
      }),
      ...(projectId
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.projects.get.queryKey({ input: { projectId } }),
            }),
          ]
        : []),
    ])
  }

  const grant = useMutation({
    ...orpc.retrieval.grantConsent.mutationOptions(),
    onSuccess: async () => {
      setConsentTarget(null)
      await refresh()
      toast.success(t("Retrieval provider consent saved."))
    },
    onError: (error) => toast.error(error.message),
  })
  const revoke = useMutation({
    ...orpc.retrieval.revokeConsent.mutationOptions(),
    onSuccess: async () => {
      setConsentTarget(null)
      await refresh()
      toast.success(t("Retrieval provider consent revoked."))
    },
    onError: (error) => toast.error(error.message),
  })
  const update = useMutation({
    ...orpc.retrieval.updateProject.mutationOptions(),
    onSuccess: async () => {
      await refresh()
      toast.success(t("Project retrieval settings saved."))
    },
    onError: (error) => toast.error(error.message),
  })
  const reindex = useMutation({
    ...orpc.retrieval.reindex.mutationOptions(),
    onSuccess: async () => {
      await refresh()
      toast.success(t("Corpus reindexing queued."))
    },
    onError: (error) => toast.error(error.message),
  })
  const evaluate = useMutation({
    ...orpc.retrieval.evaluate.mutationOptions(),
    onSuccess: async () => {
      await refresh()
      toast.success(t("School retrieval regression fixture queued."))
    },
    onError: (error) => toast.error(error.message),
  })
  const clearIndex = useMutation({
    ...orpc.retrieval.clearIndex.mutationOptions(),
    onSuccess: async (result) => {
      setClearIndexOpen(false)
      await refresh()
      toast.success(
        t("Rebuildable retrieval index cleared for {count} versions.", {
          count: String(result.versions),
        })
      )
    },
    onError: (error) => toast.error(error.message),
  })

  const data = readiness.data
  const geminiDisclosure = data?.disclosures.find(
    (entry) => entry.provider === "gemini"
  )
  const cohereDisclosure = data?.disclosures.find(
    (entry) => entry.provider === "cohere"
  )
  const advancedReady = Boolean(
    data?.embedding.complete &&
    data.embedding.credentialReady &&
    data.embedding.consentReady &&
    data.embedding.spaces.length &&
    data.rerank.complete &&
    data.rerank.configuredSpaceId &&
    (data.rerank.provider !== "cohere" ||
      (data.rerank.credentialReady && data.rerank.consentReady))
  )
  const projectItems = (projects.data ?? []).map((entry) => ({
    label: entry.title,
    value: entry.id,
  }))

  return (
    <SettingsSection
      id="retrieval"
      icon={SearchCheckIcon}
      title={t("Advanced retrieval")}
      description={t(
        "Configure lexical and multimodal retrieval, reranking, explicit data consent and measured evaluation for each study project."
      )}
    >
      {!isOnline ? (
        <Alert role="status">
          <CircleAlertIcon />
          <AlertTitle>{t("You are offline")}</AlertTitle>
          <AlertDescription>
            {t(
              "Saved settings and indexes remain intact. Provider checks, reindexing and evaluations resume after reconnection."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {readiness.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t("RAG status unavailable")}</AlertTitle>
          <AlertDescription>{readiness.error.message}</AlertDescription>
        </Alert>
      ) : readiness.isPending ? (
        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          role="status"
          aria-label={t("Loading retrieval readiness")}
        >
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ProviderReadinessCard
            label="Gemini Embedding 2"
            description={t(
              "Text, PDF pages and images; one page or meaningful segment per request."
            )}
            provider="gemini"
            placement={data.embedding.placement}
            capability="embedding"
            configured={data.embedding.complete}
            credentialReady={data.embedding.credentialReady}
            consentReady={data.embedding.consentReady}
            disclosureRevision={geminiDisclosure?.revision ?? ""}
            disclosure={geminiDisclosure?.summary ?? ""}
            onConsent={setConsentTarget}
            credentialManaged
            consentManaged
            disabled={!isOnline}
          />
          <ProviderReadinessCard
            label={
              data.rerank.provider === "tei"
                ? t("Local TEI reranker")
                : t("Cohere Rerank")
            }
            description={t(
              "Re-scores the merged, de-duplicated results before surrounding passages are added."
            )}
            provider="cohere"
            placement={data.rerank.placement}
            capability="rerank"
            configured={data.rerank.complete}
            credentialReady={
              data.rerank.provider === "tei" || data.rerank.credentialReady
            }
            consentReady={
              data.rerank.provider === "tei" || data.rerank.consentReady
            }
            disclosureRevision={cohereDisclosure?.revision ?? ""}
            disclosure={cohereDisclosure?.summary ?? ""}
            onConsent={setConsentTarget}
            credentialManaged={data.rerank.provider !== "tei"}
            consentManaged={data.rerank.provider !== "tei"}
            disabled={!isOnline}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("Policy per project")}</CardTitle>
          <CardDescription>
            {t(
              "The project pins the exact spaces used; an older conversation preserves its generation and citations."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{t("Study project")}</FieldLabel>
            <Select
              items={projectItems}
              value={projectId}
              onValueChange={setProjectId}
              disabled={!projectItems.length}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("Choose a project")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {projectItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {!projectId ? (
            <Empty className="min-h-40 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <DatabaseZapIcon />
                </EmptyMedia>
                <EmptyTitle>{t("Choose a project")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "Advanced retrieval is deliberately configured per project, not as an ambiguous global switch."
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : project.isPending ? (
            <Skeleton className="h-80" />
          ) : project.error ? (
            <Alert variant="destructive">
              <AlertTitle>{t("Project unavailable")}</AlertTitle>
              <AlertDescription>{project.error.message}</AlertDescription>
            </Alert>
          ) : project.data && data ? (
            <ProjectRetrievalEditor
              key={`${project.data.project.id}:${project.data.project.revision}`}
              project={project.data.project}
              embeddingSpaces={data.embedding.spaces}
              rerankSpaceId={data.rerank.configuredSpaceId}
              advancedReady={advancedReady}
              online={isOnline}
              pending={update.isPending}
              onSave={(value) => update.mutate(value)}
            />
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={
              !isOnline ||
              clearIndex.isPending ||
              !data?.embedding.generations.length
            }
            onClick={() => setClearIndexOpen(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            {t("Clear rebuildable index")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              !isOnline || reindex.isPending || !data?.embedding.complete
            }
            onClick={() =>
              reindex.mutate({ projectId: projectId ?? undefined })
            }
          >
            {reindex.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {projectId
              ? t("Reindex this project")
              : t("Reindex the entire corpus")}
          </Button>
        </CardFooter>
      </Card>

      <Tabs defaultValue="indexing">
        <TabsList variant="line">
          <TabsTrigger value="indexing">{t("Indexing")}</TabsTrigger>
          <TabsTrigger value="traces">{t("Private traces")}</TabsTrigger>
          <TabsTrigger value="evaluations">{t("Evaluations")}</TabsTrigger>
        </TabsList>
        <TabsContent value="indexing" className="pt-3">
          {!data?.embedding.generations.length && !data?.jobs.length ? (
            <Empty className="min-h-32">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <DatabaseZapIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No index generation yet")}</EmptyTitle>
                <EmptyDescription>
                  {t("Start a rebuild when an advanced provider is ready.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {data?.embedding.generations.map((generation) => {
                const progress = generationProgress(
                  generation.indexedVersionCount,
                  generation.expectedVersionCount
                )
                return (
                  <Item key={generation.id} variant="outline">
                    <ItemMedia variant="icon">
                      <DatabaseZapIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {t("Generation")} {generation.id.slice(0, 12)}…
                        <Badge variant="outline">{generation.state}</Badge>
                      </ItemTitle>
                      <ItemDescription>
                        {t("Space")} {generation.spaceId.slice(0, 16)}… ·{" "}
                        {t("updated {date}", {
                          date: dateLabel(format, generation.updatedAt),
                        })}
                      </ItemDescription>
                      <Progress value={progress} className="mt-1">
                        <ProgressValue>
                          {() =>
                            t("{indexed}/{expected} versions", {
                              indexed: String(generation.indexedVersionCount),
                              expected: String(generation.expectedVersionCount),
                            })
                          }
                        </ProgressValue>
                      </Progress>
                    </ItemContent>
                  </Item>
                )
              })}
              {data?.jobs.map((job) => (
                <Item key={job.id} variant="muted" size="sm">
                  <ItemMedia variant="icon">
                    <RefreshCwIcon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {job.kind} <Badge variant="outline">{job.status}</Badge>
                    </ItemTitle>
                    <ItemDescription>
                      {job.error ??
                        t("Updated {date}", {
                          date: dateLabel(format, job.updatedAt),
                        })}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
        </TabsContent>
        <TabsContent value="traces" className="pt-3">
          {traces.isPending ? (
            <Skeleton className="h-40" />
          ) : traces.error ? (
            <Alert variant="destructive">
              <AlertTitle>{t("Traces unavailable")}</AlertTitle>
              <AlertDescription>{traces.error.message}</AlertDescription>
            </Alert>
          ) : !traces.data?.length ? (
            <Empty className="min-h-32">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchCheckIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No retrieval trace yet")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "A privacy-safe trace appears after the first project search."
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {traces.data.map((trace) => (
                <Item key={trace.id} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    <SearchCheckIcon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {t("Operation")} {trace.operationId.slice(0, 12)}…
                      <Badge variant="outline">{trace.fallbackPolicy}</Badge>
                    </ItemTitle>
                    <ItemDescription>
                      {t("Query")} {trace.queryDigest.slice(0, 12)}… ·{" "}
                      {dateLabel(format, trace.createdAt)}
                      {trace.fallbackReason ? ` · ${trace.fallbackReason}` : ""}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
        </TabsContent>
        <TabsContent value="evaluations" className="pt-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {t(
                "Run the fixed sample set to check the scores still come out the same. It contacts no provider, and it does not measure how good the models are."
              )}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !isOnline ||
                evaluate.isPending ||
                !data?.evaluationRunner.available
              }
              onClick={() =>
                data
                  ? evaluate.mutate({
                      fixtureRevision:
                        data.evaluationRunner.fixtureRevisions[0],
                      configurations: [...data.evaluationRunner.configurations],
                    })
                  : undefined
              }
            >
              {evaluate.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <BrainCircuitIcon data-icon="inline-start" />
              )}
              {t("Run regression fixture")}
            </Button>
          </div>
          {evaluations.isPending ? (
            <Skeleton className="h-40" />
          ) : evaluations.error ? (
            <Alert variant="destructive">
              <AlertTitle>{t("Regression fixtures unavailable")}</AlertTitle>
              <AlertDescription>{evaluations.error.message}</AlertDescription>
            </Alert>
          ) : !evaluations.data?.length ? (
            <Empty className="min-h-32">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BrainCircuitIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No retrieval regression run yet")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "This checked-in fixture calls no provider. Use the separate operator live gate as quality evidence before selecting advanced defaults."
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {evaluations.data.map((evaluation) => (
                <Item key={evaluation.id} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    <BrainCircuitIcon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {t("Regression fixture")} {evaluation.fixtureRevision}
                      <Badge variant="outline">{evaluation.status}</Badge>
                    </ItemTitle>
                    <ItemDescription>
                      {evaluation.errorCode ??
                        t("Evaluated {date}", {
                          date: dateLabel(
                            format,
                            evaluation.evaluatedAt ?? evaluation.createdAt
                          ),
                        })}
                    </ItemDescription>
                    {evaluation.metrics ? (
                      <pre className="mt-1 max-h-36 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                        {JSON.stringify(evaluation.metrics, null, 2)}
                      </pre>
                    ) : null}
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={Boolean(consentTarget)}
        onOpenChange={(open) => {
          if (!open) setConsentTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              {consentTarget?.action === "revoke" ? (
                <ShieldXIcon />
              ) : (
                <ShieldCheckIcon />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>
              {consentTarget?.action === "revoke"
                ? t("Revoke this data transfer?")
                : t("Authorize this data transfer?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {consentTarget?.action === "revoke"
                ? t(
                    "New provider requests will be blocked. Lexical indexes and already stored results remain readable."
                  )
                : consentTarget?.summary}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={
                consentTarget?.action === "revoke" ? "destructive" : "default"
              }
              disabled={!isOnline || grant.isPending || revoke.isPending}
              onClick={() => {
                if (!consentTarget) return
                if (consentTarget.action === "grant") {
                  const disclosure = {
                    disclosureRevision: consentTarget.disclosureRevision,
                    policyRevision: "user-direct/1",
                    confirmed: true as const,
                  }
                  grant.mutate(
                    consentTarget.provider === "gemini"
                      ? {
                          provider: "gemini",
                          capability: "embedding",
                          ...disclosure,
                        }
                      : {
                          provider: "cohere",
                          capability: "rerank",
                          ...disclosure,
                        }
                  )
                } else {
                  revoke.mutate(
                    consentTarget.provider === "gemini"
                      ? { provider: "gemini", capability: "embedding" }
                      : { provider: "cohere", capability: "rerank" }
                  )
                }
              }}
            >
              {consentTarget?.action === "revoke"
                ? t("Revoke")
                : t("Authorize")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearIndexOpen} onOpenChange={setClearIndexOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Clear this retrieval index?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {projectId
                ? t(
                    "Source files, transcripts and projects are preserved. Only this project's rebuildable vector derivatives are invalidated; lexical search stays independent."
                  )
                : t(
                    "Source files, transcripts and projects are preserved. Only rebuildable vector derivatives are invalidated; lexical search stays independent."
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!isOnline || clearIndex.isPending}
              onClick={() =>
                clearIndex.mutate({
                  projectId: projectId ?? undefined,
                  confirmation: "delete-rebuildable-index",
                })
              }
            >
              {clearIndex.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t("Clear only the index")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
