export const REVIEW_KEY = "annual" as const

export function reviewStatusInput(yearId: string) {
  return { yearId, reviewKey: REVIEW_KEY }
}

export const ADMIN_OVERVIEW_INPUT = { days: 30 } as const

export function adminUsersInput(query: string) {
  return { query, limit: 50, offset: 0 }
}

export type AdminFeedbackStatus = "open" | "closed" | "all"
export const INITIAL_ADMIN_FEEDBACK_STATUS: AdminFeedbackStatus = "open"

export function adminFeedbackInput(status: AdminFeedbackStatus) {
  return { status, limit: 50 }
}
