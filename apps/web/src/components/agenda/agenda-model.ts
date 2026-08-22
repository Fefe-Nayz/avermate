import { dayKey } from "@/components/calendar/month-grid"

export type AgendaViewMode = "calendar" | "list" | "board"
export type PlannerTaskStatus = "todo" | "doing" | "done"
export type AgendaSource = "planner" | "goal" | "grade" | "period"
export type AgendaKind = "task" | "event" | "goal" | "grade" | "period"

export interface AgendaEntry {
  id: string
  source: AgendaSource
  kind: AgendaKind
  title: string
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
  status?: PlannerTaskStatus
  completed: boolean
  subjectId: string | null
  referenceId: string
  href: string
}

export interface PlannerItem {
  id: string
  kind: "task" | "event"
  title: string
  notes: string | null
  startsAt: Date | null
  endsAt: Date | null
  allDay: boolean
  status: PlannerTaskStatus
  completedAt: Date | null
  subjectId: string | null
  sortOrder: number
  yearId: string
}

export type AgendaTone =
  "planner-task" | "planner-event" | "goal" | "grade" | "period"

export function agendaTone(
  entry: Pick<AgendaEntry, "source" | "kind">
): AgendaTone {
  if (entry.source === "planner") {
    return entry.kind === "task" ? "planner-task" : "planner-event"
  }
  return entry.source
}

export const AGENDA_TONE_CLASS: Record<
  AgendaTone,
  { dot: string; chip: string }
> = {
  "planner-task": {
    dot: "bg-primary",
    chip: "bg-primary/10 text-primary",
  },
  "planner-event": {
    dot: "bg-chart-2",
    chip: "bg-chart-2/12 text-chart-2",
  },
  goal: {
    dot: "bg-band-good",
    chip: "bg-band-good/12 text-band-good",
  },
  grade: {
    dot: "bg-chart-4",
    chip: "bg-chart-4/12 text-chart-4",
  },
  period: {
    dot: "bg-muted-foreground",
    chip: "bg-muted text-muted-foreground",
  },
}

export type AgendaBoundary = "start" | "end" | null

export interface AgendaOccurrence {
  key: string
  date: Date
  entry: AgendaEntry
  boundary: AgendaBoundary
}

/**
 * Periods are ranges, but a month agenda is about moments. They therefore
 * become honest start/end markers rather than pretending to be one event on
 * every intervening day. Other entries keep their single start moment.
 */
export function agendaOccurrences(
  entries: readonly AgendaEntry[],
  window?: { from: Date; to: Date }
): AgendaOccurrence[] {
  const occurrences: AgendaOccurrence[] = []
  for (const entry of entries) {
    occurrences.push({
      key: `${entry.source}:${entry.id}:start`,
      date: entry.startsAt,
      entry,
      boundary: entry.kind === "period" ? "start" : null,
    })
    if (entry.kind === "period" && entry.endsAt) {
      occurrences.push({
        key: `${entry.source}:${entry.id}:end`,
        date: entry.endsAt,
        entry,
        boundary: "end",
      })
    }
  }
  return occurrences
    .filter(
      (occurrence) =>
        !window ||
        (occurrence.date >= window.from && occurrence.date <= window.to)
    )
    .sort(
      (left, right) =>
        left.date.getTime() - right.date.getTime() ||
        left.entry.title.localeCompare(right.entry.title) ||
        left.key.localeCompare(right.key)
    )
}

export function groupAgendaByDay(
  occurrences: readonly AgendaOccurrence[]
): Array<{ key: string; date: Date; items: AgendaOccurrence[] }> {
  const groups = new Map<string, AgendaOccurrence[]>()
  for (const occurrence of occurrences) {
    const key = dayKey(occurrence.date)
    const found = groups.get(key)
    if (found) found.push(occurrence)
    else groups.set(key, [occurrence])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, items]) => ({ key, date: items[0]?.date ?? new Date(), items }))
}

export function plannerTasksByLane(items: readonly PlannerItem[]) {
  const lanes: Record<PlannerTaskStatus, PlannerItem[]> = {
    todo: [],
    doing: [],
    done: [],
  }
  for (const item of items) {
    if (item.kind === "task") lanes[item.status].push(item)
  }
  for (const lane of Object.values(lanes)) {
    lane.sort((left, right) => left.sortOrder - right.sortOrder)
  }
  return lanes
}

/** Apply the same placement contract as `planner.moveInBoard` optimistically. */
export function moveBoardTask(
  items: readonly PlannerItem[],
  itemId: string,
  status: PlannerTaskStatus,
  beforeId: string | null
): PlannerItem[] {
  const moved = items.find((item) => item.id === itemId && item.kind === "task")
  if (!moved) return [...items]

  const untouched = items.filter((item) => item.id !== itemId)
  const destination = untouched
    .filter((item) => item.kind === "task" && item.status === status)
    .sort((left, right) => left.sortOrder - right.sortOrder)
  const beforeIndex = beforeId
    ? destination.findIndex((item) => item.id === beforeId)
    : destination.length
  destination.splice(beforeIndex < 0 ? destination.length : beforeIndex, 0, {
    ...moved,
    status,
    completedAt: status === "done" ? (moved.completedAt ?? new Date()) : null,
  })

  const order = new Map(destination.map((item, index) => [item.id, index]))
  const next = [...untouched, destination.find((item) => item.id === itemId)!]
  return next.map((item) =>
    item.kind === "task" && item.status === status && order.has(item.id)
      ? { ...item, sortOrder: order.get(item.id) as number }
      : item
  )
}

/**
 * Translate dnd-kit's "over this card" into the server's "before this id".
 * Moving down needs the card after the hovered one; otherwise inserting
 * before the hovered card would put the task back where it started.
 */
export function boardDropBeforeId(
  items: readonly PlannerItem[],
  itemId: string,
  status: PlannerTaskStatus,
  overId: string | null
): string | null {
  if (!overId) return null
  const lanes = plannerTasksByLane(items)
  const source = items.find((item) => item.id === itemId)
  if (!source || source.kind !== "task" || source.status !== status) {
    return overId
  }
  const lane = lanes[status]
  const from = lane.findIndex((item) => item.id === itemId)
  const to = lane.findIndex((item) => item.id === overId)
  if (from < 0 || to < 0) return overId
  if (from < to) return lane[to + 1]?.id ?? null
  if (from === to) return lane[to + 1]?.id ?? null
  return overId
}

export function localDateTimeValue(value: Date | null): string {
  if (!value) return ""
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

export function parseLocalDateTime(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
