"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArchiveIcon,
  FileJsonIcon,
  FolderTreeIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  ScissorsIcon,
  UploadIcon,
  WorkflowIcon,
} from "lucide-react"
import { useExtracted, useFormatter, useLocale } from "next-intl"
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
import { Badge } from "@/components/ui/badge"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"
import { parseConceptPackJson } from "./learning-model"

type Concept = {
  id: string
  setId: string
  parentId: string | null
  canonicalLabel: string
  localLabel: string | null
  description: string | null
  sortOrder: number
  revision: number
}

type Objective = {
  id: string
  conceptId: string
  statement: string
  expectedLevel: number
  yearId: string
  subjectId: string | null
  activeFrom: Date | null
  activeTo: Date | null
  revision: number
}

export type ConceptListData = {
  concepts: Array<{ concept: Concept; setTitle: string }>
  objectives: Objective[]
  prerequisites: Array<{
    objectiveId: string
    prerequisiteObjectiveId: string
  }>
}

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

function key() {
  return crypto.randomUUID()
}

function conceptLabel(concept: Concept) {
  return concept.localLabel || concept.canonicalLabel
}

function usePackErrorFormatter() {
  const t = useExtracted()
  return (error: string) => {
    if (error === "The file is not valid JSON.")
      return t("The file is not valid JSON.")
    if (error === "The pack must be a JSON object.")
      return t("The pack must be a JSON object.")
    if (error === 'namespace must be "curriculum" or "provider".')
      return t('namespace must be "curriculum" or "provider".')
    if (error === "locale must contain at least 2 characters.")
      return t("locale must contain at least 2 characters.")
    if (error === "concepts must contain at least one concept.")
      return t("concepts must contain at least one concept.")
    if (error === "concepts cannot contain more than 2000 entries.")
      return t("concepts cannot contain more than 2000 entries.")
    if (error === "objectives must be an array.")
      return t("objectives must be an array.")
    if (error === "objectives cannot contain more than 10000 entries.")
      return t("objectives cannot contain more than 10000 entries.")
    if (error === "The concept hierarchy contains a cycle.")
      return t("The concept hierarchy contains a cycle.")
    if (error === "The objective prerequisites contain a cycle.")
      return t("The objective prerequisites contain a cycle.")

    const field = error.match(/^(.+) must be a non-empty string\.$/)
    if (field)
      return t("{field} must be a non-empty string.", { field: field[1]! })
    const maximum = error.match(
      /^(.+) must contain at most (\d+) characters\.$/
    )
    if (maximum)
      return t("{field} must contain at most {maximum} characters.", {
        field: maximum[1]!,
        maximum: maximum[2]!,
      })
    const nullable = error.match(/^(.+) must be a string or null\.$/)
    if (nullable)
      return t("{field} must be a string or null.", {
        field: nullable[1]!,
      })
    const object = error.match(/^(.+) must be an object\.$/)
    if (object) return t("{field} must be an object.", { field: object[1]! })
    if (error.includes("sortOrder must be an integer"))
      return t("sortOrder must be an integer between -100000 and 100000.")
    if (error.includes("expectedLevel must be an integer"))
      return t("expectedLevel must be an integer from 1 to 5.")
    if (error.includes("prerequisiteStableKeys must be an array"))
      return t("prerequisiteStableKeys must be an array.")
    if (error.includes("cannot have more than 50 prerequisites"))
      return t("An objective cannot have more than 50 prerequisites.")
    if (error.startsWith("Duplicate concept stable key:"))
      return t("A concept stable key is duplicated: {key}.", {
        key: error.slice("Duplicate concept stable key: ".length, -1),
      })
    if (error.startsWith("Duplicate objective stable key:"))
      return t("An objective stable key is duplicated: {key}.", {
        key: error.slice("Duplicate objective stable key: ".length, -1),
      })
    if (error.startsWith("Unknown parent concept:"))
      return t("Unknown parent concept: {key}.", {
        key: error.slice("Unknown parent concept: ".length, -1),
      })
    if (error.startsWith("Unknown prerequisite objective:"))
      return t("Unknown prerequisite objective: {key}.", {
        key: error.slice("Unknown prerequisite objective: ".length, -1),
      })
    if (error.includes("references an unknown concept"))
      return t("An objective references an unknown concept.")
    if (error.includes("repeats a prerequisite"))
      return t("An objective repeats a prerequisite.")
    if (error.includes("cannot be its own parent"))
      return t("A concept cannot be its own parent.")
    if (error.includes("cannot depend on itself"))
      return t("An objective cannot depend on itself.")
    return t("The pack contains an unsupported validation error.")
  }
}

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
  const setItems = sets.length
    ? sets
    : setId
      ? [{ value: setId, label: t("New framework") }]
      : []

  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTreeIcon /> {t("Concepts and objectives")}
          </CardTitle>
          <CardDescription>
            {t(
              "Local labels, hierarchy and prerequisites remain yours; they never rename a school provider subject."
            )}
          </CardDescription>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={!yearId || !online}
              onClick={() => setImportOpen(true)}
            >
              <UploadIcon data-icon="inline-start" />
              {t("Import JSON pack")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!data?.concepts.length ? (
            <Empty className="border py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderTreeIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No concept framework yet")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "Create a local framework or preview a reviewed curriculum pack before importing it."
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setImportOpen(true)} disabled={!online}>
                  <FileJsonIcon data-icon="inline-start" />
                  {t("Preview an import")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="divide-y rounded-xl border">
              {data.concepts.map(({ concept, setTitle }) => {
                const parent = data.concepts.find(
                  (row) => row.concept.id === concept.parentId
                )?.concept
                const objectives = data.objectives.filter(
                  (objective) => objective.conceptId === concept.id
                )
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
                          {t("Canonical label: {label}", {
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
                            const prerequisiteIds = data.prerequisites
                              .filter(
                                (edge) => edge.objectiveId === objective.id
                              )
                              .map((edge) => edge.prerequisiteObjectiveId)
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
                                        count: String(prerequisiteIds.length),
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
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
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

function ConceptImportDialog({
  open,
  onOpenChange,
  yearId,
  subjectId,
  online,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  yearId: string | null
  subjectId: string | null
  online: boolean
  onChanged: () => Promise<void>
}) {
  const t = useExtracted()
  const packError = usePackErrorFormatter()
  const [raw, setRaw] = useState("")
  const parsed = useMemo(
    () => (raw.trim() ? parseConceptPackJson(raw) : null),
    [raw]
  )
  const importPack = useMutation({
    ...orpc.learning.concepts.importPack.mutationOptions(),
    onSuccess: async (result) => {
      await onChanged()
      onOpenChange(false)
      setRaw("")
      toast.success(
        result.reused
          ? t("This reviewed pack was already imported")
          : t("Concept pack imported")
      )
    },
    onError: (value) => toast.error(value.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("Import a reviewed concept pack")}</DialogTitle>
          <DialogDescription>
            {t(
              "The browser validates references and cycles first. The server validates ownership again and binds the pack to the active year and subject."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="concept-pack-file">{t("JSON file")}</Label>
            <Input
              id="concept-pack-file"
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (file) setRaw(await file.text())
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="concept-pack-json">{t("Pack JSON")}</Label>
            <Textarea
              id="concept-pack-json"
              className="min-h-56 font-mono text-xs"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              placeholder={
                '{"source":"…","sourceVersion":"…","title":"…","concepts":[…]}'
              }
            />
          </div>
          {parsed?.ok ? (
            <Alert>
              <FileJsonIcon />
              <AlertTitle>{t("Pack ready for import")}</AlertTitle>
              <AlertDescription>
                {t(
                  "{concepts} concepts · {objectives} objectives · {prerequisites} prerequisite links",
                  {
                    concepts: String(parsed.summary.concepts),
                    objectives: String(parsed.summary.objectives),
                    prerequisites: String(parsed.summary.prerequisites),
                  }
                )}
                <span className="mt-1 block">
                  {parsed.value.title} · {parsed.value.source}@
                  {parsed.value.sourceVersion}
                </span>
              </AlertDescription>
            </Alert>
          ) : parsed ? (
            <Alert variant="destructive">
              <AlertTitle>{t("Pack validation failed")}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc ps-4">
                  {parsed.errors.slice(0, 12).map((error) => (
                    <li key={error}>{packError(error)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!online || !parsed?.ok || !yearId || importPack.isPending}
            onClick={() => {
              if (!parsed?.ok || !yearId) return
              importPack.mutate({
                ...parsed.value,
                yearId,
                subjectId,
                idempotencyKey: `concept-pack:${key()}`,
              })
            }}
          >
            {importPack.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <UploadIcon data-icon="inline-start" />
            )}
            {t("Import reviewed pack")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConceptEditDialog({
  concept,
  concepts,
  online,
  onOpenChange,
  onChanged,
}: {
  concept: Concept | null
  concepts: Concept[]
  online: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  if (!concept) return null
  return (
    <ConceptEditDialogContent
      key={`${concept.id}:${concept.revision}`}
      concept={concept}
      concepts={concepts}
      online={online}
      onOpenChange={onOpenChange}
      onChanged={onChanged}
    />
  )
}

function ConceptEditDialogContent({
  concept,
  concepts,
  online,
  onOpenChange,
  onChanged,
}: {
  concept: Concept
  concepts: Concept[]
  online: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const t = useExtracted()
  const [localLabel, setLocalLabel] = useState(concept.localLabel ?? "")
  const [description, setDescription] = useState(concept.description ?? "")
  const [parentId, setParentId] = useState(concept.parentId ?? "root")
  const update = useMutation({
    ...orpc.learning.concepts.update.mutationOptions(),
    onSuccess: async () => {
      await onChanged()
      onOpenChange(false)
      toast.success(t("Concept updated"))
    },
    onError: (value) => toast.error(value.message),
  })
  const possibleParents = concepts.filter(
    (candidate) =>
      candidate.id !== concept.id && candidate.setId === concept.setId
  )
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("Edit concept")}</DialogTitle>
          <DialogDescription>
            {t("The canonical imported label remains {label}.", {
              label: concept.canonicalLabel,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="concept-local-label">{t("Local label")}</Label>
          <Input
            id="concept-local-label"
            value={localLabel}
            onChange={(event) => setLocalLabel(event.target.value)}
            placeholder={concept.canonicalLabel}
          />
          <Label htmlFor="concept-description">{t("Description")}</Label>
          <Textarea
            id="concept-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Label htmlFor="concept-parent">{t("Parent concept")}</Label>
          <Select
            value={parentId}
            onValueChange={(value) => value && setParentId(value)}
          >
            <SelectTrigger id="concept-parent" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="root">{t("No parent")}</SelectItem>
                {possibleParents.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {conceptLabel(candidate)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!online || update.isPending}
            onClick={() =>
              update.mutate({
                conceptId: concept.id,
                localLabel: localLabel.trim() || null,
                description: description.trim() || null,
                parentId: parentId === "root" ? null : parentId,
                expectedRevision: concept.revision,
              })
            }
          >
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t("Save changes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ObjectiveEditDialog({
  objective,
  objectives,
  online,
  prerequisiteIds,
  onOpenChange,
  onChanged,
}: {
  objective: Objective | null
  objectives: Objective[]
  online: boolean
  prerequisiteIds: string[]
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  if (!objective) return null
  return (
    <ObjectiveEditDialogContent
      key={`${objective.id}:${objective.revision}`}
      objective={objective}
      objectives={objectives}
      online={online}
      initialPrerequisiteIds={prerequisiteIds}
      onOpenChange={onOpenChange}
      onChanged={onChanged}
    />
  )
}

function ObjectiveEditDialogContent({
  objective,
  objectives,
  online,
  initialPrerequisiteIds,
  onOpenChange,
  onChanged,
}: {
  objective: Objective
  objectives: Objective[]
  online: boolean
  initialPrerequisiteIds: string[]
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const t = useExtracted()
  const [statement, setStatement] = useState(objective.statement)
  const [level, setLevel] = useState(String(objective.expectedLevel))
  const [selected, setSelected] = useState(new Set(initialPrerequisiteIds))
  const update = useMutation({
    ...orpc.learning.concepts.updateObjective.mutationOptions(),
    onSuccess: async () => {
      await onChanged()
      onOpenChange(false)
      toast.success(t("Objective updated"))
    },
    onError: (value) => toast.error(value.message),
  })
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("Edit objective")}</DialogTitle>
          <DialogDescription>
            {t(
              "Prerequisites are checked as an acyclic graph before this revision is saved."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="objective-statement">
            {t("Objective statement")}
          </Label>
          <Textarea
            id="objective-statement"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
          />
          <Label htmlFor="objective-level">{t("Expected level")}</Label>
          <Select
            value={level}
            onValueChange={(value) => value && setLevel(value)}
          >
            <SelectTrigger id="objective-level" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[1, 2, 3, 4, 5].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t("Level {level}", { level: String(value) })}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <fieldset className="grid max-h-52 gap-2 overflow-y-auto rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">
              {t("Prerequisite objectives")}
            </legend>
            {objectives
              .filter(
                (candidate) =>
                  candidate.id !== objective.id &&
                  candidate.yearId === objective.yearId &&
                  candidate.subjectId === objective.subjectId
              )
              .map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex items-start gap-2 text-sm"
                >
                  <Checkbox
                    checked={selected.has(candidate.id)}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (checked === true) next.add(candidate.id)
                        else next.delete(candidate.id)
                        return next
                      })
                    }
                  />
                  <span>{candidate.statement}</span>
                </label>
              ))}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!online || !statement.trim() || update.isPending}
            onClick={() =>
              update.mutate({
                objectiveId: objective.id,
                statement,
                expectedLevel: Number(level),
                prerequisiteIds: [...selected],
                expectedRevision: objective.revision,
              })
            }
          >
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t("Save objective")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConceptOperations({
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
            "Merge, split and archive always show their evidence and projection impact before applying."
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
                    className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
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
                        {operation.kind === "import"
                          ? t("Imported pack")
                          : operation.kind === "merge"
                            ? t("Concept merge")
                            : operation.kind === "split"
                              ? t("Concept split")
                              : t("Concept archive")}
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
                "The preview affects {objectives} objectives, {evidence} evidence items and {projections} projections. The operation is recorded in history.",
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
