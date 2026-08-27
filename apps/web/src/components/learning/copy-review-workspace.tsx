"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  Clock3Icon,
  CircleXIcon,
  FileSearchIcon,
  RefreshCcwIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldAlertIcon,
  SquareIcon,
  WandSparklesIcon,
  WifiOffIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { orpc } from "@/lib/orpc"
import { newKey, taxonomyValues, type RegionDraft } from "./copy-review-model"
import { CopyReviewPanel } from "./copy-review-panel"
import { useLearningTaxonomyLabels } from "./learning-labels"

export function CopyReviewWorkspace({ analysisId }: { analysisId: string }) {
  const t = useExtracted()
  const taxonomyLabels = useLearningTaxonomyLabels()
  const router = useRouter()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const copy = useQuery({
    ...orpc.learning.copies.get.queryOptions({ input: { analysisId } }),
    staleTime: 30_000,
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.analysis.status ?? "")
        ? 1_500
        : false,
  })
  const analysis = copy.data?.analysis
  const concepts = useQuery({
    ...orpc.learning.concepts.list.queryOptions({
      input: {
        yearId: analysis?.yearId ?? "",
        subjectId: analysis?.subjectId ?? null,
      },
    }),
    enabled: Boolean(analysis),
  })
  const job = useQuery({
    ...orpc.jobs.get.queryOptions({ input: { jobId: analysis?.jobId ?? "_" } }),
    enabled: Boolean(analysis?.jobId),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "")
        ? 1_000
        : false,
  })
  const [page, setPage] = useState(1)
  const [focusedRegionId, setFocusedRegionId] = useState<string | null>(null)
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false)
  const [draftOverrides, setDraftOverrides] = useState<
    Record<string, Record<string, RegionDraft>>
  >({})
  const defaultDrafts = useMemo(() => {
    const proposal = analysis?.proposalJson
    if (!proposal) return {}
    return Object.fromEntries(
      proposal.pages.flatMap((proposalPage) =>
        proposalPage.regions.map((region) => [
          region.id,
          {
            selected: region.suggestedObjectiveIds.length > 0,
            objectiveId: region.suggestedObjectiveIds[0] ?? null,
            observedOutcome: region.awarded ? String(region.awarded.value) : "",
            denominator: region.awarded ? String(region.awarded.outOf) : "",
            difficulty: "",
            taxonomy: region.suggestedError?.taxonomy ?? null,
            explanation: region.suggestedError?.explanation ?? "",
          } satisfies RegionDraft,
        ])
      )
    )
  }, [analysis?.proposalJson])
  const drafts = useMemo(
    () => ({ ...defaultDrafts, ...(draftOverrides[analysisId] ?? {}) }),
    [analysisId, defaultDrafts, draftOverrides]
  )

  const review = useMutation({
    ...orpc.learning.copies.review.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.learning.copies.get.queryKey({
            input: { analysisId },
          }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.learning.key() }),
      ])
      toast.success(t("Saved. The estimate has been updated."))
    },
    onError: (error) => toast.error(error.message),
  })
  const cancel = useMutation({
    ...orpc.learning.copies.cancel.mutationOptions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.learning.copies.get.queryKey({ input: { analysisId } }),
      })
      toast.success(
        result.cancellationRequested
          ? t(
              "Cancellation requested; the worker will stop at a safe boundary."
            )
          : t("Analysis cancelled")
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const retry = useMutation({
    ...orpc.learning.copies.retry.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.learning.copies.get.queryKey({ input: { analysisId } }),
      })
      toast.success(t("Analysis queued again"))
    },
    onError: (error) => toast.error(error.message),
  })
  const reanalyze = useMutation({
    ...orpc.learning.copies.reanalyze.mutationOptions(),
    onSuccess: async (next) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.learning.copies.key(),
      })
      setReanalyzeOpen(false)
      toast.success(t("New analysis revision queued"))
      router.push(`/learning/copies/${next.id}`)
    },
    onError: (error) => toast.error(error.message),
  })

  const proposalPage = analysis?.proposalJson?.pages.find(
    (proposal) => proposal.page === page
  )
  const objectiveItems = (concepts.data?.objectives ?? []).map((objective) => ({
    value: objective.id,
    label: objective.statement,
  }))
  /** Which part of the paper a region is. Four branches, one lookup. */
  const regionLabels: Record<string, string> = {
    "awarded-points": t("Score"),
    "teacher-comment": t("Feedback"),
    "teacher-mark": t("Feedback"),
    question: t("Question"),
  }
  const regionLabel = (kind: string) => regionLabels[kind] ?? t("Answer")

  const taxonomyItems = taxonomyValues.map((value) => ({
    value,
    label: taxonomyLabels[value],
  }))
  const selectedRegions = useMemo(
    () =>
      (analysis?.proposalJson?.pages ?? [])
        .flatMap((proposal) => proposal.regions)
        .flatMap((region) => {
          const draft = drafts[region.id]
          if (!draft?.selected || !draft.objectiveId) return []
          const outcome = draft.observedOutcome.trim()
          const denominator = draft.denominator.trim()
          return [
            {
              regionId: region.id,
              objectiveIds: [draft.objectiveId],
              observedOutcome: outcome ? Number(outcome) : null,
              denominator: denominator ? Number(denominator) : null,
              difficulty: draft.difficulty ? Number(draft.difficulty) : null,
              error:
                draft.taxonomy && draft.explanation.trim()
                  ? {
                      taxonomy: draft.taxonomy,
                      explanation: draft.explanation,
                      severity: region.suggestedError?.severity ?? 0.5,
                      confidence: region.suggestedError?.confidence ?? 0.5,
                    }
                  : null,
            },
          ]
        }),
    [analysis, drafts]
  )

  function mutateDraft(regionId: string, patch: Partial<RegionDraft>) {
    const base = drafts[regionId]
    if (!base) return
    setDraftOverrides((current) => ({
      ...current,
      [analysisId]: {
        ...(current[analysisId] ?? {}),
        [regionId]: { ...base, ...patch },
      },
    }))
  }

  if (copy.isLoading) {
    return (
      <div className="grid min-h-[70vh] gap-4 lg:grid-cols-2">
        <Skeleton />
        <Skeleton />
      </div>
    )
  }
  if (copy.isError || !copy.data || !analysis) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>{t("Paper not found")}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {copy.error?.message ?? t("This analysis is no longer available.")}
          <Button
            size="sm"
            variant="outline"
            disabled={!online || copy.isFetching}
            onClick={() => copy.refetch()}
          >
            {copy.isFetching ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCcwIcon data-icon="inline-start" />
            )}
            {t("Try again")}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const pending = ["queued", "running"].includes(analysis.status)
  const stale = copy.isStale && !copy.isFetching
  const progressValue =
    job.data?.status === "running"
      ? 55
      : job.data?.status === "succeeded"
        ? 100
        : 10
  const pages = analysis.proposalJson?.pages.length ?? analysis.pageCount ?? 1
  const statusLabels: Record<string, string> = {
    queued: t("Queued"),
    running: t("Running"),
    proposed: t("Ready to review"),
    confirmed: t("Confirmed"),
    dismissed: t("Dismissed"),
    cancelled: t("Cancelled"),
  }
  const statusLabel = statusLabels[analysis.status] ?? t("Failed")
  return (
    <>
      <PageMeta
        title={copy.data.gradeName}
        subtitle={t("Paper analysis · {subject}", {
          subject: copy.data.subjectName,
        })}
        backHref="/learning"
      />
      <PageActions>
        {pending ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!online || cancel.isPending}
            onClick={() =>
              cancel.mutate({
                analysisId,
                expectedRevision: analysis.revision,
              })
            }
          >
            {cancel.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SquareIcon data-icon="inline-start" />
            )}
            {t("Cancel analysis")}
          </Button>
        ) : ["failed", "cancelled"].includes(analysis.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!online || retry.isPending}
            onClick={() =>
              retry.mutate({
                analysisId,
                expectedRevision: analysis.revision,
                idempotencyKey: `retry:${newKey()}`,
              })
            }
          >
            {retry.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCcwIcon data-icon="inline-start" />
            )}
            {t("Retry analysis")}
          </Button>
        ) : analysis.status === "proposed" ? (
          <Button
            size="sm"
            disabled={
              !online || review.isPending || selectedRegions.length === 0
            }
            onClick={() =>
              review.mutate({
                analysisId,
                kind: "confirm",
                expectedRevision: analysis.revision,
                regions: selectedRegions,
                idempotencyKey: `review:${newKey()}`,
              })
            }
          >
            {review.isPending ? <Spinner /> : <SaveIcon />} {t("Confirm")}
          </Button>
        ) : null}
        {!pending ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!online || reanalyze.isPending}
            onClick={() => setReanalyzeOpen(true)}
          >
            <WandSparklesIcon data-icon="inline-start" />
            {t("Analyze with a new model revision")}
          </Button>
        ) : null}
      </PageActions>
      <main className="flex min-w-0 flex-col gap-4">
        <div className="hidden items-start justify-between gap-4 md:flex">
          <div>
            <h1 className="font-heading text-2xl font-semibold">
              {copy.data.gradeName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("{subject} · the original file remains the source of truth", {
                subject: copy.data.subjectName,
              })}
            </p>
          </div>
          <Badge variant="outline">{statusLabel}</Badge>
        </div>

        {!online ? (
          <Alert variant="destructive">
            <WifiOffIcon />
            <AlertTitle>{t("Paper review is offline")}</AlertTitle>
            <AlertDescription>
              {t(
                "The cached proposal and original file may remain readable, but review and job controls are disabled."
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {stale ? (
          <Alert>
            <Clock3Icon />
            <AlertTitle>{t("This analysis may be stale")}</AlertTitle>
            <AlertDescription>
              {t(
                "Reload before reviewing it. Revision checks prevent an older proposal from overwriting a newer decision."
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy.refetch()}
              >
                <RotateCcwIcon data-icon="inline-start" />
                {t("Reload analysis")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>{t("Provider disclosure")}</AlertTitle>
          <AlertDescription>
            {t(
              "This selected copy was processed by {provider} using {model}, revision {revision}. No unrelated grade or student identity was sent.",
              {
                provider: analysis.provider,
                model: analysis.model,
                revision: analysis.modelRevision,
              }
            )}
          </AlertDescription>
        </Alert>

        {pending ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSearchIcon /> {t("Analysis in progress")}
              </CardTitle>
              <CardDescription>
                {t("This keeps running. You can leave the page and come back.")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={progressValue}>
                <ProgressLabel>
                  {job.data?.status === "running"
                    ? t("OCR and segmentation")
                    : t("Waiting")}
                </ProgressLabel>
                <ProgressValue>{() => `${progressValue} %`}</ProgressValue>
              </Progress>
            </CardContent>
            {job.data?.status === "queued" ? (
              <CardFooter>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!online}
                  onClick={() =>
                    analysis.jobId &&
                    queryClient.fetchQuery(
                      orpc.jobs.get.queryOptions({
                        input: { jobId: analysis.jobId },
                      })
                    )
                  }
                >
                  <RotateCcwIcon /> {t("Refresh")}
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        ) : analysis.status === "failed" ? (
          <Alert variant="destructive">
            <CircleXIcon />
            <AlertTitle>{t("Analysis failed")}</AlertTitle>
            <AlertDescription>
              {analysis.safeError ??
                t("The analysis provider did not respond.")}{" "}
              {t("The file and grade are unchanged.")}
            </AlertDescription>
          </Alert>
        ) : analysis.status === "dismissed" ? (
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>{t("Suggestion dismissed")}</AlertTitle>
            <AlertDescription>
              {t("No evidence was created from this suggestion.")}
            </AlertDescription>
          </Alert>
        ) : analysis.status === "cancelled" ? (
          <Alert>
            <CircleXIcon />
            <AlertTitle>{t("Analysis cancelled")}</AlertTitle>
            <AlertDescription>
              {t(
                "The original file and any prior proposal remain unchanged. Retry this revision or request a different model revision."
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <CopyReviewPanel
          analysis={analysis}
          analysisId={analysisId}
          copy={copy}
          drafts={drafts}
          mutateDraft={mutateDraft}
          objectiveItems={objectiveItems}
          online={online}
          page={page}
          setPage={setPage}
          pages={pages}
          focusedRegionId={focusedRegionId}
          setFocusedRegionId={setFocusedRegionId}
          proposalPage={proposalPage}
          regionLabel={regionLabel}
          review={review}
          selectedRegions={selectedRegions}
          taxonomyItems={taxonomyItems}
        />

        {analysis.proposalJson?.unsupportedInferences.length ? (
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>{t("Limits of this suggestion")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {analysis.proposalJson.unsupportedInferences.map((warning) => (
                  <li key={warning}>
                    {warning === "lexical-error-suggestions"
                      ? t(
                          "Error categories are lexical suggestions that require your confirmation."
                        )
                      : warning === "grade-remains-unchanged"
                        ? t(
                            "This analysis never creates or changes a school grade."
                          )
                        : warning === "explicit-score-only"
                          ? t(
                              "Points are suggested only when an explicit scale is readable."
                            )
                          : t(
                              "The analyzer reported an additional unsupported inference."
                            )}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <Dialog open={reanalyzeOpen} onOpenChange={setReanalyzeOpen}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>
                {t("Analyze with a new model revision")}
              </DialogTitle>
              <DialogDescription>
                {t(
                  "A new analysis is created. Version {revision} and everything you reviewed stay as they are.",
                  { revision: analysis.modelRevision }
                )}
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <ShieldAlertIcon />
              <AlertTitle>{t("Server-selected model revision")}</AlertTitle>
              <AlertDescription>
                {t(
                  "Avermate records the exact configured provider and model revision. A browser cannot invent or relabel that provenance."
                )}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReanalyzeOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button
                disabled={!online || reanalyze.isPending}
                onClick={() =>
                  reanalyze.mutate({
                    analysisId,
                    idempotencyKey: `reanalyze:${newKey()}`,
                  })
                }
              >
                {reanalyze.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <WandSparklesIcon data-icon="inline-start" />
                )}
                {t("Create new analysis")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </>
  )
}
