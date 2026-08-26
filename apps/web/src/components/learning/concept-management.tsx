"use client"

import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  FileJsonIcon,
  FolderTreeIcon,
  PencilIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
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
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"
import {
  conceptLabel,
  type Concept,
  type ConceptListData,
  type Objective,
} from "./concept-model"
import {
  ConceptEditDialog,
  ConceptImportDialog,
  ObjectiveEditDialog,
} from "./concept-dialogs"
import { ConceptOperations } from "./concept-operations"

export function ConceptManagement({
  data,
  loading,
  error,
  yearId,
  subjectId,
  online,
  onChanged,
}: {
  data: ConceptListData | undefined
  loading: boolean
  error?: string
  yearId: string | null
  subjectId: string | null
  online: boolean
  onChanged: () => Promise<void>
}) {
  const t = useExtracted()
  const locale = useLocale()
  const [setTitle, setSetTitle] = useState("")
  const [conceptLabelDraft, setConceptLabelDraft] = useState("")
  const [setId, setSetId] = useState<string | null>(null)
  const [objectiveDraft, setObjectiveDraft] = useState("")
  const [conceptId, setConceptId] = useState<string | null>(null)
  const [editingConcept, setEditingConcept] = useState<Concept | null>(null)
  const [editingObjective, setEditingObjective] = useState<Objective | null>(
    null
  )
  const [importOpen, setImportOpen] = useState(false)

  const createSet = useMutation({
    ...orpc.learning.concepts.createSet.mutationOptions(),
    onSuccess: async (created) => {
      setSetId(created.id)
      setSetTitle("")
      await onChanged()
      toast.success(t("Framework created"))
    },
    onError: (value) => toast.error(value.message),
  })
  const createConcept = useMutation({
    ...orpc.learning.concepts.create.mutationOptions(),
    onSuccess: async () => {
      setConceptLabelDraft("")
      await onChanged()
      toast.success(t("Concept created"))
    },
    onError: (value) => toast.error(value.message),
  })
  const createObjective = useMutation({
    ...orpc.learning.concepts.createObjective.mutationOptions(),
    onSuccess: async () => {
      setObjectiveDraft("")
      await onChanged()
      toast.success(t("Objective created"))
    },
    onError: (value) => toast.error(value.message),
  })

  const sets = useMemo(() => {
    const unique = new Map<string, string>()
    for (const row of data?.concepts ?? [])
      unique.set(row.concept.setId, row.setTitle)
    return [...unique].map(([value, label]) => ({ value, label }))
  }, [data])

  /**
   * The list is indexed once, not rescanned per row.
   *
   * Each concept used to look up its parent with `concepts.find`, its
   * objectives with `objectives.filter` and every objective's prerequisites
   * with `prerequisites.filter` — inside the render loop. On the handful of
   * rows a hand-made framework has that is invisible; on an imported
   * curriculum, which is the case the import button exists for, it is a
   * quadratic render that gets slower the more useful the data becomes.
   */
  const conceptById = useMemo(
    () =>
      new Map(
        (data?.concepts ?? []).map((row) => [row.concept.id, row.concept])
      ),
    [data]
  )
  const objectivesByConcept = useMemo(() => {
    const grouped = new Map<string, Objective[]>()
    for (const objective of data?.objectives ?? []) {
      const list = grouped.get(objective.conceptId)
      if (list) list.push(objective)
      else grouped.set(objective.conceptId, [objective])
    }
    return grouped
  }, [data])
  const prerequisiteCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const edge of data?.prerequisites ?? []) {
      counts.set(edge.objectiveId, (counts.get(edge.objectiveId) ?? 0) + 1)
    }
    return counts
  }, [data])
  const setItems = sets.length
    ? sets
    : setId
      ? [{ value: setId, label: t("New framework") }]
      : []

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    )
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("Concepts could not be loaded")}</AlertTitle>
        <AlertDescription>
          {error}
          <Button
            size="sm"
            variant="outline"
            disabled={!online}
            onClick={onChanged}
          >
            {t("Try again")}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* No card around the list: it already draws its own border, and a
          bordered list inside a bordered card is two frames around one thing.
          A heading and the list use the width the screen actually has. */}
      <section className="flex min-w-0 flex-col gap-3">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <FolderTreeIcon className="size-4 text-muted-foreground" />
              {t("Concepts and objectives")}
            </h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {t(
                "Rename anything here without touching what your school calls it."
              )}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!yearId || !online}
            onClick={() => setImportOpen(true)}
          >
            <UploadIcon data-icon="inline-start" />
            {t("Import a framework")}
          </Button>
        </header>
        <div>
          {!data?.concepts.length ? (
            <Empty className="border py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderTreeIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No concept framework yet")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "Build your own, or start from a ready-made curriculum and adjust it."
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setImportOpen(true)} disabled={!online}>
                  <FileJsonIcon data-icon="inline-start" />
                  {t("Start from a framework")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="divide-y rounded-xl border">
              {data.concepts.map(({ concept, setTitle }) => {
                const parent = concept.parentId
                  ? conceptById.get(concept.parentId)
                  : undefined
                const objectives = objectivesByConcept.get(concept.id) ?? []
                return (
                  <li
                    key={concept.id}
                    className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{conceptLabel(concept)}</p>
                        <Badge variant="outline">{setTitle}</Badge>
                      </div>
                      {concept.localLabel ? (
                        <p className="text-xs text-muted-foreground">
                          {t("Called {label} by your school", {
                            label: concept.canonicalLabel,
                          })}
                        </p>
                      ) : null}
                      {parent ? (
                        <p className="text-xs text-muted-foreground">
                          {t("Parent: {label}", {
                            label: conceptLabel(parent),
                          })}
                        </p>
                      ) : null}
                      {concept.description ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {concept.description}
                        </p>
                      ) : null}
                      {objectives.length ? (
                        <ul className="mt-3 flex flex-col gap-2">
                          {objectives.map((objective) => {
                            const prerequisites =
                              prerequisiteCount.get(objective.id) ?? 0
                            return (
                              <li
                                key={objective.id}
                                className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm">
                                    {objective.statement}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t(
                                      "Expected level {level} · {count} prerequisites",
                                      {
                                        level: String(objective.expectedLevel),
                                        count: String(prerequisites),
                                      }
                                    )}
                                  </p>
                                </div>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={t("Edit objective {objective}", {
                                    objective: objective.statement,
                                  })}
                                  disabled={!online}
                                  onClick={() => setEditingObjective(objective)}
                                >
                                  <PencilIcon />
                                </Button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t("No objective in this concept")}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!online}
                      onClick={() => setEditingConcept(concept)}
                    >
                      <PencilIcon data-icon="inline-start" />
                      {t("Edit concept")}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{t("New framework")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="learning-set">{t("Name")}</Label>
                <Input
                  id="learning-set"
                  value={setTitle}
                  onChange={(event) => setSetTitle(event.target.value)}
                  placeholder={t("Personal curriculum")}
                />
              </div>
              <Button
                disabled={
                  !yearId || !online || !setTitle.trim() || createSet.isPending
                }
                onClick={() =>
                  yearId &&
                  createSet.mutate({
                    yearId,
                    subjectId,
                    title: setTitle,
                    locale,
                  })
                }
              >
                {createSet.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                {t("Create")}
              </Button>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{t("New concept")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Label htmlFor="new-concept-framework">{t("Framework")}</Label>
              <Select items={setItems} value={setId} onValueChange={setSetId}>
                <SelectTrigger id="new-concept-framework" className="w-full">
                  <SelectValue>
                    {(value) =>
                      setItems.find((item) => item.value === value)?.label ??
                      t("Choose a framework")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {setItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Label htmlFor="new-concept-label">{t("Concept label")}</Label>
              <Input
                id="new-concept-label"
                value={conceptLabelDraft}
                onChange={(event) => setConceptLabelDraft(event.target.value)}
                placeholder={t("E.g. Pythagorean theorem")}
              />
              <Button
                disabled={
                  !setId ||
                  !online ||
                  !conceptLabelDraft.trim() ||
                  createConcept.isPending
                }
                onClick={() =>
                  setId &&
                  createConcept.mutate({
                    setId,
                    parentId: null,
                    label: conceptLabelDraft,
                    description: null,
                  })
                }
              >
                {createConcept.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                {t("Add")}
              </Button>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{t("New objective")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Label htmlFor="new-objective-concept">{t("Concept")}</Label>
              <Select
                value={conceptId}
                onValueChange={setConceptId}
                items={(data?.concepts ?? []).map(({ concept }) => ({
                  value: concept.id,
                  label: conceptLabel(concept),
                }))}
              >
                <SelectTrigger id="new-objective-concept" className="w-full">
                  <SelectValue>
                    {(value) =>
                      data?.concepts.find(({ concept }) => concept.id === value)
                        ? conceptLabel(
                            data.concepts.find(
                              ({ concept }) => concept.id === value
                            )!.concept
                          )
                        : t("Choose a concept")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {data?.concepts.map(({ concept }) => (
                      <SelectItem key={concept.id} value={concept.id}>
                        {conceptLabel(concept)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Label htmlFor="new-objective-statement">
                {t("Objective statement")}
              </Label>
              <Textarea
                id="new-objective-statement"
                value={objectiveDraft}
                onChange={(event) => setObjectiveDraft(event.target.value)}
                placeholder={t(
                  "E.g. Choose and apply the correct relationship"
                )}
              />
              <Button
                disabled={
                  !conceptId ||
                  !online ||
                  !objectiveDraft.trim() ||
                  createObjective.isPending
                }
                onClick={() =>
                  conceptId &&
                  createObjective.mutate({
                    conceptId,
                    statement: objectiveDraft,
                    expectedLevel: 3,
                    prerequisiteIds: [],
                  })
                }
              >
                {createObjective.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                {t("Add objective")}
              </Button>
            </CardContent>
          </Card>
        </div>

        <ConceptOperations
          data={data}
          yearId={yearId}
          subjectId={subjectId}
          online={online}
          onChanged={onChanged}
        />
      </div>

      <ConceptImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        yearId={yearId}
        subjectId={subjectId}
        online={online}
        onChanged={onChanged}
      />
      <ConceptEditDialog
        concept={editingConcept}
        concepts={data?.concepts.map((row) => row.concept) ?? []}
        online={online}
        onOpenChange={(open) => !open && setEditingConcept(null)}
        onChanged={onChanged}
      />
      <ObjectiveEditDialog
        objective={editingObjective}
        objectives={data?.objectives ?? []}
        online={online}
        prerequisiteIds={
          editingObjective
            ? (data?.prerequisites ?? [])
                .filter((edge) => edge.objectiveId === editingObjective.id)
                .map((edge) => edge.prerequisiteObjectiveId)
            : []
        }
        onOpenChange={(open) => !open && setEditingObjective(null)}
        onChanged={onChanged}
      />
    </div>
  )
}
