"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { BookMarkedIcon, FolderIcon, StarIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { FormPage } from "@/components/forms/form-page"
import {
  ChoiceField,
  FormSection,
  NumberField,
  TextField,
} from "@/components/forms/controls"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

export interface SubjectFormValues {
  id?: string
  name: string
  shortName: string
  parentId: string | null
  coefficient: string
  kind: "subject" | "category"
  isMain: boolean
}

/**
 * Creating or editing a subject.
 *
 * The one idea worth explaining here is the difference between a subject and a
 * category, because it is what makes the app fit a prépa and a lycée at the
 * same time. The choice is presented with its consequence spelled out rather
 * than as a piece of jargon with a tooltip.
 */
export function SubjectForm({
  initial,
  mode,
}: {
  initial?: Partial<SubjectFormValues>
  mode: "create" | "edit"
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, yearId } = useYear()

  const [name, setName] = useState(initial?.name ?? "")
  const [shortName, setShortName] = useState(initial?.shortName ?? "")
  const [parentId, setParentId] = useState<string | null>(
    initial?.parentId ?? null
  )
  const [coefficient, setCoefficient] = useState(initial?.coefficient ?? "1")
  const [kind, setKind] = useState<"subject" | "category">(
    initial?.kind ?? "subject"
  )
  const [isMain, setIsMain] = useState(initial?.isMain ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const initialId = initial?.id

  // A subject cannot sit inside itself, and neither can it sit inside one of
  // its own descendants — that branch would detach from the year.
  const forbidden = useMemo(() => {
    if (!initialId) return new Set<string>()
    return new Set([
      initialId,
      ...graph.descendantsOf(initialId).map((subject) => subject.id),
    ])
  }, [graph, initialId])

  const parentOptions: PickerOption[] = useMemo(
    () => [
      { value: "", label: t("Top level") },
      ...graph
        .flatten()
        .filter((subject) => !forbidden.has(subject.id))
        .map((subject) => ({
          value: subject.id,
          label: subject.name,
          depth: graph.depthOf(subject.id) + 1,
          hint: subject.kind === "category" ? t("group") : undefined,
        })),
    ],
    [graph, forbidden, t]
  )

  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(
        mode === "create" ? t("Subject added") : t("Subject updated")
      )
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.back()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The subject could not be saved."))
    },
  }

  const create = useMutation({
    ...orpc.subjects.create.mutationOptions(),
    ...onSaved,
  })
  const update = useMutation({
    ...orpc.subjects.update.mutationOptions(),
    ...onSaved,
  })
  const saving = create.isPending || update.isPending

  const remove = useMutation({
    ...orpc.subjects.delete.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Subject deleted"))
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.push("/subjects")
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = t("Give this subject a name.")
    setErrors(next)
    if (Object.keys(next).length > 0) {
      haptic("warning")
      return
    }

    const payload = {
      name: name.trim(),
      shortName: shortName.trim() || null,
      parentId: parentId || null,
      coefficient: Number.parseFloat(coefficient.replace(",", ".")) || 1,
      kind,
      isMain,
    }

    if (mode === "create") {
      create.mutate({ yearId: yearId as string, ...payload })
    } else {
      update.mutate({ subjectId: initial?.id as string, ...payload })
    }
  }

  const childCount = initial?.id ? graph.childrenOf(initial.id).length : 0

  return (
    <FormPage
      title={mode === "create" ? t("New subject") : t("Edit subject")}
      backHref="/subjects"
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Add subject") : t("Save changes")}
      submitting={saving}
      destructive={
        mode === "edit" && initial?.id
          ? {
              label: t("Delete"),
              onClick: () =>
                remove.mutate({
                  subjectId: initial.id as string,
                  promoteChildren: false,
                }),
            }
          : undefined
      }
      footerNote={
        childCount > 0
          ? t("Deleting this also removes {count} subjects underneath it.", {
              count: String(childCount),
            })
          : undefined
      }
    >
      <FormSection>
        <TextField
          label={t("Name")}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("Mathematics, Physics, Written exam…")}
          error={errors.name}
          autoFocus={mode === "create"}
        />

        <TextField
          label={t("Short name")}
          description={t("Used on charts and narrow screens. Optional.")}
          value={shortName}
          onChange={(event) => setShortName(event.target.value)}
          maxLength={24}
          placeholder={t("Maths")}
        />
      </FormSection>

      <FormSection title={t("How it counts")}>
        <ChoiceField
          choices={[
            {
              value: "subject",
              label: t("Subject"),
              description: t(
                "Counted once, with its own weight, using its own average."
              ),
              icon: <BookMarkedIcon className="size-4" />,
            },
            {
              value: "category",
              label: t("Category"),
              description: t(
                "A heading. What it contains is weighed one by one at the level above."
              ),
              icon: <FolderIcon className="size-4" />,
            },
          ]}
          value={kind}
          onValueChange={setKind}
        />

        <PickerField
          label={t("Sits inside")}
          options={parentOptions}
          value={parentId ?? ""}
          onValueChange={(value) => setParentId(value || null)}
          placeholder={t("Top level")}
        />

        {kind === "subject" ? (
          <NumberField
            label={t("Weight")}
            description={t(
              "How much this subject counts against its siblings."
            )}
            value={coefficient}
            onValueChange={setCoefficient}
            min={0}
          />
        ) : (
          <FieldDescription>
            {t("A category carries no weight of its own — its contents do.")}
          </FieldDescription>
        )}

        <Field orientation="horizontal">
          <FieldLabel htmlFor="is-main" className="flex-1">
            <span className="flex items-center gap-1.5">
              <StarIcon className="size-4" />
              {t("Show on the dashboard")}
            </span>
            <span className="block text-xs font-normal text-muted-foreground">
              {t("Pinned to the sidebar and the home screen")}
            </span>
          </FieldLabel>
          <Switch
            id="is-main"
            checked={isMain}
            onCheckedChange={(checked) => {
              haptic("selection")
              setIsMain(checked)
            }}
          />
        </Field>
      </FormSection>
    </FormPage>
  )
}
