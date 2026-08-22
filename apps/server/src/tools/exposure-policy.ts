/**
 * MCP names that have a reviewed first-party descriptor and must execute only
 * through ToolBroker. Keeping this list independent of router discovery makes
 * adding a `readOnlyHint` insufficient to expose a new agent capability.
 */
export const BROKERED_MCP_READ_TOOL_IDS = [
  "account.get",
  "actions.get",
  "actions.list",
  "actions.undo_preview",
  "analytics.snapshot",
  "announcements.active",
  "announcements.history",
  "artifact.get_manifest",
  "artifact.list",
  "artifact.workflow",
  "averages.get",
  "averages.list",
  "cards.list",
  "conversation.search",
  "documents.get",
  "documents.list",
  "feedback.mine",
  "goals.list",
  "grades.attachments",
  "grades.get",
  "grades.recent",
  "jobs.get",
  "learning.concepts.list",
  "learning.concepts.get",
  "learning.evidence.list",
  "learning.evidence.get",
  "learning.mastery.explain",
  "learning.mastery.get",
  "learning.mastery.list",
  "learning.plan.list",
  "materials.documents.get",
  "materials.documents.list",
  "materials.documents.transcript",
  "materials.folders.list",
  "periods.list",
  "planner.agenda",
  "planner.list",
  "preferences.get",
  "projects.get",
  "projects.list",
  "recap.eligible_years",
  "recap.status",
  "recordings.list",
  "recordings.transcript",
  "search.index_status",
  "search.query",
  "search.read_citation",
  "social.blocks",
  "social.friend",
  "social.friend_requests",
  "social.friends",
  "social.group",
  "social.groups",
  "social.notifications",
  "social.reports",
  "social.sharing",
  "source.ingestion_status",
  "subjects.delete_impact",
  "subjects.get",
  "subjects.list",
  "sync.status",
  "years.contents",
  "years.get",
  "years.list",
] as const;

export const brokeredMcpReadToolIds = new Set<string>(
  BROKERED_MCP_READ_TOOL_IDS,
);

export const BROKERED_MCP_MUTATION_TOOL_IDS = [
  "planning.tasks.create",
  "learning.copy.request_analysis",
  "learning.copy.review_analysis",
  "learning.evidence.decide",
  "learning.plan.propose",
  "learning.plan.apply",
  "learning.quiz.generate",
  "learning.quiz.start",
  "artifact.plan",
  "artifact.cancel",
  "artifact.retry_stage",
  "artifact.promote",
  "artifact.set_state",
] as const;

export const brokeredMcpMutationToolIds = new Set<string>(
  BROKERED_MCP_MUTATION_TOOL_IDS,
);

/**
 * Compatibility names kept discoverable while their old result contract is
 * intentionally unavailable to agents. `account.export` is an unbounded data
 * dump; `documents.downloadPptx` returns a signed URL instead of an opaque
 * handle. Neither is allowed to execute through the legacy callback.
 */
export const MCP_DISCOVERY_ONLY_TOOL_IDS = [
  "account.export",
  "documents.downloadPptx",
] as const;

export const mcpDiscoveryOnlyToolIds = new Set<string>(
  MCP_DISCOVERY_ONLY_TOOL_IDS,
);

export const MCP_BROKER_EXECUTION_META_KEY = "io.avermate/execution" as const;
export const MCP_BROKER_EXECUTION_META_VALUE = "tool-broker.v1" as const;
