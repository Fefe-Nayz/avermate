export const REVIEW_KEY = "annual" as const

export function reviewStatusInput(yearId: string) {
  return { yearId, reviewKey: REVIEW_KEY }
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
