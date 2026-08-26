"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { GeneratedArtifactKind } from "@avermate/agent-contracts"
import { AlertCircleIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { useMediaStudioCopy } from "./media-studio-copy"
import { selectedProjectSourceVersions } from "./media-studio-model"

type ProjectOption = {
  id: string
  title: string
  deletedAt: Date | null
}

export type ArtifactPlanValue = {
  projectId: string | null
  kind: GeneratedArtifactKind
  title: string
  sourceVersionIds: string[]
  parentArtifactRevisionIds: string[]
  settings: Record<string, unknown>
}

export type ArtifactPlanSeed = {
  projectId: string | null
  kind: GeneratedArtifactKind
  title: string
  parentArtifactRevisionIds: string[]
}

export function CreateArtifactDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  initialPlan,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: readonly ProjectOption[]
  defaultProjectId: string | null
  initialPlan?: ArtifactPlanSeed | null
  pending: boolean
  onSubmit: (value: ArtifactPlanValue) => void
}) {
  const t = useExtracted()
  const { artifactKindOptions } = useMediaStudioCopy()
  const [projectId, setProjectId] = useState<string | null>(
    initialPlan?.projectId ?? defaultProjectId
  )
  const [kind, setKind] = useState<GeneratedArtifactKind>(
    initialPlan?.kind ?? "markdown"
  )
  const [title, setTitle] = useState(initialPlan?.title ?? "")
  const [instructions, setInstructions] = useState("")
  const [templateId, setTemplateId] = useState("study-standard-v1")
  const [placementPreference, setPlacementPreference] = useState("automatic")
  const [voice, setVoice] = useState("")
  const [titleError, setTitleError] = useState<string | null>(null)

  const projectQuery = useQuery({
    ...orpc.projects.get.queryOptions({
      input: { projectId: projectId ?? "_" },
    }),
    enabled: open && Boolean(projectId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  const sourceSelection = useMemo(
    () => selectedProjectSourceVersions(projectQuery.data?.items ?? []),
    [projectQuery.data?.items]
  )
  const sourceVersionIds = sourceSelection.versionIds
  const pendingSources = sourceSelection.pendingCount
  const projectItems = [
    { label: t("No project"), value: null },
    ...projects
      .filter((project) => project.deletedAt === null)
      .map((project) => ({ label: project.title, value: project.id })),
  ]

  function submit() {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setTitleError(t("Give the artifact a name."))
      return
    }
    onSubmit({
      projectId,
      kind,
      title: cleanTitle,
      sourceVersionIds,
      parentArtifactRevisionIds: initialPlan?.parentArtifactRevisionIds ?? [],
      settings: {
        instructions: instructions.trim() || null,
        sourceSelection: projectId ? "project-current-versions" : "none",
        templateId,
        placementPreference,
        voice: voice.trim() || null,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {initialPlan
              ? t("Revise from an existing output")
              : t("New learning artifact")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Studio creates an inspectable workflow. Sources and every output stay versioned for review and recovery."
            )}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={Boolean(titleError)}>
            <FieldLabel htmlFor="artifact-title">{t("Name")}</FieldLabel>
            <Input
              id="artifact-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                if (event.target.value.trim()) setTitleError(null)
              }}
              maxLength={160}
              aria-invalid={Boolean(titleError)}
              autoFocus
              placeholder={t("Review — derivatives and primitives")}
            />
            <FieldError>{titleError}</FieldError>
          </Field>

          <Field>
            <FieldLabel>{t("Format")}</FieldLabel>
            <Select
              items={artifactKindOptions}
              value={kind}
              onValueChange={(value) => {
                if (value) setKind(value)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {artifactKindOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="flex flex-col">
                        <span>{item.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {t(
                "Execution placement is resolved when the workflow starts; a missing capability remains explicitly unavailable."
              )}
            </FieldDescription>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("Template")}</FieldLabel>
              <Select
                value={templateId}
                onValueChange={(value) => value && setTemplateId(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="study-standard-v1">
                      {t("Standard study")}
                    </SelectItem>
                    <SelectItem value="concise-review-v1">
                      {t("Concise review")}
                    </SelectItem>
                    <SelectItem value="teacher-led-v1">
                      {t("Teacher-led explanation")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {t("The template identifier is saved in the workflow input.")}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>{t("Placement preference")}</FieldLabel>
              <Select
                value={placementPreference}
                onValueChange={(value) =>
                  value && setPlacementPreference(value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="automatic">{t("Automatic")}</SelectItem>
                    <SelectItem value="node">{t("Prefer my Node")}</SelectItem>
                    <SelectItem value="managed">
                      {t("Prefer managed execution")}
                    </SelectItem>
                    <SelectItem value="core">{t("Prefer Core")}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {t(
                  "This is a preference. Avermate still decides what is allowed."
                )}
              </FieldDescription>
            </Field>
          </div>

          {kind === "audio" || kind === "video" ? (
            <Field>
              <FieldLabel htmlFor="artifact-voice">
                {t("Narration voice")}
              </FieldLabel>
              <Input
                id="artifact-voice"
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                maxLength={128}
                placeholder={t("Provider default")}
              />
              <FieldDescription>
                {t(
                  "Leave empty for the configured default. The selected provider validates the voice when execution starts."
                )}
              </FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel>{t("Project and sources")}</FieldLabel>
            <Select
              items={projectItems}
              value={projectId}
              onValueChange={(value) => setProjectId(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {projectItems.map((item) => (
                    <SelectItem key={item.value ?? "none"} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {projectId
                ? t(
                    "{count, plural, one {# indexed version will be frozen in the manifest.} other {# indexed versions will be frozen in the manifest.}}",
                    { count: sourceVersionIds.length }
                  )
                : t("Choose a project to attach sources.")}
            </FieldDescription>
          </Field>

          {projectId && pendingSources > 0 ? (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>{t("Indexing in progress")}</AlertTitle>
              <AlertDescription>
                {t(
                  "{count, plural, one {# source does not have a usable version yet.} other {# sources do not have usable versions yet.}} The workflow will use only ready versions.",
                  { count: pendingSources }
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="artifact-instructions">
              {t("Generation instructions")}
            </FieldLabel>
            <Textarea
              id="artifact-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={6}
              maxLength={16_000}
              placeholder={t(
                "For example: Build a concise study sheet, cite each property, and finish with five progressive exercises."
              )}
            />
            <FieldDescription>
              {t(
                "These instructions are workflow data, never additional permissions."
              )}
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t("Plan workflow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
