"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { orpc } from "@/lib/orpc"

type ErrorTaxonomy =
  | "missing-knowledge"
  | "misunderstood-concept"
  | "method-strategy"
  | "calculation"
  | "notation"
  | "reading-instruction"
  | "justification"
  | "transfer"
  | "time-management"
  | "unclassified"

type RegionDraft = {
  selected: boolean
  objectiveId: string | null
  observedOutcome: string
  denominator: string
  difficulty: string
  taxonomy: ErrorTaxonomy | null
  explanation: string
}

const taxonomyValues: ErrorTaxonomy[] = [
  "missing-knowledge",
  "misunderstood-concept",
  "method-strategy",
  "calculation",
  "notation",
  "reading-instruction",
  "justification",
  "transfer",
  "time-management",
  "unclassified",
]

function newKey() {
  return crypto.randomUUID()
}

export function normalizedBboxStyle(
  bbox: [number, number, number, number] | undefined
) {
  if (!bbox) return null
  const [left, top, right, bottom] = bbox
  if (
    bbox.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    right <= left ||
    bottom <= top
  ) {
    return null
  }
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(right - left) * 100}%`,
    height: `${(bottom - top) * 100}%`,
  }
}

export function CopyReviewWorkspace({ analysisId }: { analysisId: string }) {
  const t = useExtracted()
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
      toast.success(t("Decision saved; evidence has been recomputed."))
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
  const taxonomyItems = taxonomyValues.map((value) => ({
    value,
    label:
      value === "missing-knowledge"
        ? t("Missing knowledge")
        : value === "misunderstood-concept"
          ? t("Misunderstood concept")
          : value === "method-strategy"
            ? t("Method or strategy")
            : value === "calculation"
              ? t("Calculation")
              : value === "notation"
                ? t("Notation")
                : value === "reading-instruction"
                  ? t("Reading the instructions")
                  : value === "justification"
                    ? t("Justification")
                    : value === "transfer"
                      ? t("Transfer")
                      : value === "time-management"
                        ? t("Time management")
                        : t("Unclassified"),
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
  const statusLabel =
    analysis.status === "queued"
      ? t("Queued")
      : analysis.status === "running"
        ? t("Running")
        : analysis.status === "proposed"
          ? t("Ready to review")
          : analysis.status === "confirmed"
            ? t("Confirmed")
            : analysis.status === "dismissed"
              ? t("Dismissed")
              : analysis.status === "cancelled"
                ? t("Cancelled")
                : t("Failed")
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
                {t(
                  "The job is durable; you can leave this page and come back later."
                )}
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

        {analysis.proposalJson ? (
          <div className="grid min-h-[65vh] gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]">
            <Card className="overflow-hidden">
              <CardHeader className="border-b">
                <div>
                  <CardTitle>{t("Original")}</CardTitle>
                  <CardDescription>
                    {t("Page {page} of {pages}", {
                      page: String(page),
                      pages: String(pages),
                    })}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={t("Previous page")}
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={t("Next page")}
                    disabled={page >= pages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="relative min-h-[32rem] p-0">
                {copy.data.file.mimeType === "application/pdf" ? (
                  <object
                    aria-label={t("Original paper, page {page}", {
                      page: String(page),
                    })}
                    data={`${copy.data.file.url}#page=${page}&view=FitH`}
                    type="application/pdf"
                    className="absolute inset-0 size-full"
                  >
                    <p className="p-6 text-sm">
                      {t("Your browser cannot display this PDF.")}{" "}
                      <a
                        href={copy.data.file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {t("Open file")}
                      </a>
                      .
                    </p>
                  </object>
                ) : (
                  <Image
                    src={copy.data.file.url}
                    alt={t("Original paper, page {page}", {
                      page: String(page),
                    })}
                    fill
                    unoptimized
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-contain"
                  />
                )}
                <div
                  className="pointer-events-none absolute inset-0 z-10"
                  aria-label={t("Detected region map")}
                >
                  {proposalPage?.regions.map((region) => {
                    const style = normalizedBboxStyle(region.bbox)
                    if (!style) return null
                    const selected = drafts[region.id]?.selected ?? false
                    const focused = focusedRegionId === region.id
                    return (
                      <button
                        key={region.id}
                        type="button"
                        className={`pointer-events-auto absolute border-2 transition-colors ${
                          focused
                            ? "border-primary bg-primary/20"
                            : selected
                              ? "border-emerald-500 bg-emerald-500/10"
                              : "border-amber-500 bg-amber-500/10"
                        }`}
                        style={style}
                        aria-label={t("Open detected region {region}", {
                          region: region.id,
                        })}
                        onClick={() => {
                          setFocusedRegionId(region.id)
                          document
                            .getElementById(`copy-region-${region.id}`)
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "nearest",
                            })
                        }}
                      />
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <div>
                  <CardTitle>{t("Extraction to review")}</CardTitle>
                  <CardDescription>
                    {t(
                      "Choose what becomes evidence and correct its objective mapping."
                    )}
                  </CardDescription>
                </div>
                <Badge variant="outline">
                  {t("{count} regions", {
                    count: String(proposalPage?.regions.length ?? 0),
                  })}
                </Badge>
              </CardHeader>
              <CardContent className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
                {!proposalPage?.regions.length ? (
                  <p className="text-sm text-muted-foreground">
                    {t("No usable regions were found on this page.")}
                  </p>
                ) : (
                  proposalPage.regions.map((region) => {
                    const draft = drafts[region.id]
                    if (!draft) return null
                    return (
                      <section
                        key={region.id}
                        id={`copy-region-${region.id}`}
                        className={`rounded-xl border p-3 transition-shadow ${
                          focusedRegionId === region.id
                            ? "ring-2 ring-primary/40"
                            : ""
                        }`}
                        onClick={() => setFocusedRegionId(region.id)}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id={`region-${region.id}`}
                            checked={draft.selected}
                            onCheckedChange={(checked) =>
                              mutateDraft(region.id, {
                                selected: checked === true,
                              })
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <Label
                              htmlFor={`region-${region.id}`}
                              className="cursor-pointer"
                            >
                              {region.kind === "awarded-points"
                                ? t("Score region")
                                : region.kind === "teacher-comment" ||
                                    region.kind === "teacher-mark"
                                  ? t("Feedback region")
                                  : region.kind === "question"
                                    ? t("Question region")
                                    : t("Answer region")}
                            </Label>
                            <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                              {region.text}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("Extraction confidence: {confidence}%", {
                                confidence: String(
                                  Math.round(region.confidence * 100)
                                ),
                              })}
                            </p>
                            {region.bbox ? (
                              <Badge variant="outline" className="mt-2">
                                {normalizedBboxStyle(region.bbox)
                                  ? t("Located on the original")
                                  : t("Unscaled provider coordinates")}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        {draft.selected ? (
                          <div className="mt-3 grid gap-3 border-t pt-3">
                            <div className="grid gap-1.5">
                              <Label htmlFor={`objective-${region.id}`}>
                                {t("Objective")}
                              </Label>
                              <Select
                                items={objectiveItems}
                                value={draft.objectiveId}
                                onValueChange={(value) =>
                                  mutateDraft(region.id, { objectiveId: value })
                                }
                              >
                                <SelectTrigger
                                  id={`objective-${region.id}`}
                                  className="w-full"
                                >
                                  <SelectValue>
                                    {(value) =>
                                      objectiveItems.find(
                                        (item) => item.value === value
                                      )?.label ?? t("Choose an objective")
                                    }
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent alignItemWithTrigger={false}>
                                  <SelectGroup>
                                    {objectiveItems.map((item) => (
                                      <SelectItem
                                        key={item.value}
                                        value={item.value}
                                      >
                                        {item.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>
                            {region.awarded || draft.observedOutcome ? (
                              <div className="grid grid-cols-2 gap-2">
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`outcome-${region.id}`}>
                                    {t("Detected points")}
                                  </Label>
                                  <Input
                                    id={`outcome-${region.id}`}
                                    inputMode="decimal"
                                    value={draft.observedOutcome}
                                    onChange={(event) =>
                                      mutateDraft(region.id, {
                                        observedOutcome: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`denominator-${region.id}`}>
                                    {t("Maximum points")}
                                  </Label>
                                  <Input
                                    id={`denominator-${region.id}`}
                                    inputMode="decimal"
                                    value={draft.denominator}
                                    onChange={(event) =>
                                      mutateDraft(region.id, {
                                        denominator: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            ) : null}
                            <div className="grid gap-1.5">
                              <Label htmlFor={`difficulty-${region.id}`}>
                                {t("Explicit difficulty (optional, 0–1)")}
                              </Label>
                              <Input
                                id={`difficulty-${region.id}`}
                                inputMode="decimal"
                                value={draft.difficulty}
                                onChange={(event) =>
                                  mutateDraft(region.id, {
                                    difficulty: event.target.value,
                                  })
                                }
                                placeholder={t("Unknown")}
                              />
                            </div>
                            {draft.taxonomy ? (
                              <>
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`taxonomy-${region.id}`}>
                                    {t("Suggested error type")}
                                  </Label>
                                  <Select
                                    items={taxonomyItems}
                                    value={draft.taxonomy}
                                    onValueChange={(value) =>
                                      mutateDraft(region.id, {
                                        taxonomy: value as ErrorTaxonomy,
                                      })
                                    }
                                  >
                                    <SelectTrigger
                                      id={`taxonomy-${region.id}`}
                                      className="w-full"
                                    >
                                      <SelectValue>
                                        {(value) =>
                                          taxonomyItems.find(
                                            (item) => item.value === value
                                          )?.label
                                        }
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {taxonomyItems.map((item) => (
                                          <SelectItem
                                            key={item.value}
                                            value={item.value}
                                          >
                                            {item.label}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`explanation-${region.id}`}>
                                    {t("Why this classification?")}
                                  </Label>
                                  <Textarea
                                    id={`explanation-${region.id}`}
                                    value={draft.explanation}
                                    onChange={(event) =>
                                      mutateDraft(region.id, {
                                        explanation: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </section>
                    )
                  })
                )}
              </CardContent>
              {analysis.status === "proposed" ? (
                <CardFooter className="flex-wrap justify-between gap-2 border-t">
                  <Button
                    variant="ghost"
                    disabled={!online || review.isPending}
                    onClick={() =>
                      review.mutate({
                        analysisId,
                        kind: "dismiss",
                        expectedRevision: analysis.revision,
                        regions: [],
                        idempotencyKey: `dismiss:${newKey()}`,
                      })
                    }
                  >
                    <CircleXIcon /> {t("Dismiss suggestion")}
                  </Button>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={
                        !online ||
                        review.isPending ||
                        selectedRegions.length === 0
                      }
                      onClick={() =>
                        review.mutate({
                          analysisId,
                          kind: "correct",
                          expectedRevision: analysis.revision,
                          regions: selectedRegions,
                          idempotencyKey: `correct:${newKey()}`,
                        })
                      }
                    >
                      {t("Confirm my corrections")}
                    </Button>
                    <Button
                      disabled={
                        !online ||
                        review.isPending ||
                        selectedRegions.length === 0
                      }
                      onClick={() =>
                        review.mutate({
                          analysisId,
                          kind: "confirm",
                          expectedRevision: analysis.revision,
                          regions: selectedRegions,
                          idempotencyKey: `confirm:${newKey()}`,
                        })
                      }
                    >
                      {review.isPending ? <Spinner /> : <CheckCircle2Icon />}{" "}
                      {t("Confirm")}
                    </Button>
                  </div>
                </CardFooter>
              ) : analysis.status === "confirmed" ? (
                <CardFooter className="justify-between border-t">
                  <p className="text-sm text-muted-foreground">
                    {t("Evidence is saved without changing the grade.")}
                  </p>
                  <Button
                    variant="outline"
                    disabled={!online || review.isPending}
                    onClick={() =>
                      review.mutate({
                        analysisId,
                        kind: "unconfirm",
                        expectedRevision: analysis.revision,
                        regions: [],
                        idempotencyKey: `undo:${newKey()}`,
                      })
                    }
                  >
                    <RotateCcwIcon /> {t("Undo confirmation")}
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          </div>
        ) : null}

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
                  "A new immutable analysis is created. Revision {revision} and its review history are preserved.",
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
