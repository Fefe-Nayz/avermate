"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { DateField, TextField } from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { SettingsRow } from "@/components/settings/settings-section"
import { Switch } from "@/components/ui/switch"
import { useYear } from "@/components/year/year-provider"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

export interface PeriodFormValues {
  id?: string
  name: string
  startAt: string
  endAt: string
  isCumulative: boolean
}

/**
 * A period, on the form every other object in this app gets.
 *
 * Periods were the exception: they were edited inside their own row in a list, so the
 * settings page held a column of open forms and a single "Save periods" button that
 * replaced the whole set at once. That is a different interaction from every other
 * thing you can create here, and it is the one the review of this screen objected to.
 *
 * `FormFlow` is what makes it the same: all the fields at once on a laptop, one
 * decision per screen on a phone with a review that reads the answers back, and the
 * primary action where a thumb reaches it. It renders page chrome, so this is a route
 * rather than a layer — which is exactly why the wizards keep their in-place editor:
 * their periods are unsaved drafts living in wizard state, and no route can reach them.
 */
export function PeriodForm({
  mode,
  initial,
  returnTo,
}: {
  mode: "create" | "edit"
  initial?: PeriodFormValues
  returnTo?: string
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, year } = useYear()

  const [name, setName] = useState(initial?.name ?? "")
  const [startAt, setStartAt] = useState(initial?.startAt ?? "")
  const [endAt, setEndAt] = useState(initial?.endAt ?? "")
  const [isCumulative, setIsCumulative] = useState(
    initial?.isCumulative ?? false
  )

  const back = returnTo ?? "/settings/year"
  const done = () => {
    haptic("success")
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      }),
      invalidateAnnouncementAudience(queryClient),
    ])
    router.push(back)
  }
  const failed = (error: Error) => {
    haptic("error")
    toast.error(error.message || t("The period could not be saved."))
  }

  const create = useMutation({
    ...orpc.periods.create.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const update = useMutation({
    ...orpc.periods.update.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const remove = useMutation({
    ...orpc.periods.delete.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })

  /**
   * The year's own bounds, as the dates' outer limit.
   *
   * A period outside its year is the one mistake here that is not a matter of taste,
   * and the fields are where to refuse it — the server checks too, but a form that
   * lets you type an impossible answer and then rejects it has wasted the typing.
   */
  const bounds = useMemo(() => {
    const iso = (value: Date | string | undefined) =>
      value ? new Date(value).toISOString().slice(0, 10) : undefined
    return { min: iso(year?.startsAt), max: iso(year?.endsAt) }
  }, [year])

  const named = name.trim().length > 0
  const dated = startAt !== "" && endAt !== "" && startAt <= endAt

  const steps: FlowStep[] = [
    {
      id: "name",
      title: t("What is this period called?"),
      description: t("Whatever your school calls it — Term 1, Semester 2."),
      content: (
        <TextField
          label={t("Name")}
          value={name}
          maxLength={64}
          required
          placeholder={t("Term 1")}
          onChange={(event) => setName(event.target.value)}
        />
      ),
      summary: name.trim() || undefined,
      validate: () => named,
    },
    {
      id: "dates",
      title: t("When does it run?"),
      description: t("Both dates stay inside the school year."),
      // One step, not two: a period *is* the span between them, and asking for a
      // start without an end is asking half a question.
      content: (
        <div className="grid gap-3 @lg/main:grid-cols-2">
          <DateField
            label={t("Starts")}
            value={startAt}
            min={bounds.min}
            max={bounds.max}
            onValueChange={setStartAt}
          />
          <DateField
            label={t("Ends")}
            value={endAt}
            min={startAt || bounds.min}
            max={bounds.max}
            onValueChange={setEndAt}
          />
        </div>
      ),
      summary: dated ? `${startAt} → ${endAt}` : undefined,
      validate: () => dated,
    },
    {
      id: "cumulative",
      title: t("Does it count from the start of the year?"),
      description: t(
        "A cumulative period averages everything since September, not just its own weeks."
      ),
      content: (
        <SettingsRow
          label={t("Cumulative")}
          description={t("Includes everything since the start of the year.")}
        >
          <Switch checked={isCumulative} onCheckedChange={setIsCumulative} />
        </SettingsRow>
      ),
      summary: isCumulative ? t("Cumulative") : t("Its own weeks only"),
    },
  ]

  return (
    <FormFlow
      title={mode === "create" ? t("New period") : t("Edit period")}
      description={t("A stretch of the year, and what it averages.")}
      backHref={back}
      steps={steps}
      onSubmit={() => {
        if (!yearId || !named || !dated) return
        const payload = {
          name: name.trim(),
          startAt: new Date(`${startAt}T00:00:00`),
          endAt: new Date(`${endAt}T23:59:59`),
          isCumulative,
        }
        if (mode === "create") create.mutate({ yearId, ...payload })
        else if (initial?.id)
          update.mutate({ periodId: initial.id, ...payload })
      }}
      submitLabel={mode === "create" ? t("Create") : t("Save changes")}
      submitting={create.isPending || update.isPending}
      disabled={!named || !dated}
      destructive={
        mode === "edit" && initial?.id
          ? {
              label: t("Delete"),
              onClick: () => remove.mutate({ periodId: initial.id as string }),
            }
          : undefined
      }
    />
  )
}
