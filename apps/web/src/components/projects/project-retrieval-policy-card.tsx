"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  DatabaseZapIcon,
  SearchCheckIcon,
  WifiOffIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { orpc, rpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"

type RetrievalPolicy = Awaited<ReturnType<typeof rpc.projects.retrievalPolicy>>
type RetrievalMode = RetrievalPolicy["configured"]["retrievalMode"]
type FallbackPolicy = RetrievalPolicy["configured"]["fallbackPolicy"]
type StageStatus = "active" | "available" | "needs-attention" | "not-in-use"

const OPTIONAL_RERANK_REASONS = new Set<RetrievalPolicy["reasons"][number]>([
  "rerank-configuration-incomplete",
  "rerank-credential-required",
  "rerank-consent-required",
  "rerank-runtime-unavailable",
  "rerank-space-required",
])

function isConflictError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "CONFLICT"
  )
}

function compatibleSelection(
  configuredId: string | null,
  spaces: readonly { id: string }[]
) {
  return configuredId && spaces.some((space) => space.id === configuredId)
    ? configuredId
    : (spaces[0]?.id ?? null)
}

function useEffectiveModeLabel() {
  const t = useExtracted()
  return (mode: RetrievalPolicy["effectiveMode"]) => {
    if (mode === "reranked") return t("Semantic search with reranking")
    if (mode === "hybrid") return t("Semantic and lexical search")
    if (mode === "lexical") return t("Lexical search")
    return t("Search unavailable")
  }
}

function useDegradedReasonLabel() {
  const t = useExtracted()
  return (reason: RetrievalPolicy["reasons"][number]) => {
    if (reason === "lexical-unavailable")
      return t("The lexical index is unavailable.")
    if (reason === "embedding-reindex-required") {
      return t("The compatible embedding index must be rebuilt.")
    }
    if (reason === "embedding-source-placement-unsupported") {
      return t(
        "Some sources are stored on a paired Node and cannot be processed by the current Core embedding pipeline."
      )
    }
    if (reason.includes("credential")) return t("A provider key is required.")
    if (reason.includes("consent"))
      return t("Explicit provider consent is required.")
    if (reason.includes("space"))
      return t("The selected model space is not compatible.")
    if (reason.startsWith("rerank-"))
      return t("The reranking provider is not ready.")
    if (reason === "vector-index-unavailable") {
      return t("The vector index is unavailable.")
    }
    return t("The embedding provider is not ready.")
  }
}

function ReadinessTile({
  label,
  provider,
  status,
  details,
}: {
  label: string
  provider: string | null
  status: StageStatus
  details: string
}) {
  const t = useExtracted()
  const statusLabel =
    status === "active"
      ? t("Active")
      : status === "available"
        ? t("Available")
        : status === "needs-attention"
          ? t("Needs attention")
          : t("Not in use")
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Badge
          variant={
            status === "active"
              ? "secondary"
              : status === "needs-attention"
                ? "destructive"
                : "outline"
          }
        >
          {statusLabel}
        </Badge>
      </div>
      <p className="text-xs break-words text-muted-foreground">
        {provider ?? t("Not configured")} · {details}
      </p>
    </div>
  )
}

function PolicyEditor({
  policy,
  online,
  saving,
  onSave,
}: {
  policy: RetrievalPolicy
  online: boolean
  saving: boolean
  onSave: (input: {
    projectId: string
    revision: number
    retrievalMode: RetrievalMode
    fallbackPolicy: FallbackPolicy
    embeddingSpaceId: string | null
    rerankSpaceId: string | null
  }) => void
}) {
  const t = useExtracted()
  const [mode, setMode] = useState<RetrievalMode>(
    policy.configured.retrievalMode
  )
  const [fallback, setFallback] = useState<FallbackPolicy>(
    policy.configured.fallbackPolicy
  )
  const [embeddingSpaceId, setEmbeddingSpaceId] = useState<string | null>(
    compatibleSelection(
      policy.configured.embeddingSpaceId,
      policy.embedding.compatibleSpaces
    )
  )
  const [rerankSpaceId, setRerankSpaceId] = useState<string | null>(
    compatibleSelection(
      policy.configured.rerankSpaceId,
      policy.rerank.compatibleSpaces
    )
  )
  const modeDescriptionId = `retrieval-mode-description-${policy.projectId}`
  const embeddingControlId = `embedding-space-${policy.projectId}`
  const embeddingDescriptionId = `${embeddingControlId}-description`
  const rerankControlId = `rerank-space-${policy.projectId}`
  const rerankDescriptionId = `${rerankControlId}-description`
  const fallbackControlId = `fallback-policy-${policy.projectId}`
  const fallbackDescriptionId = `${fallbackControlId}-description`
  const advanced = mode === "advanced-auto"
  const dirty =
    mode !== policy.configured.retrievalMode ||
    fallback !== policy.configured.fallbackPolicy ||
    (advanced &&
      (embeddingSpaceId !== policy.configured.embeddingSpaceId ||
        rerankSpaceId !== policy.configured.rerankSpaceId))
  const embeddingItems = policy.embedding.compatibleSpaces.map((space) => ({
    value: space.id,
    label: `${space.provider} · ${space.model} · ${space.dimensions}d`,
  }))
  const rerankItems = policy.rerank.compatibleSpaces.map((space) => ({
    value: space.id,
    label: `${space.provider} · ${space.model}`,
  }))
  const embeddingProviderReady =
    policy.embedding.configurationReady &&
    policy.embedding.credentialReady &&
    policy.embedding.consentReady &&
    policy.embedding.runtimeReady &&
    (policy.embedding.vectorAvailable ||
      (policy.reindex.generationId === null && policy.reindex.canReindex))
  const rerankProviderReady =
    policy.rerank.configurationReady &&
    policy.rerank.credentialReady &&
    policy.rerank.consentReady &&
    policy.rerank.runtimeReady
  const rerankerOptional = fallback === "hybrid-without-rerank"
  const sourcePlacementUnsupported = policy.reindex.unsupportedVersionCount > 0
  const lexicalUnavailable = !policy.lexical.available
  const advancedSelectable =
    policy.lexical.available &&
    embeddingItems.length > 0 &&
    embeddingProviderReady &&
    !sourcePlacementUnsupported
  const requiredRerankerUnavailable =
    !rerankerOptional && (!rerankItems.length || !rerankProviderReady)

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend variant="label">{t("Search mode")}</FieldLegend>
        <ToggleGroup
          aria-label={t("Project search mode")}
          aria-describedby={modeDescriptionId}
          value={[mode]}
          onValueChange={(values) => {
            const next = values[0]
            if (next === "lexical-only" || next === "advanced-auto") {
              setMode(next)
            }
          }}
          variant="outline"
          spacing={0}
          className="grid w-full grid-cols-1 sm:grid-cols-2"
        >
          <ToggleGroupItem
            value="lexical-only"
            className="min-h-11 w-full justify-start"
          >
            <SearchCheckIcon />
            {t("Lexical only")}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="advanced-auto"
            disabled={!advancedSelectable}
            className="min-h-11 w-full justify-start"
          >
            <DatabaseZapIcon />
            {t("Automatic advanced RAG")}
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription id={modeDescriptionId}>
          {advanced
            ? rerankerOptional
              ? t(
                  "Advanced mode combines keyword and semantic retrieval. A compatible reranker is used when available, but is not required."
                )
              : t(
                  "Advanced mode combines keyword and semantic retrieval, then reranks compatible results."
                )
            : t(
                "Lexical mode searches indexed text locally and never calls an embedding or reranking provider."
              )}
        </FieldDescription>
      </FieldSet>

      {advanced ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            data-disabled={
              !embeddingItems.length || !embeddingProviderReady || undefined
            }
          >
            <FieldLabel htmlFor={embeddingControlId}>
              {t("Embedding space")}
            </FieldLabel>
            <Select
              items={embeddingItems}
              value={embeddingSpaceId}
              onValueChange={setEmbeddingSpaceId}
              disabled={!embeddingItems.length || !embeddingProviderReady}
            >
              <SelectTrigger
                id={embeddingControlId}
                aria-describedby={embeddingDescriptionId}
                className="w-full"
              >
                <SelectValue placeholder={t("No compatible embedding space")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {embeddingItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription id={embeddingDescriptionId}>
              {t(
                "Only the exact model, dimensions and preprocessing used by this runtime are selectable."
              )}
            </FieldDescription>
          </Field>
          <Field
            data-disabled={
              !rerankItems.length || !rerankProviderReady || undefined
            }
          >
            <FieldLabel htmlFor={rerankControlId}>
              {t("Reranking space")}
            </FieldLabel>
            <Select
              items={rerankItems}
              value={rerankSpaceId}
              onValueChange={setRerankSpaceId}
              disabled={!rerankItems.length || !rerankProviderReady}
            >
              <SelectTrigger
                id={rerankControlId}
                aria-describedby={rerankDescriptionId}
                className="w-full"
              >
                <SelectValue placeholder={t("No compatible reranking space")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {rerankItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription id={rerankDescriptionId}>
              {rerankerOptional
                ? t(
                    "Optional with this fallback. When selected, the reranker must match the provider configured for this server."
                  )
                : t(
                    "The reranker must match the provider configured for this server."
                  )}
            </FieldDescription>
          </Field>
        </div>
      ) : null}

      {advanced ? (
        <Field>
          <FieldLabel htmlFor={fallbackControlId}>
            {t("Fallback policy")}
          </FieldLabel>
          <Select
            items={[
              {
                value: "lexical-only",
                label: t("Continue with lexical search"),
              },
              {
                value: "hybrid-without-rerank",
                label: t("Hybrid without reranking"),
              },
              { value: "fail", label: t("Fail explicitly") },
            ]}
            value={fallback}
            onValueChange={(value) => {
              if (
                value === "fail" ||
                value === "lexical-only" ||
                value === "hybrid-without-rerank"
              ) {
                setFallback(value)
              }
            }}
          >
            <SelectTrigger
              id={fallbackControlId}
              aria-describedby={fallbackDescriptionId}
              className="w-full md:max-w-md"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="lexical-only">
                  {t("Continue with lexical search")}
                </SelectItem>
                <SelectItem value="hybrid-without-rerank">
                  {t("Hybrid without reranking")}
                </SelectItem>
                <SelectItem value="fail">{t("Fail explicitly")}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription id={fallbackDescriptionId}>
            {t(
              "Choose what remains available if an advanced stage becomes unavailable."
            )}
          </FieldDescription>
        </Field>
      ) : null}

      {!advancedSelectable ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>
            {sourcePlacementUnsupported || lexicalUnavailable
              ? t("Advanced RAG cannot be enabled for this project")
              : t("Advanced providers need setup")}
          </AlertTitle>
          <AlertDescription>
            {sourcePlacementUnsupported ? (
              t(
                "{count, plural, one {# eligible source is stored on a paired Node. Move it to Core or exclude it from project context before enabling advanced RAG.} other {# eligible sources are stored on a paired Node. Move them to Core or exclude them from project context before enabling advanced RAG.}}",
                { count: policy.reindex.unsupportedVersionCount }
              )
            ) : lexicalUnavailable ? (
              t("The lexical index is unavailable.")
            ) : (
              <>
                {t(
                  "Configure a compatible embedding provider, credentials and consent before enabling advanced RAG."
                )}{" "}
                <Link href="/settings/integrations#retrieval">
                  {t("Open retrieval settings")}
                </Link>
              </>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {advanced && requiredRerankerUnavailable ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>{t("Advanced providers need setup")}</AlertTitle>
          <AlertDescription>
            {t(
              "Configure a compatible reranking provider, credentials and consent, or choose hybrid search without reranking."
            )}{" "}
            <Link href="/settings/integrations#retrieval">
              {t("Open retrieval settings")}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-stretch sm:justify-end">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={
            !dirty ||
            !online ||
            saving ||
            (advanced &&
              (!advancedSelectable ||
                !embeddingSpaceId ||
                requiredRerankerUnavailable ||
                (!rerankerOptional && !rerankSpaceId)))
          }
          onClick={() =>
            onSave({
              projectId: policy.projectId,
              revision: policy.revision,
              retrievalMode: mode,
              fallbackPolicy: fallback,
              embeddingSpaceId: advanced ? embeddingSpaceId : null,
              rerankSpaceId: advanced ? rerankSpaceId : null,
            })
          }
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          {t("Save retrieval policy")}
        </Button>
      </div>
    </FieldGroup>
  )
}

export function ProjectRetrievalPolicyCard({
  projectId,
}: {
  projectId: string
}) {
  const t = useExtracted()
  const effectiveModeLabel = useEffectiveModeLabel()
  const degradedReasonLabel = useDegradedReasonLabel()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const [reindexPollingUntil, setReindexPollingUntil] = useState(0)
  const input = { projectId }

  useEffect(() => {
    if (reindexPollingUntil <= 0) return
    const remaining = Math.max(0, reindexPollingUntil - Date.now())
    const timeout = window.setTimeout(
      () => setReindexPollingUntil(0),
      remaining
    )
    return () => window.clearTimeout(timeout)
  }, [reindexPollingUntil])

  const policyQuery = useQuery({
    ...orpc.projects.retrievalPolicy.queryOptions({ input }),
    staleTime: COMMON_QUERY_STALE_TIME,
    refetchInterval: (query) => {
      const policy = query.state.data
      if (!online || Date.now() >= reindexPollingUntil) return false
      return policy?.configured.retrievalMode === "advanced-auto" &&
        policy.reindex.required
        ? 2_500
        : false
    },
  })

  async function invalidateProjectPolicy() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.projects.retrievalPolicy.queryKey({ input }),
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.projects.get.queryKey({ input }),
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.projects.list.queryKey({ input: { include: "all" } }),
        exact: true,
      }),
    ])
  }

  const savePolicy = useMutation({
    ...orpc.projects.setRetrievalPolicy.mutationOptions(),
    onSuccess: async () => {
      await invalidateProjectPolicy()
      toast.success(t("Project retrieval policy saved."))
    },
    onError: async (error) => {
      if (isConflictError(error)) {
        const [latest] = await Promise.all([
          policyQuery.refetch(),
          queryClient.invalidateQueries({
            queryKey: orpc.projects.get.queryKey({ input }),
            exact: true,
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.projects.list.queryKey({
              input: { include: "all" },
            }),
            exact: true,
          }),
        ])
        if (latest.isSuccess) {
          toast.info(t("This project changed elsewhere."), {
            description: t(
              "The latest retrieval policy has been loaded. Review it before saving again."
            ),
          })
        } else {
          toast.error(t("This project changed elsewhere."), {
            description: t(
              "The latest retrieval policy could not be loaded. Check your connection and try again."
            ),
          })
        }
        return
      }
      toast.error(error.message)
    },
  })
  const reindex = useMutation({
    ...orpc.retrieval.reindex.mutationOptions(),
    onSuccess: async () => {
      setReindexPollingUntil(Date.now() + 60_000)
      await Promise.all([
        invalidateProjectPolicy(),
        queryClient.invalidateQueries({
          queryKey: orpc.retrieval.readiness.queryKey(),
          exact: true,
        }),
      ])
      toast.success(t("Corpus reindexing queued."))
    },
    onError: (error) => {
      setReindexPollingUntil(0)
      toast.error(error.message)
    },
  })

  const policy = policyQuery.data
  const embeddingReady = Boolean(
    policy?.embedding.configurationReady &&
    policy.embedding.credentialReady &&
    policy.embedding.consentReady &&
    policy.embedding.runtimeReady &&
    (policy.embedding.vectorAvailable ||
      (policy.reindex.generationId === null && policy.reindex.canReindex))
  )
  const rerankReady = Boolean(
    policy?.rerank.configurationReady &&
    policy.rerank.credentialReady &&
    policy.rerank.consentReady &&
    policy.rerank.runtimeReady
  )
  const advancedPolicy = policy?.configured.retrievalMode === "advanced-auto"
  const embeddingOperational = Boolean(
    policy?.denseReady &&
    policy?.embedding.selectedSpaceCompatible &&
    !policy.reindex.required
  )
  const rerankOperational = Boolean(
    policy?.rerankReady && policy?.rerank.selectedSpaceCompatible
  )
  const embeddingStatus: StageStatus = !advancedPolicy
    ? embeddingReady
      ? "available"
      : "not-in-use"
    : embeddingOperational &&
        (policy?.effectiveMode === "hybrid" ||
          policy?.effectiveMode === "reranked")
      ? "active"
      : embeddingOperational
        ? "available"
        : "needs-attention"
  const rerankStatus: StageStatus = !advancedPolicy
    ? rerankReady
      ? "available"
      : "not-in-use"
    : policy?.effectiveMode === "hybrid" &&
        policy.configured.fallbackPolicy === "hybrid-without-rerank"
      ? "not-in-use"
      : rerankOperational && policy?.effectiveMode === "reranked"
        ? "active"
        : rerankOperational
          ? "available"
          : "needs-attention"
  const optionalRerankerNotInUse = Boolean(
    policy?.effectiveMode === "hybrid" &&
    policy.configured.fallbackPolicy === "hybrid-without-rerank"
  )
  const degradedReasons = policy
    ? [
        ...new Set(
          policy.reasons
            .filter(
              (reason) =>
                !optionalRerankerNotInUse ||
                !OPTIONAL_RERANK_REASONS.has(reason)
            )
            .map((reason) => degradedReasonLabel(reason))
        ),
      ]
    : []
  const reindexPolling = Boolean(
    online &&
    reindexPollingUntil > 0 &&
    advancedPolicy &&
    policy?.reindex.required
  )

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t("Retrieval policy")}</CardTitle>
        <CardDescription>
          {t(
            "Choose how this project searches its sources and inspect what is actually active."
          )}
        </CardDescription>
        <CardAction>
          {policy ? (
            <Badge
              variant={policy.status === "active" ? "secondary" : "outline"}
            >
              {policy.status === "active" ? t("Active") : t("Degraded")}
            </Badge>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {policyQuery.isPending ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-busy="true"
            aria-label={t("Loading project retrieval policy")}
          >
            <Skeleton className="h-16" />
            <Skeleton className="h-40" />
          </div>
        ) : policyQuery.isError && !policy ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>{t("Retrieval policy unavailable")}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {online
                  ? t("The active search mode cannot be confirmed right now.")
                  : t(
                      "You are offline and no confirmed retrieval policy is cached. Reconnect to load it."
                    )}
              </span>
              <Button
                className="w-full shrink-0 sm:w-auto"
                size="sm"
                variant="outline"
                disabled={!online || policyQuery.isFetching}
                onClick={() => void policyQuery.refetch()}
              >
                {policyQuery.isFetching ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {t("Try again")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : policy ? (
          <>
            {policyQuery.isError && online ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>
                  {t("Retrieval policy could not be refreshed")}
                </AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t(
                      "The last confirmed state remains visible. Refresh it before saving changes or rebuilding the index."
                    )}
                  </span>
                  <Button
                    className="w-full shrink-0 sm:w-auto"
                    size="sm"
                    variant="outline"
                    disabled={!online || policyQuery.isFetching}
                    onClick={() => void policyQuery.refetch()}
                  >
                    {policyQuery.isFetching ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    {t("Try again")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {!online ? (
              <Alert role="status">
                <WifiOffIcon />
                <AlertTitle>{t("You are offline")}</AlertTitle>
                <AlertDescription>
                  {t(
                    "The last confirmed policy remains visible. Reconnect to save changes or rebuild the index."
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <Alert>
              {policy.status === "active" ? (
                <CheckCircle2Icon />
              ) : (
                <CircleAlertIcon />
              )}
              <AlertTitle>
                {policy.status === "active"
                  ? policy.configured.retrievalMode === "lexical-only"
                    ? t("Private lexical search is active")
                    : t("Advanced RAG is active")
                  : policy.configured.retrievalMode === "advanced-auto"
                    ? t("Advanced RAG is degraded")
                    : t("Lexical search is unavailable")}
              </AlertTitle>
              <AlertDescription>
                {t("Effective mode: {mode}.", {
                  mode: effectiveModeLabel(policy.effectiveMode),
                })}
                <p className="mt-2">
                  {policy.configured.retrievalMode === "lexical-only"
                    ? t(
                        "Search requests from this project stay lexical-only and do not call embedding or reranking providers. A separate corpus-wide rebuild that you start explicitly may still send eligible Core-stored content to an authorized embedding provider."
                      )
                    : policy.embedding.sendsSourceContentToThirdParties
                      ? t(
                          "When this embedding stage runs, eligible source content is sent to the configured provider. Provider consent and credentials are required."
                        )
                      : t(
                          "The configured embedding stage does not send source content to a third party."
                        )}
                </p>
                {degradedReasons.length > 0 ? (
                  <ul className="mt-2 list-disc pl-4">
                    {degradedReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReadinessTile
                label={t("Embeddings and vector index")}
                provider={policy.embedding.provider}
                status={embeddingStatus}
                details={
                  policy.embedding.compatibleSpaces[0]
                    ? `${policy.embedding.compatibleSpaces[0].dimensions}d`
                    : t("No compatible space")
                }
              />
              <ReadinessTile
                label={t("Reranking")}
                provider={policy.rerank.provider}
                status={rerankStatus}
                details={
                  policy.rerank.compatibleSpaces[0]?.model ??
                  t("No compatible space")
                }
              />
            </div>

            {policy.configured.retrievalMode === "advanced-auto" &&
            policy.reindex.required ? (
              <Alert role="status">
                <DatabaseZapIcon />
                <AlertTitle>{t("Embedding index needs rebuilding")}</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t(
                      "{indexed} of {eligible} project versions are available in the compatible generation.",
                      {
                        indexed: String(policy.reindex.indexedVersionCount),
                        eligible: String(policy.reindex.eligibleVersionCount),
                      }
                    )}
                    {policy.reindex.unsupportedVersionCount > 0 ? (
                      <span className="mt-1 block">
                        {t(
                          "{count, plural, one {# eligible source is stored on a paired Node and cannot be processed by this Core pipeline.} other {# eligible sources are stored on a paired Node and cannot be processed by this Core pipeline.}}",
                          {
                            count: policy.reindex.unsupportedVersionCount,
                          }
                        )}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    className="w-full shrink-0 sm:w-auto"
                    size="sm"
                    variant="outline"
                    disabled={
                      !online ||
                      policyQuery.isError ||
                      !policy.reindex.canReindex ||
                      reindex.isPending ||
                      reindexPolling
                    }
                    onClick={() => reindex.mutate({ projectId })}
                  >
                    {reindex.isPending || reindexPolling ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    {reindex.isPending || reindexPolling
                      ? t("Reindexing…")
                      : t("Reindex")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <PolicyEditor
              key={`${policy.projectId}:${policy.revision}`}
              policy={policy}
              online={online && !policyQuery.isError}
              saving={savePolicy.isPending}
              onSave={(value) => savePolicy.mutate(value)}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
