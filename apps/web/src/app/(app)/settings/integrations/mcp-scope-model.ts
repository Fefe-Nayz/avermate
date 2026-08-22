export const MCP_SCOPE_GROUPS = [
  {
    id: "academic",
    scopes: [
      { scope: "avermate:read", required: true },
      { scope: "avermate:write", required: false },
      { scope: "avermate:delete", required: false },
      { scope: "avermate:admin", required: false },
    ],
  },
  {
    id: "social",
    scopes: [
      { scope: "avermate:social.read", required: false },
      { scope: "avermate:social.manage", required: false },
      { scope: "avermate:social.moderate", required: false },
    ],
  },
  {
    id: "planner",
    scopes: [
      { scope: "avermate:planner.read", required: false },
      { scope: "avermate:planner.write", required: false },
    ],
  },
  {
    id: "materials",
    scopes: [
      { scope: "avermate:materials.read", required: false },
      { scope: "avermate:materials.write", required: false },
    ],
  },
  {
    id: "documents",
    scopes: [
      { scope: "avermate:documents.read", required: false },
      { scope: "avermate:documents.write", required: false },
    ],
  },
] as const

export type McpScopeGroup = (typeof MCP_SCOPE_GROUPS)[number]["id"]
export type McpScope =
  (typeof MCP_SCOPE_GROUPS)[number]["scopes"][number]["scope"]

export const MCP_SCOPE_OPTIONS = [
  ...MCP_SCOPE_GROUPS[0].scopes,
  ...MCP_SCOPE_GROUPS[1].scopes,
  ...MCP_SCOPE_GROUPS[2].scopes,
  ...MCP_SCOPE_GROUPS[3].scopes,
  ...MCP_SCOPE_GROUPS[4].scopes,
] as const
