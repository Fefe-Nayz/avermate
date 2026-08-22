import type {
  AgentActionActivityFilter,
  AgentActionActorKind,
  AgentActionStatus,
  AgentActionUndoState,
} from "@avermate/agent-contracts"

export const ALL_FILTER_VALUE = "all" as const

export interface ActionActivityFilterDraft {
  fromDate: string
  toDate: string
  toolId: string
  threadId: string
  resourceKind: string
  resourceId: string
  actorKind: AgentActionActorKind | typeof ALL_FILTER_VALUE
  status: AgentActionStatus | typeof ALL_FILTER_VALUE
  undoState: AgentActionUndoState | typeof ALL_FILTER_VALUE
}

export const EMPTY_ACTION_ACTIVITY_FILTER: ActionActivityFilterDraft = {
  fromDate: "",
  toDate: "",
  toolId: "",
  threadId: "",
  resourceKind: "",
  resourceId: "",
  actorKind: ALL_FILTER_VALUE,
  status: ALL_FILTER_VALUE,
  undoState: ALL_FILTER_VALUE,
}

function localDayBoundary(value: string, end: boolean): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    end ? 23 : 0,
    end ? 59 : 0,
    end ? 59 : 0,
    end ? 999 : 0
  )
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function clean(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function buildActionActivityFilter(
  draft: ActionActivityFilterDraft,
  cursor?: number
): AgentActionActivityFilter {
  return {
    limit: 50,
    ...(cursor ? { cursor } : {}),
    ...(localDayBoundary(draft.fromDate, false)
      ? { from: localDayBoundary(draft.fromDate, false) }
      : {}),
    ...(localDayBoundary(draft.toDate, true)
      ? { to: localDayBoundary(draft.toDate, true) }
      : {}),
    ...(clean(draft.toolId) ? { toolId: clean(draft.toolId) } : {}),
    ...(clean(draft.threadId) ? { threadId: clean(draft.threadId) } : {}),
    ...(clean(draft.resourceKind)
      ? { resourceKind: clean(draft.resourceKind) }
      : {}),
    ...(clean(draft.resourceId) ? { resourceId: clean(draft.resourceId) } : {}),
    ...(draft.actorKind !== ALL_FILTER_VALUE
      ? { actorKind: draft.actorKind }
      : {}),
    ...(draft.status !== ALL_FILTER_VALUE ? { status: draft.status } : {}),
    ...(draft.undoState !== ALL_FILTER_VALUE
      ? { undoState: draft.undoState }
      : {}),
  }
}

export function actionActivityFilterCount(
  draft: ActionActivityFilterDraft
): number {
  return Object.entries(draft).filter(
    ([key, value]) =>
      value !== "" &&
      !(
        ["actorKind", "status", "undoState"].includes(key) &&
        value === ALL_FILTER_VALUE
      )
  ).length
}
