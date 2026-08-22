"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { isoDateInTimeZone } from "@avermate/core/planning"
import { DateField, SelectField, TextField } from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { invalidatePlanning } from "./planning-invalidate"
import {
  endOfZonedDay,
  isPlanningEventKind,
  isoWeekday,
  minutesOfDay,
  timeInTimeZone,
  zonedDateTime,
  type PlanningEventKind,
  type PlanningLessonRepeat,
} from "./planning-calendar-time"
import { useSubjectOptions } from "./planning-form-fields"
import {
  asValidDate,
  planningItemStart,
  type PlanningItem,
} from "./planning-model"

type CalendarKind = "event" | "lesson"

/**
 * A calendar entry — a class, an event, a blocked stretch, a holiday.
 *
 * The one form of the three with real branching: what you are adding decides
 * which questions follow, and a class can repeat where an event cannot. The
 * flow makes that legible rather than showing every field at once and greying
 * two thirds of them out — the first step is the kind, and the steps after it
 * appear or do not.
 *
 * The timing rules are the server's and are checked here too, because a form
 * that lets you press save on an end before its start has already wasted the
 * press.
 */
export function PlanningEventForm({
  yearId,
  timezone,
  mode,
  item,
  initialDate,
}: {
  yearId: string
  timezone: string
  mode: "create" | "edit"
  item?: PlanningItem | null
  /** The day the calendar was showing when this was opened. */
  initialDate: string
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph } = useYear()

  const effectiveTimezone = item?.timezone?.trim() || timezone
  const initialStart = item ? planningItemStart(item) : null
  const initialEnd = item ? asValidDate(item.endsAt) : null

  const [kind, setKind] = useState<CalendarKind>(
    item?.kind === "lesson" ? "lesson" : "event"
  )
  const [eventKind, setEventKind] = useState<PlanningEventKind>(
    isPlanningEventKind(item?.eventKind) ? item.eventKind : "event"
  )
  const [title, setTitle] = useState(item?.title ?? "")
  const [date, setDate] = useState(
    initialStart
      ? isoDateInTimeZone(initialStart, effectiveTimezone)
      : initialDate
  )
  const [endDate, setEndDate] = useState(
    initialEnd
      ? isoDateInTimeZone(initialEnd, effectiveTimezone)
      : initialStart
        ? isoDateInTimeZone(initialStart, effectiveTimezone)
        : initialDate
  )
  const [startTime, setStartTime] = useState(
    initialStart ? timeInTimeZone(initialStart, effectiveTimezone) : "09:00"
  )
  const [endTime, setEndTime] = useState(
    initialEnd
      ? timeInTimeZone(initialEnd, effectiveTimezone)
      : item?.kind === "event"
        ? ""
        : "10:00"
  )
  const [allDay, setAllDay] = useState(item?.allDay ?? false)
  const [repeat, setRepeat] = useState<PlanningLessonRepeat>("once")
  const [endsOn, setEndsOn] = useState("")
  const [subjectId, setSubjectId] = useState(item?.subjectId ?? "none")
  const [location, setLocation] = useState(item?.location ?? "")
  const [details, setDetails] = useState(
    item?.kind === "event"
      ? (item.description ?? "")
      : item?.kind === "lesson"
        ? (item.notes ?? "")
        : ""
  )

  const subjectOptions = useSubjectOptions(graph)
  const subjectName =
    subjectOptions.find((option) => option.value === subjectId)?.label ?? ""

  // A holiday and a workday are days, not hours: they carry no clock at all.
  const effectiveAllDay =
    kind === "event" &&
    (eventKind === "holiday" || eventKind === "workday" || allDay)

  const done = async () => {
    haptic("success")
    toast.success(
      mode === "edit"
        ? t("Calendar item updated.")
        : t("Calendar item created.")
    )
    await invalidatePlanning(queryClient)
    router.push("/planning/calendar")
  }
  const failed = (error: Error) => {
    haptic("error")
    toast.error(error.message || t("The calendar item could not be saved."))
  }
  const options = { onSuccess: done, onError: failed }

  const eventCreate = useMutation({
    ...orpc.planning.events.create.mutationOptions(),
    ...options,
  })
  const eventUpdate = useMutation({
    ...orpc.planning.events.update.mutationOptions(),
    ...options,
  })
  const occurrenceCreate = useMutation({
    ...orpc.planning.timetable.createOccurrence.mutationOptions(),
    ...options,
  })
  const occurrenceUpdate = useMutation({
    ...orpc.planning.timetable.updateOccurrence.mutationOptions(),
    ...options,
  })
  const seriesCreate = useMutation({
    ...orpc.planning.timetable.createSeries.mutationOptions(),
    ...options,
  })
  const saving = [
    eventCreate,
    eventUpdate,
    occurrenceCreate,
    occurrenceUpdate,
    seriesCreate,
  ].some((mutation) => mutation.isPending)

  const submit = () => {
    const cleanTitle = title.trim()
    if (!cleanTitle || !date) return
    const cleanSubjectId = subjectId === "none" ? null : subjectId
    const cleanLocation = location.trim() || null
    const cleanDetails = details.trim() || null

    if (kind === "event") {
      const startsAt = zonedDateTime(
        date,
        effectiveAllDay ? "00:00" : startTime,
        effectiveTimezone
      )
      const endsAt = effectiveAllDay
        ? endDate
          ? endOfZonedDay(endDate, effectiveTimezone)
          : null
        : endTime
          ? zonedDateTime(endDate || date, endTime, effectiveTimezone)
          : null
      if (!startsAt || (endsAt && endsAt <= startsAt)) {
        toast.error(t("The end must be after the start."))
        return
      }
      if (eventKind === "block" && !endsAt) {
        toast.error(t("A time block needs an end time."))
        return
      }
      const values = {
        eventKind,
        title: cleanTitle,
        description: cleanDetails,
        startsAt,
        endsAt,
        allDay: effectiveAllDay,
        timezone: effectiveTimezone,
        location: cleanLocation,
        subjectId: cleanSubjectId,
      }
      if (item?.kind === "event") {
        eventUpdate.mutate({ eventId: item.id, ...values })
      } else {
        eventCreate.mutate({ yearId, ...values })
      }
      return
    }

    const startsAt = zonedDateTime(date, startTime, effectiveTimezone)
    const endsAt = zonedDateTime(endDate || date, endTime, effectiveTimezone)
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      toast.error(t("The end must be after the start."))
      return
    }
    const lesson = {
      title: cleanTitle,
      notes: cleanDetails,
      startsAt,
      endsAt,
      timezone: effectiveTimezone,
      location: cleanLocation,
      subjectId: cleanSubjectId,
    }

    if (item?.kind === "lesson") {
      // Editing one date of a repeating class writes an exception for that
      // date rather than moving every week of the series.
      if (item.virtual && item.seriesId && item.occurrenceDate) {
        occurrenceCreate.mutate({
          seriesId: item.seriesId,
          occurrenceDate: item.occurrenceDate,
          ...lesson,
        })
      } else {
        occurrenceUpdate.mutate({
          occurrenceId: item.occurrenceId ?? item.id,
          ...lesson,
        })
      }
      return
    }
    if (repeat === "once") {
      occurrenceCreate.mutate({
        yearId,
        seriesId: null,
        occurrenceDate: date,
        ...lesson,
      })
      return
    }
    if (endsOn && endsOn < date) {
      toast.error(t("The recurrence end cannot be before the first class."))
      return
    }
    const durationMinutes = Math.round(
      (endsAt.getTime() - startsAt.getTime()) / 60_000
    )
    if (durationMinutes > 1_440) {
      toast.error(t("A class cannot last more than 24 hours."))
      return
    }
    seriesCreate.mutate({
      yearId,
      title: cleanTitle,
      notes: cleanDetails,
      startsOn: date,
      endsOn: endsOn || null,
      startMinutes: minutesOfDay(startTime),
      durationMinutes,
      timezone: effectiveTimezone,
      recurrence: {
        frequency: repeat,
        interval: 1,
        weekdays: repeat === "weekly" ? [isoWeekday(date)] : [],
      },
      location: cleanLocation,
      subjectId: cleanSubjectId,
    })
  }

  const kindOptions = useMemo(
    () => [
      { value: "lesson", label: t("A class") },
      { value: "event", label: t("An event") },
      { value: "block", label: t("A blocked stretch") },
      { value: "holiday", label: t("A holiday") },
      { value: "workday", label: t("A catch-up day") },
    ],
    [t]
  )
  const chosenKind = kind === "lesson" ? "lesson" : eventKind
  const kindLabel =
    kindOptions.find((option) => option.value === chosenKind)?.label ?? ""

  const repeatOptions = useMemo(
    () => [
      { value: "once", label: t("Just this once") },
      { value: "weekly", label: t("Every week") },
      { value: "daily", label: t("Every day") },
    ],
    [t]
  )

  const editingLesson = item?.kind === "lesson"
  const steps: FlowStep[] = [
    {
      id: "kind",
      title: t("What are you adding?"),
      // The kind decides which of the steps below apply, so it is asked first.
      when: mode === "create",
      content: (
        <SelectField
          label={t("Kind")}
          value={chosenKind}
          onValueChange={(value) => {
            if (value === "lesson") {
              setKind("lesson")
              return
            }
            setKind("event")
            if (isPlanningEventKind(value)) setEventKind(value)
          }}
          options={kindOptions}
        />
      ),
      summary: kindLabel,
    },
    {
      id: "title",
      title: kind === "lesson" ? t("Which class?") : t("What is it called?"),
      content: (
        <TextField
          label={t("Title")}
          required
          value={title}
          maxLength={160}
          autoFocus
          placeholder={kind === "lesson" ? t("Mathematics") : t("Mock exam")}
          onChange={(event) => setTitle(event.target.value)}
        />
      ),
      summary: title.trim() || undefined,
      validate: () => Boolean(title.trim()),
    },
    {
      id: "when",
      title: t("When?"),
      content: (
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField
            label={kind === "lesson" ? t("Date") : t("Start date")}
            value={date}
            onValueChange={setDate}
          />
          {effectiveAllDay ? (
            <DateField
              label={t("Last day")}
              value={endDate}
              onValueChange={setEndDate}
            />
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="planning-start-time">
                  {t("Starts at")}
                </FieldLabel>
                <Input
                  id="planning-start-time"
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="planning-end-time">
                  {t("Ends at")}
                </FieldLabel>
                <Input
                  id="planning-end-time"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </Field>
            </>
          )}
          {kind === "event" &&
          eventKind !== "holiday" &&
          eventKind !== "workday" ? (
            <Field
              orientation="horizontal"
              className="items-center sm:col-span-2"
            >
              <FieldLabel htmlFor="planning-all-day">{t("All day")}</FieldLabel>
              <Switch
                id="planning-all-day"
                checked={allDay}
                onCheckedChange={setAllDay}
              />
            </Field>
          ) : null}
        </div>
      ),
      summary: effectiveAllDay
        ? `${date}${endDate && endDate !== date ? ` → ${endDate}` : ""}`
        : `${date} · ${startTime}${endTime ? `–${endTime}` : ""}`,
      validate: () => Boolean(date),
    },
    {
      id: "repeat",
      title: t("Does it come back?"),
      // Only a new class repeats: an event happens once, and editing one date
      // of an existing series is an exception to it, not a new rhythm.
      when: kind === "lesson" && !editingLesson,
      content: (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t("Repeat")}
            value={repeat}
            onValueChange={(value) => setRepeat(value as PlanningLessonRepeat)}
            options={repeatOptions}
          />
          {repeat === "once" ? null : (
            <DateField
              label={t("Repeat until")}
              value={endsOn}
              onValueChange={setEndsOn}
            />
          )}
        </div>
      ),
      summary:
        repeatOptions.find((option) => option.value === repeat)?.label ?? "",
    },
    {
      id: "where",
      title: t("Where, and for which subject?"),
      content: (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t("Subject")}
            value={subjectId}
            onValueChange={setSubjectId}
            options={subjectOptions}
          />
          <TextField
            label={t("Place")}
            value={location}
            maxLength={160}
            placeholder={t("Room 204")}
            onChange={(event) => setLocation(event.target.value)}
          />
        </div>
      ),
      summary: [subjectName, location.trim()].filter(Boolean).join(" · "),
    },
  ]

  return (
    <FormFlow
      title={mode === "edit" ? t("Edit calendar item") : t("New calendar item")}
      backHref="/planning/calendar"
      steps={steps}
      beforeSave={
        <Field>
          <FieldLabel htmlFor="planning-event-details">
            {t("Details")}
          </FieldLabel>
          <Textarea
            id="planning-event-details"
            value={details}
            rows={3}
            maxLength={4_000}
            placeholder={t("Anything worth remembering")}
            onChange={(event) => setDetails(event.target.value)}
          />
          <FieldDescription>
            {t("Shown with the entry in the calendar.")}
          </FieldDescription>
        </Field>
      }
      onSubmit={submit}
      submitLabel={mode === "edit" ? t("Save changes") : t("Add to calendar")}
      submitting={saving}
      disabled={!title.trim() || !date}
    />
  )
}
