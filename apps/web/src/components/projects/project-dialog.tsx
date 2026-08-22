"use client"

import { useState } from "react"
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

const colors = [
  { label: "Automatique", value: null },
  { label: "Accent principal", value: "primary" },
  { label: "Accent 1", value: "chart-1" },
  { label: "Accent 2", value: "chart-2" },
  { label: "Accent 3", value: "chart-3" },
]

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

  const subjectItems = [
    { label: "Toutes les matières", value: null },
    ...subjects.map((subject) => ({
      label: subject.name,
      value: subject.id,
    })),
  ]

  function submit() {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setTitleError("Donnez un nom au projet.")
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
            {project ? "Modifier le projet" : "Nouveau projet d’étude"}
          </DialogTitle>
          <DialogDescription>
            Regroupez des sources sans les déplacer. Les instructions guideront
            les futurs assistants sans leur donner de permission supplémentaire.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={Boolean(titleError)}>
            <FieldLabel htmlFor="project-title">Nom</FieldLabel>
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

          <div className="grid gap-4 sm:grid-cols-[6rem_1fr_1fr]">
            <Field>
              <FieldLabel htmlFor="project-emoji">Emoji</FieldLabel>
              <Input
                id="project-emoji"
                value={emoji}
                onChange={(event) => setEmoji(event.target.value)}
                maxLength={32}
                placeholder="📚"
              />
            </Field>
            <Field>
              <FieldLabel>Couleur</FieldLabel>
              <Select
                items={colors}
                value={color}
                onValueChange={(value) => setColor(value)}
              >
                <SelectTrigger className="w-full">
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
              <FieldLabel>Matière par défaut</FieldLabel>
              <Select
                items={subjectItems}
                value={subjectId}
                onValueChange={(value) => setSubjectId(value)}
              >
                <SelectTrigger className="w-full">
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
            <FieldLabel htmlFor="project-description">Description</FieldLabel>
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
              Instructions du projet
            </FieldLabel>
            <Textarea
              id="project-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={64 * 1_024}
              rows={7}
              placeholder="Ex. Privilégier le programme de terminale et signaler toute contradiction entre deux sources."
            />
            <FieldDescription>
              Le contenu importé reste non fiable : il ne peut jamais modifier
              ces instructions ni les permissions du compte.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {project ? "Enregistrer" : "Créer le projet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
