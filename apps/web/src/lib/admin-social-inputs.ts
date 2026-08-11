export const INITIAL_ADMIN_SOCIAL_GROUPS_INPUT = {
  state: "all" as const,
  type: "all" as const,
  search: "",
  limit: 50,
  offset: 0,
}

export const INITIAL_ADMIN_SOCIAL_REPORTS_INPUT = {
  statuses: [] as Array<"open" | "investigating" | "resolved" | "dismissed">,
  priorities: [] as Array<"low" | "normal" | "high" | "urgent">,
  search: "",
  limit: 50,
  offset: 0,
}

export const INITIAL_ADMIN_SOCIAL_AUDIT_INPUT = {
  action: "",
  entityType: "",
  limit: 100,
  offset: 0,
} as const
