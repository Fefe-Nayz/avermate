export type FeedbackStatus =
  | "open"
  | "triaged"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "closed"
  | "rejected"
export type FeedbackPriority = "low" | "normal" | "high" | "urgent"
export type FeedbackSource =
  "all" | "form" | "auto:web" | "auto:mobile" | "auto:server"
export type FeedbackAssigneeFilter = "all" | "unassigned" | "mine"

export interface AdminFeedbackFilters {
  status: FeedbackStatus | "all"
  priority: FeedbackPriority | "all"
  source: FeedbackSource
  assignee: FeedbackAssigneeFilter
  label: string
  search: string
  offset: number
}

export const INITIAL_ADMIN_FEEDBACK_FILTERS: AdminFeedbackFilters = {
  status: "open",
  priority: "all",
  source: "all",
  assignee: "all",
  label: "",
  search: "",
  offset: 0,
}

export function adminFeedbackQueueInput(filters: AdminFeedbackFilters) {
  return {
    statuses: filters.status === "all" ? [] : [filters.status],
    priorities: filters.priority === "all" ? [] : [filters.priority],
    kinds: [],
    source: filters.source,
    assignee: filters.assignee,
    label: filters.label.trim() || null,
    search: filters.search.trim(),
    limit: 50,
    offset: filters.offset,
  }
}
