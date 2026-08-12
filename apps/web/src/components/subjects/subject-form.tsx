"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookMarkedIcon, FolderIcon, StarIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import {
  ChoiceField,
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
  returnTo,
}: {
  initial?: Partial<SubjectFormValues>
  mode: "create" | "edit"
  returnTo?: string
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
  const [deleteOpen, setDeleteOpen] = useState(false)
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
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.queryKey({
            input: { yearId: yearId ?? "" },
          }),
        }),
        invalidateAnnouncementAudience(queryClient),
      ])
      if (returnTo) router.push(returnTo)
      else router.back()
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
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.queryKey({
            input: { yearId: yearId ?? "" },
          }),
        }),
        invalidateAnnouncementAudience(queryClient),
      ])
      router.push(returnTo ?? "/subjects")
    },
  })

  const impact = useQuery({
    ...orpc.subjects.impact.queryOptions({
      input: { subjectId: initialId ?? "" },
    }),
    enabled: deleteOpen && Boolean(initialId),
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

  const childCount = initial?.id ? graph.descendantsOf(initial.id).length : 0
  const parentName = parentId ? graph.byId(parentId)?.name : null

  const steps: FlowStep[] = [
    {
      id: "name",
      title: t("What is it called?"),
      description: t("A short name is used wherever space is tight."),
      summary: name.trim()
        ? shortName.trim()
          ? `${name.trim()} (${shortName.trim()})`
          : name.trim()
        : null,
      validate: () => {
        const problem: Record<string, string> = name.trim()
          ? {}
          : { name: t("Give this subject a name.") }
        setErrors(problem)
        return Object.keys(problem).length === 0
      },
      content: (
        <div className="flex flex-col gap-4">
          <TextField
            label={t("Name")}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Mathematics, Physics, Written exam…")}
            error={errors.name}
          />
          <TextField
            label={t("Short name")}
            description={t("Used on charts and narrow screens. Optional.")}
            value={shortName}
            onChange={(event) => setShortName(event.target.value)}
            maxLength={24}
            placeholder={t("Maths")}
          />
        </div>
      ),
    },
    {
      id: "place",
      title: t("Where does it sit?"),
      description: t("Leave it at the top level if it belongs to nothing else."),
      summary: parentName ?? t("Top level"),
      content: (
        <PickerField
          layout="page"
          label={t("Sits inside")}
          options={parentOptions}
          value={parentId ?? ""}
          onValueChange={(value) => setParentId(value || null)}
          placeholder={t("Top level")}
        />
      ),
    },
    {
      // Kind and weight are one decision: choosing "category" is choosing to
      // have no weight, so splitting them made the second screen answer a
      // question the first had already settled.
      id: "counts",
      title: t("How does it count?"),
      description: t("This is what decides how its average is worked out."),
      summary: [
        kind === "subject"
          ? t("Weight {weight}", { weight: coefficient || "1" })
          : t("Category"),
        isMain ? t("On the dashboard") : null,
      ]
        .filter(Boolean)
        .join(" · "),
      content: (
        <div className="flex flex-col gap-4">
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
        </div>
      ),
    },
  ]

  return (
    <FormFlow
      title={mode === "create" ? t("New subject") : t("Edit subject")}
      backHref={returnTo ?? "/subjects"}
      steps={steps}
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Add subject") : t("Save changes")}
      submitting={saving}
      destructive={
        mode === "edit" && initial?.id
          ? { label: t("Delete"), onClick: () => setDeleteOpen(true) }
          : undefined
      }
      footerNote={
        childCount > 0
          ? t("Deleting this also removes {count} subjects underneath it.", {
              count: String(childCount),
            })
          : undefined
      }
      overlays={
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive">
                <Trash2Icon />
              </AlertDialogMedia>
              <AlertDialogTitle>
                {t("Delete {name}?", { name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {impact.data
                  ? t(
                      "This branch contains {subjects} child subjects and {grades} grades.",
                      {
                        subjects: String(impact.data.descendants),
                        grades: String(impact.data.grades),
                      }
                    )
                  : t("Checking what would be removed…")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">{t("Cancel")}</AlertDialogCancel>
              {(impact.data?.descendants ?? childCount) > 0 ? (
                <AlertDialogAction
                  type="button"
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate({
                      subjectId: initial?.id as string,
                      promoteChildren: true,
                    })
                  }
                >
                  {t("Keep child subjects")}
                </AlertDialogAction>
              ) : null}
              <AlertDialogAction
                type="button"
                variant="destructive"
                disabled={remove.isPending || impact.isLoading}
                onClick={() =>
                  remove.mutate({
                    subjectId: initial?.id as string,
                    promoteChildren: false,
                  })
                }
              >
                {(impact.data?.descendants ?? childCount) > 0
                  ? t("Delete the whole branch")
                  : t("Delete subject")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  )
}
