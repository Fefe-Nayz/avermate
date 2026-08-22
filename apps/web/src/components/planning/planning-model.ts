import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { dayKey } from "@/components/calendar/month-grid"

export type PlanningTaskStatus = "todo" | "doing" | "done"
export type PlanningView = "month" | "week" | "day"
export type PlanningItemKind =
  "task" | "assignment" | "event" | "lesson" | "recording" | "legacy"

export interface PlanningManagement {
  mode: "user" | "provider"
  syncState: "managed" | "detached" | "missing" | "dismissed"
  sourceConnectionId: string | null
  externalId: string | null
  lockedFields: string[]
  editableFields: string[]
  provider?: string | null
  providerLabel?: string | null
}

export interface PlanningItem {
  id: string
  kind: PlanningItemKind
  title: string
  startsAt: Date | string | null
  endsAt: Date | string | null
  allDay: boolean
  subjectId: string | null
  management: PlanningManagement
  status?: PlanningTaskStatus | "scheduled" | "cancelled"
  scheduledAt?: Date | string | null
  dueAt?: Date | string | null
  assignedAt?: Date | string | null
  completedAt?: Date | string | null
  completed?: boolean
  instructions?: string | null
  description?: string | null
  notes?: string | null
  localNote?: string | null
  eventKind?: string | null
  timezone?: string | null
  location?: string | null
  seriesId?: string | null
  occurrenceId?: string | null
  occurrenceDate?: string | null
  virtual?: boolean
  cancelled?: boolean
  sortOrder?: number
  recordings?: Array<{ id: string; title: string }>
  recordingIds?: string[]
}

export interface PlanningCalendarPayload {
  timezone: string
  items: PlanningItem[]
}

export interface PlanningDayPayload extends PlanningCalendarPayload {
  date: string
  tasks?: PlanningItem[]
  assignments?: PlanningItem[]
  events?: PlanningItem[]
  lessons?: PlanningItem[]
  recordings?: PlanningItem[]
}

export interface PlanningRange {
  from: Date
  to: Date
}

const EMPTY_MANAGEMENT: PlanningManagement = {
  mode: "user",
  syncState: "detached",
  sourceConnectionId: null,
  externalId: null,
  lockedFields: [],
  editableFields: [],
}

export function normalizePlanningItems(
  payload: unknown,
  fallbackKind?: PlanningItemKind
): PlanningItem[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "items" in payload
      ? (payload as { items?: unknown }).items
      : []
  if (!Array.isArray(source)) return []

  return source.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return []
    const row = candidate as Partial<PlanningItem>
    if (typeof row.id !== "string" || typeof row.title !== "string") return []
    const kind = isPlanningItemKind(row.kind) ? row.kind : fallbackKind
    if (!kind) return []
    const management = normalizeManagement(row.management)
    return [
      {
        ...row,
        id: row.id,
        kind,
        title: row.title,
        startsAt:
          row.startsAt ??
          row.scheduledAt ??
          row.dueAt ??
          row.assignedAt ??
          null,
        endsAt: row.endsAt ?? null,
        allDay:
          row.allDay ??
          (kind === "assignment" || (kind === "task" && !row.scheduledAt)),
        subjectId: row.subjectId ?? null,
        management,
        cancelled: row.cancelled ?? row.status === "cancelled",
      } as PlanningItem,
    ]
  })
}

function normalizeManagement(value: unknown): PlanningManagement {
  if (!value || typeof value !== "object") return EMPTY_MANAGEMENT
  const management = value as Partial<PlanningManagement>
  const mode = management.mode === "provider" ? "provider" : "user"
  const syncState = ["managed", "detached", "missing", "dismissed"].includes(
    management.syncState ?? ""
  )
    ? (management.syncState as PlanningManagement["syncState"])
    : mode === "provider"
      ? "managed"
      : "detached"
  return {
    mode,
    syncState,
    sourceConnectionId: management.sourceConnectionId ?? null,
    externalId: management.externalId ?? null,
    lockedFields: Array.isArray(management.lockedFields)
      ? management.lockedFields.filter(
          (field): field is string => typeof field === "string"
        )
      : [],
    editableFields: Array.isArray(management.editableFields)
      ? management.editableFields.filter(
          (field): field is string => typeof field === "string"
        )
      : [],
    provider:
      typeof management.provider === "string" ? management.provider : null,
    providerLabel:
      typeof management.providerLabel === "string"
        ? management.providerLabel
        : null,
  }
}

function isPlanningItemKind(value: unknown): value is PlanningItemKind {
  return [
    "task",
    "assignment",
    "event",
    "lesson",
    "recording",
    "legacy",
  ].includes(String(value))
}

export function planningItemStart(item: PlanningItem): Date | null {
  return asValidDate(item.scheduledAt ?? item.startsAt ?? item.dueAt)
}

export function planningItemEnd(item: PlanningItem): Date | null {
  return asValidDate(item.endsAt) ?? planningItemStart(item)
}

export function asValidDate(
  value: Date | string | null | undefined
): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function planningRange(anchor: Date, view: PlanningView): PlanningRange {
  if (view === "month") {
    const monthStart = startOfMonth(anchor)
    const monthEnd = endOfMonth(anchor)
    return {
      from: startOfWeek(monthStart, { weekStartsOn: 1 }),
      to: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    }
  }
  if (view === "week") {
    return {
      from: startOfWeek(anchor, { weekStartsOn: 1 }),
      to: endOfWeek(anchor, { weekStartsOn: 1 }),
    }
  }
  const from = new Date(anchor)
  from.setHours(0, 0, 0, 0)
  const to = new Date(anchor)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

export function planningWeekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor, { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, index) => addDays(first, index))
}

export function itemsForDay(items: PlanningItem[], date: Date): PlanningItem[] {
  const key = dayKey(date)
  return items
    .filter((item) => {
      const start = planningItemStart(item)
      const end = planningItemEnd(item)
      if (!start || !end) return false
      return dayKey(start) <= key && dayKey(end) >= key
    })
    .sort(comparePlanningItems)
}

export function comparePlanningItems(a: PlanningItem, b: PlanningItem): number {
  const left = planningItemStart(a)?.getTime() ?? Number.MAX_SAFE_INTEGER
  const right = planningItemStart(b)?.getTime() ?? Number.MAX_SAFE_INTEGER
  return left - right || a.title.localeCompare(b.title)
}

export function groupAssignmentsByDueDay(items: PlanningItem[]): Array<{
  key: string
  date: Date | null
  items: PlanningItem[]
}> {
  const groups = new Map<string, PlanningItem[]>()
  for (const item of items.filter((item) => item.kind === "assignment")) {
    const due = asValidDate(item.dueAt)
    const key = due ? dayKey(due) : "unscheduled"
    const current = groups.get(key)
    if (current) current.push(item)
    else groups.set(key, [item])
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      date: key === "unscheduled" ? null : asValidDate(group[0]!.dueAt),
      items: [...group].sort(comparePlanningItems),
    }))
    .sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return a.date.getTime() - b.date.getTime()
    })
}

export function tasksByStatus(
  items: PlanningItem[]
): Record<PlanningTaskStatus, PlanningItem[]> {
  const lanes: Record<PlanningTaskStatus, PlanningItem[]> = {
    todo: [],
    doing: [],
    done: [],
  }
  for (const item of items) {
    if (item.kind !== "task") continue
    const status: PlanningTaskStatus =
      item.status === "doing" || item.status === "done" ? item.status : "todo"
    lanes[status].push(item)
  }
  for (const lane of Object.values(lanes)) {
    lane.sort(
      (a, b) =>
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || comparePlanningItems(a, b)
    )
  }
  return lanes
}

export function planningItemIsComplete(item: PlanningItem): boolean {
  return (
    item.status === "done" ||
    item.completed === true ||
    Boolean(item.completedAt)
  )
}

export function planningItemIsManaged(item: PlanningItem): boolean {
  return (
    item.management.mode === "provider" &&
    item.management.syncState === "managed"
  )
}

export function planningItemIsLocked(
  item: PlanningItem,
  field: string
): boolean {
  return (
    planningItemIsManaged(item) && item.management.lockedFields.includes(field)
  )
}

export function providerLabel(item: PlanningItem): string | null {
  if (!planningItemIsManaged(item)) return null
  const explicit =
    item.management.providerLabel?.trim() || item.management.provider?.trim()
  return explicit || null
}

export function recordingHrefForLesson(item: PlanningItem): string {
  const params = new URLSearchParams()
  params.set("title", item.title)
  if (item.subjectId) params.set("subjectId", item.subjectId)
  if (item.kind === "event") {
    params.set("eventId", item.id)
  } else if (item.virtual && item.seriesId && item.occurrenceDate) {
    params.set("seriesId", item.seriesId)
    params.set("occurrenceDate", item.occurrenceDate)
  } else {
    params.set("occurrenceId", item.occurrenceId ?? item.id)
  }
  const startsAt = planningItemStart(item)
  if (startsAt) params.set("startsAt", startsAt.toISOString())
  return `/materials/recordings/new?${params.toString()}`
}

export interface TimelinePlacement {
  item: PlanningItem
  topPercent: number
  heightPercent: number
  leftPercent: number
  widthPercent: number
}

export function timelinePlacements(
  items: PlanningItem[],
  startHour = 7,
  endHour = 21
): TimelinePlacement[] {
  const spanMinutes = Math.max(60, (endHour - startHour) * 60)
  const placements = items.flatMap((item) => {
    if (item.allDay) return []
    const start = planningItemStart(item)
    if (!start) return []
    const end = planningItemEnd(item) ?? start
    const startMinute = start.getHours() * 60 + start.getMinutes()
    const endMinute = Math.max(
      startMinute + 30,
      end.getHours() * 60 + end.getMinutes()
    )
    const visibleStart = Math.max(startHour * 60, startMinute)
    const visibleEnd = Math.min(endHour * 60, endMinute)
    if (visibleEnd <= visibleStart) return []
    return [
      {
        item,
        topPercent: ((visibleStart - startHour * 60) / spanMinutes) * 100,
        heightPercent: Math.max(
          2.5,
          ((visibleEnd - visibleStart) / spanMinutes) * 100
        ),
        leftPercent: 0,
        widthPercent: 100,
        visibleStart,
        visibleEnd,
      },
    ]
  })
  return placements.map(({ visibleStart, visibleEnd, ...placement }) => {
    const overlapping = placements
      .filter(
        (candidate) =>
          candidate.visibleStart < visibleEnd &&
          candidate.visibleEnd > visibleStart
      )
      .sort(
        (left, right) =>
          left.visibleStart - right.visibleStart ||
          left.visibleEnd - right.visibleEnd ||
          left.item.id.localeCompare(right.item.id)
      )
    const columnCount = overlapping.length
    const columnIndex = overlapping.findIndex(
      (candidate) =>
        candidate.item.id === placement.item.id &&
        candidate.item.kind === placement.item.kind
    )
    return {
      ...placement,
      leftPercent: (Math.max(0, columnIndex) / columnCount) * 100,
      widthPercent: 100 / columnCount,
    }
  })
}
