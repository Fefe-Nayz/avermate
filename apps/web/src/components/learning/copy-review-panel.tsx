"use client"

import type { Dispatch, SetStateAction } from "react"

import Image from "next/image"
import {
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleXIcon,
  RotateCcwIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { rpc } from "@/lib/orpc"
import {
  newKey,
  normalizedBboxStyle,
  type ErrorTaxonomy,
  type RegionDraft,
} from "./copy-review-model"

type CopyDetail = Awaited<ReturnType<typeof rpc.learning.copies.get>>
type CopyAnalysis = CopyDetail["analysis"]
type ProposalPage = NonNullable<CopyAnalysis["proposalJson"]>["pages"][number]
type ReviewInput = Parameters<typeof rpc.learning.copies.review>[0]

/**
 * The two panes you review a paper in: the scan on the left, the regions the
 * model proposed on the right.
 *
 * Four hundred lines twenty-two levels deep inside the workspace before this,
 * which is why the workspace was three functions long and nothing in the middle
 * of it could be found. Moved out whole. The prop list is long because the
 * panes genuinely read that much of the screen's state — writing it down is the
 * point, since these used to be closures nobody could enumerate.
 */
export function CopyReviewPanel({
  analysis,
  analysisId,
  copy,
  drafts,
  mutateDraft,
  objectiveItems,
  online,
  page,
  setPage,
  pages,
  focusedRegionId,
  setFocusedRegionId,
  proposalPage,
  regionLabel,
  review,
  selectedRegions,
  taxonomyItems,
}: {
  analysis: CopyAnalysis
  analysisId: string
  /** Narrowed by the workspace before this renders, so `data` is present. */
  copy: { data: CopyDetail }
  drafts: Record<string, RegionDraft>
  mutateDraft: (regionId: string, patch: Partial<RegionDraft>) => void
  objectiveItems: { value: string; label: string }[]
  online: boolean
  page: number
  setPage: Dispatch<SetStateAction<number>>
  pages: number
  focusedRegionId: string | null
  setFocusedRegionId: (id: string | null) => void
  proposalPage: ProposalPage | undefined
  regionLabel: (kind: string) => string
  review: {
    mutate: (input: ReviewInput) => void
    isPending: boolean
  }
  selectedRegions: NonNullable<ReviewInput["regions"]>
  taxonomyItems: { value: ErrorTaxonomy; label: string }[]
}) {
  const t = useExtracted()

  return analysis.proposalJson ? (
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
                        {regionLabel(region.kind)}
                      </Label>
                      <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                        {region.text}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("{confidence}% sure it read this right", {
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
                                <SelectItem key={item.value} value={item.value}>
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
                  !online || review.isPending || selectedRegions.length === 0
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
                  !online || review.isPending || selectedRegions.length === 0
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
  ) : null
}
