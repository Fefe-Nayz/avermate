"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArchiveIcon,
  HistoryIcon,
  ScissorsIcon,
  WorkflowIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orpc } from "@/lib/orpc"
import {
  conceptLabel,
  key,
  type Concept,
  type ConceptListData,
} from "./concept-model"

type PendingOperation =
  | {
      kind: "merge"
      previewDigest: string
      targetConceptId: string
      sourceConceptIds: string[]
      impact: OperationImpact
    }
  | {
      kind: "split"
      previewDigest: string
      sourceConceptId: string
      targets: Array<{ label: string; objectiveIds: string[] }>
      archiveSource: boolean
      impact: OperationImpact
    }
  | {
      kind: "archive"
      previewDigest: string
      conceptId: string
      cascade: boolean
      impact: OperationImpact
    }

type OperationImpact = {
  objectiveCount: number
  evidenceCount: number
  projectionCount: number
}

function useOperationLabel() {
  const t = useExtracted()
  const labels: Record<string, string> = {
    import: t("Imported"),
    merge: t("Merged concepts"),
    split: t("Split a concept"),
  }
  return (kind: string) => labels[kind] ?? t("Archived a concept")
}

export function ConceptOperations({
  data,
  yearId,
  subjectId,
  online,
  onChanged,
}: {
  data: ConceptListData | undefined
  yearId: string | null
  subjectId: string | null
  online: boolean
  onChanged: () => Promise<void>
}) {
  const t = useExtracted()
  const operationLabel = useOperationLabel()
  const format = useFormatter()
  const [targetId, setTargetId] = useState<string | null>(null)
  const [sourceIds, setSourceIds] = useState(new Set<string>())
  const [splitSourceId, setSplitSourceId] = useState<string | null>(null)
  const [splitLabels, setSplitLabels] = useState(["", ""])
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [archiveSource, setArchiveSource] = useState(false)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [cascade, setCascade] = useState(false)
  const [pending, setPending] = useState<PendingOperation | null>(null)

  const operations = useQuery({
    ...orpc.learning.concepts.operations.queryOptions({
      input: {
        yearId: yearId ?? "",
        ...(subjectId ? { subjectId } : {}),
        limit: 50,
      },
    }),
    enabled: Boolean(yearId),
  })
  const previewMerge = useMutation({
    ...orpc.learning.concepts.previewMerge.mutationOptions(),
    onSuccess: (preview) =>
      targetId &&
      setPending({
        kind: "merge",
        previewDigest: preview.previewDigest,
        targetConceptId: targetId,
        sourceConceptIds: [...sourceIds],
        impact: preview.impact,
      }),
    onError: (value) => toast.error(value.message),
  })
  const previewSplit = useMutation({
    ...orpc.learning.concepts.previewSplit.mutationOptions(),
    onSuccess: (preview) =>
      splitSourceId &&
      setPending({
        kind: "split",
        previewDigest: preview.previewDigest,
        sourceConceptId: splitSourceId,
        targets: splitLabels.map((label, index) => ({
          label,
          objectiveIds: Object.entries(allocations)
            .filter(([, target]) => target === String(index))
            .map(([objectiveId]) => objectiveId),
        })),
        archiveSource,
        impact: preview.impact,
      }),
    onError: (value) => toast.error(value.message),
  })
  const previewArchive = useMutation({
    ...orpc.learning.concepts.previewArchive.mutationOptions(),
    onSuccess: (preview) =>
      archiveId &&
      setPending({
        kind: "archive",
        previewDigest: preview.previewDigest,
        conceptId: archiveId,
        cascade,
        impact: preview.impact,
      }),
    onError: (value) => toast.error(value.message),
  })
  const merge = useMutation({
    ...orpc.learning.concepts.merge.mutationOptions(),
    onError: (value) => toast.error(value.message),
  })
  const split = useMutation({
    ...orpc.learning.concepts.split.mutationOptions(),
    onError: (value) => toast.error(value.message),
  })
  const archive = useMutation({
    ...orpc.learning.concepts.archive.mutationOptions(),
    onError: (value) => toast.error(value.message),
  })
  const applying = merge.isPending || split.isPending || archive.isPending
  const concepts = data?.concepts.map((row) => row.concept) ?? []
  const target = concepts.find((concept) => concept.id === targetId)
  const mergeSources = target
    ? concepts.filter(
        (concept) => concept.setId === target.setId && concept.id !== target.id
      )
    : []
  const splitObjectives = (data?.objectives ?? []).filter(
    (objective) => objective.conceptId === splitSourceId
  )

  async function applyPending() {
    if (!pending) return
    if (pending.kind === "merge")
      await merge.mutateAsync({
        targetConceptId: pending.targetConceptId,
        sourceConceptIds: pending.sourceConceptIds,
        previewDigest: pending.previewDigest,
        idempotencyKey: `merge:${key()}`,
      })
    else if (pending.kind === "split")
      await split.mutateAsync({
        sourceConceptId: pending.sourceConceptId,
        targets: pending.targets,
        archiveSource: pending.archiveSource,
        previewDigest: pending.previewDigest,
        idempotencyKey: `split:${key()}`,
      })
    else
      await archive.mutateAsync({
        conceptId: pending.conceptId,
        cascade: pending.cascade,
        previewDigest: pending.previewDigest,
        idempotencyKey: `archive:${key()}`,
      })
    setPending(null)
    await Promise.all([onChanged(), operations.refetch()])
    toast.success(t("Concept operation applied"))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WorkflowIcon /> {t("Versioned concept operations")}
        </CardTitle>
        <CardDescription>
          {t(
            "Merging, splitting and archiving always show what they will change before you confirm."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="merge">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="merge">{t("Merge")}</TabsTrigger>
            <TabsTrigger value="split">{t("Split")}</TabsTrigger>
            <TabsTrigger value="archive">{t("Archive")}</TabsTrigger>
            <TabsTrigger value="history">{t("History")}</TabsTrigger>
          </TabsList>
          <TabsContent value="merge" className="mt-4 grid gap-3">
            <Label htmlFor="merge-target">{t("Concept to keep")}</Label>
            <ConceptSelect
              id="merge-target"
              value={targetId}
              concepts={concepts}
              placeholder={t("Choose a target")}
              onChange={(value) => {
                setTargetId(value)
                setSourceIds(new Set())
              }}
            />
            <fieldset className="grid gap-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">
                {t("Concepts to merge into the target")}
              </legend>
              {mergeSources.length ? (
                mergeSources.map((concept) => (
                  <label
                    key={concept.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={sourceIds.has(concept.id)}
                      onCheckedChange={(checked) =>
                        setSourceIds((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(concept.id)
                          else next.delete(concept.id)
                          return next
                        })
                      }
                    />
                    {conceptLabel(concept)}
                  </label>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Choose a target with another concept in the same framework."
                  )}
                </p>
              )}
            </fieldset>
            <Button
              variant="outline"
              disabled={
                !online ||
                !targetId ||
                sourceIds.size === 0 ||
                previewMerge.isPending
              }
              onClick={() =>
                targetId &&
                previewMerge.mutate({
                  targetConceptId: targetId,
                  sourceConceptIds: [...sourceIds],
                })
              }
            >
              {previewMerge.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t("Preview merge")}
            </Button>
          </TabsContent>
          <TabsContent value="split" className="mt-4 grid gap-3">
            <Label htmlFor="split-source">{t("Concept to split")}</Label>
            <ConceptSelect
              id="split-source"
              value={splitSourceId}
              concepts={concepts}
              placeholder={t("Choose a source")}
              onChange={(value) => {
                setSplitSourceId(value)
                setAllocations({})
              }}
            />
            {splitLabels.map((label, index) => (
              <div key={index} className="grid gap-1.5">
                <Label htmlFor={`split-label-${index}`}>
                  {t("New concept {number}", { number: String(index + 1) })}
                </Label>
                <Input
                  id={`split-label-${index}`}
                  value={label}
                  onChange={(event) =>
                    setSplitLabels((current) =>
                      current.map((value, currentIndex) =>
                        currentIndex === index ? event.target.value : value
                      )
                    )
                  }
                />
              </div>
            ))}
            {splitObjectives.length ? (
              <div className="grid gap-2 rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {t("Allocate objectives")}
                </p>
                {splitObjectives.map((objective) => (
                  <div
                    key={objective.id}
                    className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
                  >
                    <span className="text-sm">{objective.statement}</span>
                    <Select
                      value={allocations[objective.id] ?? "source"}
                      onValueChange={(value) =>
                        value &&
                        setAllocations((current) => ({
                          ...current,
                          [objective.id]: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label={t("Target for {objective}", {
                          objective: objective.statement,
                        })}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="source">
                            {t("Keep on source")}
                          </SelectItem>
                          <SelectItem value="0">
                            {t("New concept 1")}
                          </SelectItem>
                          <SelectItem value="1">
                            {t("New concept 2")}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={archiveSource}
                onCheckedChange={(checked) =>
                  setArchiveSource(checked === true)
                }
              />
              <span>
                {t("Archive the source after every objective is allocated")}
              </span>
            </label>
            <Button
              variant="outline"
              disabled={
                !online ||
                !splitSourceId ||
                splitLabels.some((label) => !label.trim()) ||
                (archiveSource &&
                  splitObjectives.some(
                    (objective) =>
                      !allocations[objective.id] ||
                      allocations[objective.id] === "source"
                  )) ||
                previewSplit.isPending
              }
              onClick={() => {
                if (!splitSourceId) return
                const targets = splitLabels.map((label, index) => ({
                  label,
                  objectiveIds: Object.entries(allocations)
                    .filter(([, target]) => target === String(index))
                    .map(([objectiveId]) => objectiveId),
                }))
                previewSplit.mutate({
                  sourceConceptId: splitSourceId,
                  targets,
                  archiveSource,
                })
              }}
            >
              {previewSplit.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              <ScissorsIcon data-icon="inline-start" />
              {t("Preview split")}
            </Button>
          </TabsContent>
          <TabsContent value="archive" className="mt-4 grid gap-3">
            <Label htmlFor="archive-concept">{t("Concept to archive")}</Label>
            <ConceptSelect
              id="archive-concept"
              value={archiveId}
              concepts={concepts}
              placeholder={t("Choose a concept")}
              onChange={setArchiveId}
            />
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={cascade}
                onCheckedChange={(checked) => setCascade(checked === true)}
              />
              <span>{t("Include active child concepts")}</span>
            </label>
            <Button
              variant="outline"
              disabled={!online || !archiveId || previewArchive.isPending}
              onClick={() =>
                archiveId &&
                previewArchive.mutate({ conceptId: archiveId, cascade })
              }
            >
              {previewArchive.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              <ArchiveIcon data-icon="inline-start" />
              {t("Preview archive")}
            </Button>
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            {operations.isLoading ? (
              <Skeleton className="h-40" />
            ) : operations.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{t("Operation history unavailable")}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  {operations.error.message}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!online || operations.isFetching}
                    onClick={() => operations.refetch()}
                  >
                    {t("Try again")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : !operations.data?.length ? (
              <Empty className="border py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HistoryIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t("No structural operation yet")}</EmptyTitle>
                  <EmptyDescription>
                    {t(
                      "Reviewed imports, merges, splits and archives appear here."
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ol className="divide-y rounded-lg border">
                {operations.data.map((operation) => (
                  <li
                    key={operation.id}
                    className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {operationLabel(operation.kind)}
                      </p>
                      <p
                        className="font-mono text-xs text-muted-foreground"
                        title={operation.previewDigest}
                      >
                        {operation.previewDigest.slice(0, 16)}…
                      </p>
                    </div>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={operation.createdAt.toISOString()}
                    >
                      {format.dateTime(operation.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "merge"
                ? t("Apply this merge?")
                : pending?.kind === "split"
                  ? t("Apply this split?")
                  : t("Archive this concept selection?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "This touches {objectives} objectives, {evidence} pieces of evidence and {projections} estimates, and it is recorded in the history.",
                {
                  objectives: String(pending?.impact.objectiveCount ?? 0),
                  evidence: String(pending?.impact.evidenceCount ?? 0),
                  projections: String(pending?.impact.projectionCount ?? 0),
                }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!online || applying}
              onClick={applyPending}
            >
              {applying ? <Spinner data-icon="inline-start" /> : null}
              {t("Apply reviewed operation")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function ConceptSelect({
  id,
  value,
  concepts,
  placeholder,
  onChange,
}: {
  id: string
  value: string | null
  concepts: Concept[]
  placeholder: string
  onChange: (value: string | null) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      items={concepts.map((concept) => ({
        value: concept.id,
        label: conceptLabel(concept),
      }))}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(selected) =>
            concepts.find((concept) => concept.id === selected)
              ? conceptLabel(
                  concepts.find((concept) => concept.id === selected)!
                )
              : placeholder
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {concepts.map((concept) => (
            <SelectItem key={concept.id} value={concept.id}>
              {conceptLabel(concept)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
