/**
 * First-render inputs shared by the admin social pages and their client
 * islands, so the server prefetch hydrates the exact key the client reads.
 */
export const INITIAL_ADMIN_SOCIAL_GROUPS_INPUT = {
  search: "",
  state: "all",
} as const

export const INITIAL_ADMIN_SOCIAL_REPORTS_INPUT = {
  status: "all",
} as const
