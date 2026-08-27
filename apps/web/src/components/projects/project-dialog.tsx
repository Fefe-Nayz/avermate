"use client"

import { useState } from "react"
import { useExtracted } from "next-intl"
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
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export interface EditableProject {
  id: string
  revision: number
  title: string
  description: string
  emoji: string | null
  color: string | null
  yearId: string | null
  subjectId: string | null
  instructionsMarkdown: string | null
}

export interface ProjectFormValue {
  title: string
  description: string
  emoji: string | null
  color: string | null
  yearId: string | null
  subjectId: string | null
  instructionsMarkdown: string | null
  contextPolicyVersion: number
  contextPolicyJson: Record<string, unknown>
}

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  yearId,
  subjects,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: EditableProject | null
  yearId: string
  subjects: readonly { id: string; name: string }[]
  pending: boolean
  onSubmit: (value: ProjectFormValue) => void
}) {
  const t = useExtracted()
  const [title, setTitle] = useState(project?.title ?? "")
  const [description, setDescription] = useState(project?.description ?? "")
  const [emoji, setEmoji] = useState(project?.emoji ?? "")
  const [color, setColor] = useState<string | null>(project?.color ?? null)
  const [subjectId, setSubjectId] = useState<string | null>(
    project?.subjectId ?? null
  )
  const [instructions, setInstructions] = useState(
    project?.instructionsMarkdown ?? ""
  )
  const [titleError, setTitleError] = useState<string | null>(null)

  const colors = [
    { label: t("Automatic"), value: null },
    { label: t("Primary accent"), value: "primary" },
    { label: t("Accent 1"), value: "chart-1" },
    { label: t("Accent 2"), value: "chart-2" },
    { label: t("Accent 3"), value: "chart-3" },
  ]
  const subjectItems = [
    { label: t("All subjects"), value: null },
    ...subjects.map((subject) => ({
      label: subject.name,
      value: subject.id,
    })),
  ]

  function submit() {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setTitleError(t("Give the project a name."))
      return
    }
    onSubmit({
      title: cleanTitle,
      description: description.trim(),
      emoji: emoji.trim() || null,
      color,
      yearId: project?.yearId ?? yearId,
      subjectId,
      instructionsMarkdown: instructions.trim() || null,
      contextPolicyVersion: 1,
      contextPolicyJson: {
        sourceSelection: "project-items",
        extractedInstructionsTrusted: false,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {project ? t("Edit project") : t("New study project")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Group sources without moving them. Instructions guide future assistants without granting extra permissions."
            )}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={Boolean(titleError)}>
            <FieldLabel htmlFor="project-title">{t("Name")}</FieldLabel>
            <Input
              id="project-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                if (event.target.value.trim()) setTitleError(null)
              }}
              aria-invalid={Boolean(titleError)}
              maxLength={160}
              autoFocus
            />
            <FieldError>{titleError}</FieldError>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[6rem_1fr_1fr]">
            <Field>
              <FieldLabel htmlFor="project-emoji">{t("Emoji")}</FieldLabel>
              <Input
                id="project-emoji"
                value={emoji}
                onChange={(event) => setEmoji(event.target.value)}
                maxLength={32}
                placeholder="📚"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-color">{t("Color")}</FieldLabel>
              <Select
                items={colors}
                value={color}
                onValueChange={(value) => setColor(value)}
              >
                <SelectTrigger id="project-color" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {colors.map((item) => (
                      <SelectItem key={item.value ?? "auto"} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-subject">
                {t("Default subject")}
              </FieldLabel>
              <Select
                items={subjectItems}
                value={subjectId}
                onValueChange={(value) => setSubjectId(value)}
              >
                <SelectTrigger id="project-subject" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {subjectItems.map((item) => (
                      <SelectItem key={item.value ?? "all"} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="project-description">
              {t("Description")}
            </FieldLabel>
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={8_000}
              rows={3}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="project-instructions">
              {t("Project instructions")}
            </FieldLabel>
            <Textarea
              id="project-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={64 * 1_024}
              rows={7}
              placeholder={t(
                "For example: prioritize the final-year curriculum and flag contradictions between sources."
              )}
            />
            <FieldDescription>
              {t(
                "Imported content remains untrusted: it can never change these instructions or account permissions."
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
            {project ? t("Save") : t("Create project")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
