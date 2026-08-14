"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { LayoutDashboardIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { resolveCustomAverage } from "@avermate/core"
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { TextField } from "@/components/forms/controls"
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
  returnTo,
}: {
  initial?: Partial<AverageFormValues>
  mode: "create" | "edit"
  returnTo?: string
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, yearId } = useYear()

  const [name, setName] = useState(initial?.name ?? "")
  const [addDashboardCard, setAddDashboardCard] = useState(false)
  const [entries, setEntries] = useState<Entry[]>(initial?.entries ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const selected = useMemo(
    () => new Map(entries.map((entry) => [entry.subjectId, entry])),
    [entries]
  )

  // Subjects swept in by an ancestor's "with children": their inclusion is
  // decided upstream, so their own checkbox must read as checked — greyed,
  // because unticking them individually is not a thing that can happen.
  const impliedBy = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of entries) {
      if (!entry.includeChildren) continue
      const parent = graph.byId(entry.subjectId)
      if (!parent) continue
      for (const descendant of graph.descendantsOf(entry.subjectId)) {
        if (!map.has(descendant.id)) map.set(descendant.id, parent.name)
      }
    }
    return map
  }, [entries, graph])

  const preview = useMemo(() => {
    if (entries.length === 0) return null
    const resolved = resolveCustomAverage(graph, {
      id: "__preview__",
      name,
      isMain: false,
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
  }, [graph, entries, name])

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
      router.push(returnTo ?? "/settings/averages")
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
      router.push(returnTo ?? "/settings/averages")
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
      create.mutate({
        yearId: yearId as string,
        addDashboardCard,
        ...payload,
      })
    } else {
      update.mutate({ averageId: initial?.id as string, ...payload })
    }
  }

  const previewCard =
    preview !== null ? (
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
    ) : null

  const steps: FlowStep[] = [
    {
      id: "subjects",
      title: t("Which subjects go in?"),
      description: t(
        "Leave a weight blank to keep the subject's own coefficient."
      ),
      summary:
        entries.length === 0
          ? null
          : t("{count} subjects", { count: String(entries.length) }),
      validate: () => {
        const problem: Record<string, string> = entries.length
          ? {}
          : { entries: t("Pick at least one subject.") }
        setErrors(problem)
        return Object.keys(problem).length === 0
      },
      content: (
        <div className="flex flex-col gap-3">
          {errors.entries ? (
            <p className="text-sm text-destructive">{errors.entries}</p>
          ) : null}

          <div className="overflow-hidden rounded-xl border">
            {graph.flatten().map((subject, index) => {
              const entry = selected.get(subject.id)
              const isCategory = subject.kind === "category"
              const impliedParent = impliedBy.get(subject.id)

              return (
                <div
                  key={subject.id}
                  className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5",
                    index > 0 && "border-t",
                    isCategory && "bg-muted/40"
                  )}
                  style={{
                    paddingInlineStart: `${0.75 + graph.depthOf(subject.id) * 0.85}rem`,
                  }}
                >
                  <Checkbox
                    checked={Boolean(entry) || Boolean(impliedParent)}
                    disabled={Boolean(impliedParent) && !entry}
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

                  {!entry && impliedParent ? (
                    <span className="text-xs text-muted-foreground">
                      {t("included with {name}", { name: impliedParent })}
                    </span>
                  ) : null}
                  {entry ? (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          checked={entry.includeChildren}
                          onCheckedChange={(checked) =>
                            setEntries((current) =>
                              current.map((item) =>
                                item.subjectId === subject.id
                                  ? {
                                      ...item,
                                      includeChildren: checked === true,
                                    }
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
                        className="numeric h-10 w-16 text-center md:h-9"
                      />
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>

          {previewCard}
        </div>
      ),
    },
    {
      id: "name",
      title: t("Name it"),
      description: t("Give this calculation a clear, recognisable name."),
      summary: name.trim() || null,
      validate: () => {
        const problem: Record<string, string> = name.trim()
          ? {}
          : { name: t("Give this average a name.") }
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
            placeholder={t("Written exams, science block, mock results…")}
            error={errors.name}
          />

          {mode === "create" ? (
            <Field orientation="horizontal">
              <FieldLabel htmlFor="add-average-card" className="flex-1">
                <span className="flex items-center gap-1.5">
                  <LayoutDashboardIcon className="size-4" />
                  {t("Add a DataCard to the dashboard")}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {t(
                    "Creates a separate card for this average. You can edit or remove it later."
                  )}
                </span>
              </FieldLabel>
              <Switch
                id="add-average-card"
                checked={addDashboardCard}
                onCheckedChange={(checked) => {
                  haptic("selection")
                  setAddDashboardCard(checked)
                }}
              />
            </Field>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <FormFlow
      title={
        mode === "create" ? t("New custom average") : t("Edit custom average")
      }
      description={t("Combine any subjects, with weights of your own.")}
      backHref={returnTo ?? "/settings/averages"}
      steps={steps}
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
    />
  )
}
