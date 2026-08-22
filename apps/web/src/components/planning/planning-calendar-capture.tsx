"use client"

import { useMemo, useState, type FormEvent } from "react"
import { isoDateInTimeZone, zonedDateTimeToDate } from "@avermate/core/planning"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarPlus2Icon, SaveIcon, XIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { DateField, SelectControl } from "@/components/forms/controls"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  asValidDate,
  planningItemStart,
  type PlanningItem,
} from "./planning-model"

type CaptureKind = "event" | "lesson"
type EventKind = "event" | "block" | "holiday" | "workday"
type LessonRepeat = "once" | "weekly" | "daily"

export function PlanningCalendarCapture({
  yearId,
  initialDate,
  timezone,
  item,
  onClose,
}: {
  yearId: string
  initialDate: string
  timezone: string
  item?: PlanningItem | null
  onClose: () => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const { graph } = useYear()
  const editing = item?.kind === "event" || item?.kind === "lesson"
  const effectiveTimezone = item?.timezone?.trim() || timezone
  const initialStart = item ? planningItemStart(item) : null
  const initialEnd = item ? asValidDate(item.endsAt) : null
  const [kind, setKind] = useState<CaptureKind>(
    item?.kind === "lesson" ? "lesson" : "event"
  )
  const [eventKind, setEventKind] = useState<EventKind>(
    isEventKind(item?.eventKind) ? item.eventKind : "event"
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
    initialStart ? inputTime(initialStart, effectiveTimezone) : "09:00"
  )
  const [endTime, setEndTime] = useState(
    initialEnd
      ? inputTime(initialEnd, effectiveTimezone)
      : item?.kind === "event"
        ? ""
        : "10:00"
  )
  const [allDay, setAllDay] = useState(item?.allDay ?? false)
  const [repeat, setRepeat] = useState<LessonRepeat>("once")
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

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.planning.calendar.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.events.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.timetable.listSeries.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.timetable.listOccurrences.key(),
      }),
    ])
  }
  const succeeded = async () => {
    haptic("success")
    toast.success(
      editing ? t("Calendar item updated.") : t("Calendar item created.")
    )
    await invalidate()
    onClose()
  }
  const eventCreate = useMutation({
    ...orpc.planning.events.create.mutationOptions(),
    onSuccess: succeeded,
    onError: mutationError,
  })
  const eventUpdate = useMutation({
    ...orpc.planning.events.update.mutationOptions(),
    onSuccess: succeeded,
    onError: mutationError,
  })
  const occurrenceCreate = useMutation({
    ...orpc.planning.timetable.createOccurrence.mutationOptions(),
    onSuccess: succeeded,
    onError: mutationError,
  })
  const occurrenceUpdate = useMutation({
    ...orpc.planning.timetable.updateOccurrence.mutationOptions(),
    onSuccess: succeeded,
    onError: mutationError,
  })
  const seriesCreate = useMutation({
    ...orpc.planning.timetable.createSeries.mutationOptions(),
    onSuccess: succeeded,
    onError: mutationError,
  })
  const pending = [
    eventCreate,
    eventUpdate,
    occurrenceCreate,
    occurrenceUpdate,
    seriesCreate,
  ].some((mutation) => mutation.isPending)

  const subjects = useMemo(
    () => [
      { value: "none", label: t("No subject") },
      ...graph
        .flatten()
        .filter((subject) => subject.kind !== "category")
        .map((subject) => ({ value: subject.id, label: subject.name })),
    ],
    [graph, t]
  )
  const effectiveAllDay =
    kind === "event" &&
    (eventKind === "holiday" || eventKind === "workday" || allDay)

  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
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
      if (item?.kind === "event") {
        eventUpdate.mutate({
          eventId: item.id,
          eventKind,
          title: cleanTitle,
          description: cleanDetails,
          startsAt,
          endsAt,
          allDay: effectiveAllDay,
          timezone: effectiveTimezone,
          location: cleanLocation,
          subjectId: cleanSubjectId,
        })
      } else {
        eventCreate.mutate({
          yearId,
          eventKind,
          title: cleanTitle,
          description: cleanDetails,
          startsAt,
          endsAt,
          allDay: effectiveAllDay,
          timezone: effectiveTimezone,
          location: cleanLocation,
          subjectId: cleanSubjectId,
        })
      }
      return
    }

    const startsAt = zonedDateTime(date, startTime, effectiveTimezone)
    const endsAt = zonedDateTime(endDate || date, endTime, effectiveTimezone)
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      toast.error(t("The end must be after the start."))
      return
    }
    if (item?.kind === "lesson") {
      if (item.virtual && item.seriesId && item.occurrenceDate) {
        occurrenceCreate.mutate({
          seriesId: item.seriesId,
          occurrenceDate: item.occurrenceDate,
          title: cleanTitle,
          notes: cleanDetails,
          startsAt,
          endsAt,
          timezone: effectiveTimezone,
          location: cleanLocation,
          subjectId: cleanSubjectId,
        })
      } else {
        occurrenceUpdate.mutate({
          occurrenceId: item.occurrenceId ?? item.id,
          title: cleanTitle,
          notes: cleanDetails,
          startsAt,
          endsAt,
          timezone: effectiveTimezone,
          location: cleanLocation,
          subjectId: cleanSubjectId,
        })
      }
      return
    }
    if (repeat === "once") {
      occurrenceCreate.mutate({
        yearId,
        seriesId: null,
        occurrenceDate: date,
        title: cleanTitle,
        notes: cleanDetails,
        startsAt,
        endsAt,
        timezone: effectiveTimezone,
        location: cleanLocation,
        subjectId: cleanSubjectId,
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

  return (
    <form
      onSubmit={submit}
      aria-labelledby="planning-calendar-capture-title"
      className="rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="planning-calendar-capture-title" className="font-semibold">
            {editing ? t("Edit calendar item") : t("New calendar item")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {editing
              ? t("Changes apply only to this occurrence.")
              : t("Events and classes stay separate from your personal tasks.")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={t("Close form")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>

      {!editing ? (
        <div className="mt-4 max-w-xs">
          <SelectControl
            aria-label={t("Calendar item type")}
            value={kind}
            onValueChange={(value) => setKind(value as CaptureKind)}
            options={[
              { value: "event", label: t("Event or calendar block") },
              { value: "lesson", label: t("Class") },
            ]}
          />
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind === "event" ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("Event type")}
            <SelectControl
              value={eventKind}
              onValueChange={(value) => {
                const next = value as EventKind
                setEventKind(next)
                if (next === "holiday" || next === "workday") setAllDay(true)
                if (next === "block") setAllDay(false)
              }}
              options={[
                { value: "event", label: t("Event") },
                { value: "block", label: t("Time block") },
                { value: "holiday", label: t("Holiday or vacation") },
                { value: "workday", label: t("Work day") },
              ]}
            />
          </label>
        ) : !editing ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("Recurrence")}
            <SelectControl
              value={repeat}
              onValueChange={(value) => setRepeat(value as LessonRepeat)}
              options={[
                { value: "once", label: t("One class") },
                { value: "weekly", label: t("Every week") },
                { value: "daily", label: t("Every day") },
              ]}
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
          {t("Title")}
          <Input
            value={title}
            maxLength={160}
            autoFocus
            required
            placeholder={
              kind === "lesson" ? t("Mathematics class") : t("School closure")
            }
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        {/* The app's calendar, in a popover — not three native date controls, which
            `DateField` was written to replace and which draw a browser-grey panel in
            the middle of the form. `min` goes with them: the picker takes the same
            bound, so an end date before its start is unreachable rather than
            merely rejected. */}
        <DateField
          label={kind === "lesson" ? t("Class date") : t("Date")}
          required
          value={date}
          onValueChange={(next) => {
            if (!endDate || endDate === date) setEndDate(next)
            setDate(next)
          }}
        />

        <DateField
          label={kind === "lesson" ? t("Class end date") : t("End date")}
          required={kind === "lesson" || effectiveAllDay}
          min={date}
          value={endDate}
          onValueChange={setEndDate}
        />

        {kind === "lesson" && repeat !== "once" && !editing ? (
          <DateField
            label={t("Repeat until")}
            min={date}
            value={endsOn}
            onValueChange={setEndsOn}
          />
        ) : null}

        {kind === "event" && eventKind !== "block" ? (
          <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm font-medium">
            <Checkbox
              checked={effectiveAllDay}
              disabled={eventKind === "holiday" || eventKind === "workday"}
              onCheckedChange={(checked) => setAllDay(checked === true)}
            />
            {t("All day")}
          </label>
        ) : null}

        {!effectiveAllDay ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("Start time")}
              <Input
                type="time"
                value={startTime}
                required
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("End time")}
              <Input
                type="time"
                value={endTime}
                required={kind === "lesson" || eventKind === "block"}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
          </>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("Subject")}
          <SelectControl
            value={subjectId}
            onValueChange={setSubjectId}
            options={subjects}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("Location")}
          <Input
            value={location}
            maxLength={300}
            placeholder={t("Room B12")}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2 lg:col-span-4">
          {kind === "lesson" ? t("Class notes") : t("Description")}
          <Textarea
            value={details}
            maxLength={2_000}
            placeholder={t("Optional details…")}
            onChange={(event) => setDetails(event.target.value)}
          />
        </label>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {repeat === "weekly" && date
          ? t("This class repeats every {weekday}.", {
              weekday: format.dateTime(
                zonedDateTime(date, "12:00", effectiveTimezone)!,
                {
                  weekday: "long",
                  timeZone: effectiveTimezone,
                }
              ),
            })
          : t("Times are saved in {timezone}.", {
              timezone: effectiveTimezone,
            })}
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onClose}
        >
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={!title.trim() || !date || pending}>
          {editing ? <SaveIcon /> : <CalendarPlus2Icon />}
          {editing ? t("Save changes") : t("Add to calendar")}
        </Button>
      </div>
    </form>
  )
}

function mutationError(error: Error) {
  toast.error(error.message)
}

function isEventKind(value: unknown): value is EventKind {
  return ["event", "block", "holiday", "workday"].includes(String(value))
}

function zonedDateTime(
  date: string,
  time: string,
  timezone: string
): Date | null {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null
  try {
    return zonedDateTimeToDate(date, minutesOfDay(time), timezone)
  } catch {
    return null
  }
}

function inputTime(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value)
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00"
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00"
  return `${hour}:${minute}`
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function endOfZonedDay(date: string, timezone: string): Date | null {
  const lastMinute = zonedDateTime(date, "23:59", timezone)
  return lastMinute ? new Date(lastMinute.getTime() + 59_999) : null
}
