"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SelectField, TextField } from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import {
  DEFAULT_MATERIAL_TAG_COLOR,
  MATERIAL_TAG_COLORS,
  materialTagColor,
  materialTagDotClass,
  materialTagNameTaken,
  type MaterialTagColor,
} from "./materials-tags"
import type { MaterialTagView } from "./materials-types"

const NO_SUBJECT = "__materials_tag_no_subject__"

/**
 * A tag, created and edited as a screen.
 *
 * It was a dialog with three controls stacked inside it, which is the one shape
 * this app does not use for creating things: a grade, a goal, a task and a
 * period are all `FormFlow` — the whole form at once on a laptop, one decision
 * at a time on a phone, a review before saving and the save pinned where a
 * thumb reaches. A tag is not special enough to be the exception, and being the
 * exception is exactly what made it look wrong.
 */
export function MaterialTagForm({
  mode,
  tag,
  tags,
}: {
  mode: "create" | "edit"
  tag?: MaterialTagView | null
  /** The others, so a duplicate name can be refused before the server does. */
  tags: readonly MaterialTagView[]
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, subjects } = useYear()

  const [name, setName] = useState(tag?.name ?? "")
  const [color, setColor] = useState<MaterialTagColor>(
    materialTagColor(tag?.color)
  )
  const [subjectId, setSubjectId] = useState(tag?.subjectId ?? NO_SUBJECT)

  const subjectOptions = useMemo(
    () => [
      { value: NO_SUBJECT, label: t("No subject") },
      ...subjects.map((subject) => ({
        value: subject.id,
        label: subject.name,
      })),
    ],
    [subjects, t]
  )
  const subjectName =
    subjectOptions.find((option) => option.value === subjectId)?.label ?? ""

  const done = async () => {
    haptic("success")
    toast.success(mode === "edit" ? t("Tag saved.") : t("Tag created."))
    await queryClient.invalidateQueries({
      queryKey: orpc.materials.tags.key(),
    })
    router.push("/materials/tags")
  }
  const failed = (error: Error) => {
    haptic("error")
    toast.error(error.message || t("The tag could not be saved."))
  }

  const create = useMutation({
    ...orpc.materials.tags.create.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const update = useMutation({
    ...orpc.materials.tags.update.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const saving = create.isPending || update.isPending

  const trimmed = name.trim()
  const taken = materialTagNameTaken(trimmed, tags, tag?.id)

  const submit = () => {
    if (!trimmed || taken) return
    const values = {
      name: trimmed,
      color,
      subjectId: subjectId === NO_SUBJECT ? null : subjectId,
    }
    if (mode === "edit" && tag) {
      update.mutate({ tagId: tag.id, ...values })
      return
    }
    create.mutate({ yearId: yearId ?? "", ...values })
  }

  const steps: FlowStep[] = [
    {
      id: "name",
      title: t("What is this tag for?"),
      description: t(
        "A folder says where something sits and a source says where it came from. A tag says what it is about — across both."
      ),
      content: (
        <TextField
          label={t("Tag")}
          required
          value={name}
          maxLength={80}
          autoFocus
          placeholder={t("Revision, to re-read, corrected…")}
          error={taken ? t("A tag with that name already exists.") : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      ),
      summary: trimmed || undefined,
      validate: () => Boolean(trimmed) && !taken,
    },
    {
      id: "color",
      title: t("Which colour?"),
      description: t(
        "The point of a tag colour is to be recognised across a list without being read."
      ),
      content: <ColorField value={color} onChange={setColor} />,
      summary: color,
    },
    {
      id: "subject",
      title: t("Is it about one subject?"),
      description: t(
        "Optional. A tag bound to a subject is offered first for things filed under it."
      ),
      content: (
        <SelectField
          label={t("Subject")}
          value={subjectId}
          onValueChange={setSubjectId}
          options={subjectOptions}
        />
      ),
      summary: subjectName,
    },
  ]

  return (
    <FormFlow
      title={mode === "edit" ? t("Edit tag") : t("New tag")}
      backHref="/materials/tags"
      steps={steps}
      onSubmit={submit}
      submitLabel={mode === "edit" ? t("Save changes") : t("Add tag")}
      submitting={saving}
      disabled={!trimmed || taken}
    />
  )
}

/**
 * Six swatches, as a radio group.
 *
 * Not a `<select>` of colour names: a colour you pick by reading the word
 * "violet" is a colour you have to imagine.
 */
function ColorField({
  value,
  onChange,
}: {
  value: MaterialTagColor
  onChange: (color: MaterialTagColor) => void
}) {
  const t = useExtracted()
  return (
    <Field>
      <FieldLabel>{t("Colour")}</FieldLabel>
      <div role="radiogroup" aria-label={t("Colour")} className="flex gap-2">
        {MATERIAL_TAG_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value === color}
            aria-label={color}
            onClick={() => onChange(color)}
            className={cn(
              "grid size-10 place-items-center rounded-full transition-shadow",
              value === color &&
                "ring-2 ring-ring ring-offset-2 ring-offset-background"
            )}
          >
            <span
              aria-hidden
              className={cn("size-6 rounded-full", materialTagDotClass(color))}
            />
          </button>
        ))}
      </div>
      <FieldDescription>
        {t("Six, deliberately: far apart beats numerous.")}
      </FieldDescription>
    </Field>
  )
}

export { DEFAULT_MATERIAL_TAG_COLOR }
