import { tz } from "@date-fns/tz"
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"

export const REVIEW_KEY = "annual" as const

/**
 * The bounded read window shared by the agenda server page and its client.
 * Keeping this in one factory is what lets TanStack hydrate the exact key the
 * browser reads instead of immediately repeating the request.
 */
export function agendaMonthInput(yearId: string, month: Date) {
  return {
    yearId,
    from: startOfMonth(month),
    to: endOfMonth(month),
  }
}

export type PlanningRangeView = "month" | "week" | "day"

/** Query factories shared by every Planning server/client hydration boundary. */
export function planningCalendarInput(
  yearId: string,
  anchor: Date,
  view: PlanningRangeView,
  timezone = "UTC"
) {
  const context = { in: tz(timezone) }
  const range =
    view === "month"
      ? {
          from: startOfWeek(startOfMonth(anchor, context), {
            ...context,
            weekStartsOn: 1,
          }),
          to: endOfWeek(endOfMonth(anchor, context), {
            ...context,
            weekStartsOn: 1,
          }),
        }
      : view === "week"
        ? {
            from: startOfWeek(anchor, { ...context, weekStartsOn: 1 }),
            to: endOfWeek(anchor, { ...context, weekStartsOn: 1 }),
          }
        : {
            from: startOfDay(anchor, context),
            to: endOfDay(anchor, context),
          }
  return {
    yearId,
    from: new Date(range.from.getTime()),
    to: new Date(range.to.getTime()),
    timezone,
  }
}

export function planningDayInput(
  yearId: string,
  date: string,
  timezone = "UTC"
) {
  return { yearId, date, timezone }
}

export function planningAssignmentsInput(yearId: string) {
  return { yearId }
}

export function planningTasksInput(yearId: string) {
  return { yearId, includeCompleted: true }
}

export function reviewStatusInput(yearId: string) {
  return { yearId, reviewKey: REVIEW_KEY }
}

/** The exact year-scoped keys shared by the materials server page and client. */
/**
 * Live rows or deleted ones.
 *
 * The bin is the same four lists read with one flag flipped, and because the
 * flag is part of the input it is part of the query key: the trash and the
 * browser cache separately and neither can serve the other stale rows.
 */
export type MaterialsInclude = "live" | "trashed"

export function materialsFoldersInput(
  yearId: string,
  include: MaterialsInclude = "live"
) {
  return { yearId, include }
}

export function materialsDocumentsInput(
  yearId: string,
  include: MaterialsInclude = "live"
) {
  return { yearId, include }
}

/** Study documents share the materials tree but keep their own cache family. */
export function studyDocumentsInput(
  yearId: string,
  include: MaterialsInclude = "live"
) {
  return { yearId, include }
}

export function materialTagsInput(yearId: string) {
  return { yearId }
}

export function studyDocumentInput(documentId: string) {
  return { documentId }
}

/** Lecture recordings use a dedicated cache family inside Materials. */
export function lectureRecordingsInput(
  yearId: string,
  include: MaterialsInclude = "live"
) {
  return { yearId, include }
}

export function lectureRecordingInput(recordingId: string) {
  return { recordingId }
}

export function gradeAttachmentsInput(gradeId: string) {
  return { gradeId }
}

/** Exact year-scoped key shared by the integrations server page and client. */
export function syncConnectionsInput(yearId: string) {
  return { yearId }
}

export function syncStatusInput(connectionId: string) {
  return { connectionId }
}

export type AdminOverviewRange = 30 | 90 | 180 | 365 | "all"
export const INITIAL_ADMIN_OVERVIEW_RANGE: AdminOverviewRange = 30

export function adminOverviewInput(days: AdminOverviewRange) {
  return { days }
}

export const ADMIN_OVERVIEW_INPUT = adminOverviewInput(
  INITIAL_ADMIN_OVERVIEW_RANGE
)

export const ADMIN_USERS_PAGE_SIZE = 20

export function adminUsersInput(
  query: string,
  offset = 0,
  limit = ADMIN_USERS_PAGE_SIZE
) {
  return { query, limit, offset }
}

export type AdminFeedbackStatus = "open" | "closed" | "all"
export const INITIAL_ADMIN_FEEDBACK_STATUS: AdminFeedbackStatus = "open"

export function adminFeedbackInput(status: AdminFeedbackStatus, offset = 0) {
  return { status, limit: 50, offset }
}
