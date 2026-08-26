"use client"

import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { FileJsonIcon, UploadIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"
import { parseConceptPackJson } from "./learning-model"
import {
  conceptLabel,
  key,
  type Concept,
  type Objective,
} from "./concept-model"

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

export function ConceptImportDialog({
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

export function ConceptEditDialog({
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
            {t("Your school still calls it {label}.", {
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

export function ObjectiveEditDialog({
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

/** What was done to the framework. A table, not a four-branch staircase. */
