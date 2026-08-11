"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { StarIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { resolveCustomAverage } from "@avermate/core"
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { FormPage } from "@/components/forms/form-page"
import { FormSection, TextField } from "@/components/forms/controls"
import { AverageValue } from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"

interface Entry {
  subjectId: string
  coefficient: string
  includeChildren: boolean
}

export interface AverageFormValues {
  id?: string
  name: string
  isMain: boolean
  entries: Entry[]
}

/**
 * Building a custom average.
 *
 * The result is computed live from the current selection, so the answer to
 * "what would my written-exams average be?" appears while the boxes are still
 * being ticked rather than after a save.
 */
export function AverageForm({
  initial,
  mode,
}: {
  initial?: Partial<AverageFormValues>
  mode: "create" | "edit"
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, yearId } = useYear()

  const [name, setName] = useState(initial?.name ?? "")
  const [isMain, setIsMain] = useState(initial?.isMain ?? false)
  const [entries, setEntries] = useState<Entry[]>(initial?.entries ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const selected = useMemo(
    () => new Map(entries.map((entry) => [entry.subjectId, entry])),
    [entries]
  )

  const preview = useMemo(() => {
    if (entries.length === 0) return null
    const resolved = resolveCustomAverage(graph, {
      id: "__preview__",
      name,
      isMain,
      sortOrder: 0,
      entries: entries.map((entry) => ({
        subjectId: entry.subjectId,
        coefficient:
          entry.coefficient.trim() === ""
            ? null
            : Number.parseFloat(entry.coefficient.replace(",", ".")),
        includeChildren: entry.includeChildren,
      })),
    })
    return resolved.graph.ratio(null, resolved.scope)
  }, [graph, entries, name, isMain])

  const toggle = (subjectId: string) => {
    haptic("selection")
    setEntries((current) =>
      current.some((entry) => entry.subjectId === subjectId)
        ? current.filter((entry) => entry.subjectId !== subjectId)
        : [...current, { subjectId, coefficient: "", includeChildren: false }]
    )
  }

  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(
        mode === "create" ? t("Average created") : t("Average updated")
      )
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.queryKey({
            input: { yearId: yearId ?? "" },
          }),
        }),
        invalidateAnnouncementAudience(queryClient),
      ])
      router.push("/settings/averages")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The average could not be saved."))
    },
  }

  const create = useMutation({
    ...orpc.averages.create.mutationOptions(),
    ...onSaved,
  })
  const update = useMutation({
    ...orpc.averages.update.mutationOptions(),
    ...onSaved,
  })
  const remove = useMutation({
    ...orpc.averages.delete.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Average deleted"))
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.queryKey({
            input: { yearId: yearId ?? "" },
          }),
        }),
        invalidateAnnouncementAudience(queryClient),
      ])
      router.push("/settings/averages")
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = t("Give this average a name.")
    if (entries.length === 0) next.entries = t("Pick at least one subject.")
    setErrors(next)
    if (Object.keys(next).length > 0) {
      haptic("warning")
      return
    }

    const payload = {
      name: name.trim(),
      isMain,
      entries: entries.map((entry) => ({
        subjectId: entry.subjectId,
        coefficient:
          entry.coefficient.trim() === ""
            ? null
            : Number.parseFloat(entry.coefficient.replace(",", ".")),
        includeChildren: entry.includeChildren,
      })),
    }

    if (mode === "create") {
      create.mutate({ yearId: yearId as string, ...payload })
    } else {
      update.mutate({ averageId: initial?.id as string, ...payload })
    }
  }

  return (
    <FormPage
      title={
        mode === "create" ? t("New custom average") : t("Edit custom average")
      }
      description={t("Combine any subjects, with weights of your own.")}
      backHref="/settings/averages"
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Create") : t("Save changes")}
      submitting={create.isPending || update.isPending}
      destructive={
        mode === "edit" && initial?.id
          ? {
              label: t("Delete"),
              onClick: () => remove.mutate({ averageId: initial.id as string }),
            }
          : undefined
      }
    >
      <FormSection>
        <TextField
          label={t("Name")}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("Written exams, science block, mock results…")}
          error={errors.name}
          autoFocus={mode === "create"}
        />

        <Field orientation="horizontal">
          <FieldLabel htmlFor="is-main-average" className="flex-1">
            <span className="flex items-center gap-1.5">
              <StarIcon className="size-4" />
              {t("Use this instead of the general average")}
            </span>
            <span className="block text-xs font-normal text-muted-foreground">
              {t("Shown wherever the headline average appears")}
            </span>
          </FieldLabel>
          <Switch
            id="is-main-average"
            checked={isMain}
            onCheckedChange={(checked) => {
              haptic("selection")
              setIsMain(checked)
            }}
          />
        </Field>
      </FormSection>

      {preview !== null ? (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("This average right now")}
          </p>
          <AverageValue
            ratio={preview}
            showScale
            colored
            className="mt-1 text-3xl font-semibold"
          />
        </div>
      ) : null}

      <FormSection
        title={t("Subjects")}
        description={
          errors.entries ??
          t("Leave a weight blank to keep the subject's own coefficient.")
        }
      >
        <div className="overflow-hidden rounded-xl border">
          {graph.flatten().map((subject, index) => {
            const entry = selected.get(subject.id)
            const isCategory = subject.kind === "category"

            return (
              <div
                key={subject.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  index > 0 && "border-t",
                  isCategory && "bg-muted/40"
                )}
                style={{
                  paddingInlineStart: `${0.75 + graph.depthOf(subject.id) * 0.85}rem`,
                }}
              >
                <Checkbox
                  checked={Boolean(entry)}
                  onCheckedChange={() => toggle(subject.id)}
                  aria-label={subject.name}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    isCategory &&
                      "text-xs tracking-wide text-muted-foreground uppercase"
                  )}
                >
                  {subject.name}
                </span>

                {entry ? (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={entry.includeChildren}
                        onCheckedChange={(checked) =>
                          setEntries((current) =>
                            current.map((item) =>
                              item.subjectId === subject.id
                                ? { ...item, includeChildren: checked === true }
                                : item
                            )
                          )
                        }
                      />
                      {t("with children")}
                    </label>
                    <Input
                      value={entry.coefficient}
                      onChange={(event) =>
                        setEntries((current) =>
                          current.map((item) =>
                            item.subjectId === subject.id
                              ? { ...item, coefficient: event.target.value }
                              : item
                          )
                        )
                      }
                      inputMode="decimal"
                      placeholder={String(subject.coefficient)}
                      className="numeric h-9 w-16 text-center"
                    />
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </FormSection>
    </FormPage>
  )
}
