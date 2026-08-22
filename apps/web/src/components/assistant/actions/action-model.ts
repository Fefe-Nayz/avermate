import type {
  AgentActionBatchCompensationResult,
  AgentActionDto,
  AgentActionPreview,
  AgentActionResource,
} from "@avermate/agent-contracts"

export type ActionUiState =
  | "pending"
  | "executing"
  | "succeeded"
  | "failed"
  | "undone"
  | "compensation_failed"

export type ActionBadgeVariant =
  "default" | "secondary" | "destructive" | "outline"

export interface ActionStatePresentation {
  state: ActionUiState
  label: string
  variant: ActionBadgeVariant
}

export interface UndoStatePresentation {
  label: string
  variant: ActionBadgeVariant
  attention: boolean
}

const TOOL_TITLES: Readonly<Record<string, string>> = {
  "planning.tasks.create": "Create a personal task",
  "artifact.plan": "Plan an artifact workflow",
  "artifact.cancel": "Cancel an artifact workflow",
  "artifact.retry_stage": "Retry an artifact stage",
  "artifact.promote": "Promote an artifact revision",
  "artifact.set_state": "Change artifact state",
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  "active-compensation": "A compensation action is still running.",
  "already-compensated": "This action was already undone.",
  "compensation-failed":
    "The compensating action failed. The original action remains in history.",
  "no-compensator": "This action has no reviewed compensating operation.",
  "not-eligible": "This action is not eligible for undo.",
  "resource-missing": "The affected resource no longer exists.",
  "resource-revision-changed":
    "The resource changed after this action. Undo will not overwrite later work.",
  "uncompensated-dependant":
    "A dependent action must be undone first or repaired independently.",
}

function humanize(value: string): string {
  const words = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : value
}

export function actionTitle(action: Pick<AgentActionDto, "toolId">): string {
  if (TOOL_TITLES[action.toolId]) return TOOL_TITLES[action.toolId]
  return action.toolId.split(".").map(humanize).join(" · ")
}

export function actionUiState(action: AgentActionDto): ActionUiState {
  if (action.status === "completed" && action.undoState === "compensated") {
    return "undone"
  }
  if (action.status === "completed" && action.undoState === "failed") {
    return "compensation_failed"
  }

  switch (action.status) {
    case "reserved":
    case "awaiting-approval":
      return "pending"
    case "executing":
      return "executing"
    case "completed":
      return "succeeded"
    case "rejected":
    case "expired":
    case "failed":
    case "inspect-required":
      return "failed"
  }
}

export function actionStatePresentation(
  action: AgentActionDto
): ActionStatePresentation {
  const state = actionUiState(action)
  if (state === "undone") {
    return { state, label: "Succeeded", variant: "secondary" }
  }
  if (state === "compensation_failed") {
    return { state, label: "Succeeded", variant: "secondary" }
  }
  if (state === "pending") {
    return {
      state,
      label:
        action.status === "awaiting-approval" ? "Pending approval" : "Pending",
      variant: "outline",
    }
  }
  if (state === "executing") {
    return { state, label: "Executing", variant: "secondary" }
  }
  if (state === "succeeded") {
    return { state, label: "Succeeded", variant: "secondary" }
  }
  const label =
    action.status === "rejected"
      ? "Rejected"
      : action.status === "expired"
        ? "Expired"
        : action.status === "inspect-required"
          ? "Needs inspection"
          : "Failed"
  return { state, label, variant: "destructive" }
}

export function undoStatePresentation(
  action: AgentActionDto
): UndoStatePresentation {
  switch (action.undoState) {
    case "not-applicable":
      return { label: "No undo", variant: "outline", attention: false }
    case "ineligible":
      return { label: "Not undoable", variant: "outline", attention: false }
    case "eligible":
      return { label: "Undo available", variant: "default", attention: false }
    case "approval-pending":
      return {
        label: "Undo approval pending",
        variant: "secondary",
        attention: false,
      }
    case "in-progress":
      return { label: "Undoing", variant: "secondary", attention: false }
    case "compensated":
      return { label: "Undone", variant: "secondary", attention: false }
    case "partially-compensated":
      return {
        label: "Partially undone",
        variant: "destructive",
        attention: true,
      }
    case "conflicted":
      return { label: "Undo conflict", variant: "destructive", attention: true }
    case "failed":
      return {
        label: "Compensation failed",
        variant: "destructive",
        attention: true,
      }
    case "blocked":
      return { label: "Undo blocked", variant: "destructive", attention: true }
  }
}

export function actionReason(action: AgentActionDto): string | null {
  if (action.undoReasonCode) {
    return reasonCodeLabel(action.undoReasonCode)
  }
  if (action.safeError) return action.safeError
  if (action.status === "inspect-required") {
    return "The server cannot prove whether the external effect happened. Inspect it before retrying."
  }
  if (action.undoState === "partially-compensated") {
    return "Only part of this action was undone. Completed compensation remains recorded; unresolved work needs review."
  }
  return null
}

export function reasonCodeLabel(reasonCode: string | null): string {
  if (!reasonCode) return "No additional reason was recorded."
  return REASON_LABELS[reasonCode] ?? humanize(reasonCode)
}

export function actionActorLabel(
  actorKind: AgentActionDto["actorKind"]
): string {
  switch (actorKind) {
    case "embedded-agent":
      return "Avermate assistant"
    case "mcp":
      return "MCP client"
    case "user-undo":
      return "User undo"
    case "system":
      return "Avermate system"
  }
}

export function actionConsequence(action: AgentActionDto): string | null {
  if (!action.preview || typeof action.preview !== "object") return null
  const preview = action.preview as Record<string, unknown>
  for (const field of ["consequence", "title", "summary", "description"]) {
    if (typeof preview[field] === "string" && preview[field].trim()) {
      return preview[field].trim()
    }
  }
  return null
}

export function resourceLabel(resource: AgentActionResource): string {
  return `${humanize(resource.operation)} ${humanize(resource.resourceKind)}`
}

export function resourceHref(resource: AgentActionResource): string | null {
  const id = encodeURIComponent(resource.resourceId)
  switch (resource.resourceKind) {
    case "planning-task":
      return `/planning/tasks/${id}/edit`
    case "project":
    case "study-project":
      return `/projects/${id}`
    case "grade":
    case "personal-grade":
      return `/grades/${id}`
    case "document":
    case "study-document":
      return `/materials/fiches/${id}`
    case "recording":
      return `/materials/recordings/${id}`
    case "generated-artifact":
      return `/materials?artifact=${id}`
    default:
      return null
  }
}

export function actionCanRequestUndo(action: AgentActionDto): boolean {
  return [
    "eligible",
    "conflicted",
    "failed",
    "in-progress",
    "blocked",
  ].includes(action.undoState)
}

export function actionIsLive(action: AgentActionDto): boolean {
  return (
    ["reserved", "awaiting-approval", "executing"].includes(action.status) ||
    ["approval-pending", "in-progress"].includes(action.undoState)
  )
}

export interface ApprovalExpiryState {
  expired: boolean
  remainingSeconds: number
  label: string
}

export function approvalExpiryState(
  expiresAt: string,
  now: Date = new Date()
): ApprovalExpiryState {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1_000)
  )
  if (remainingSeconds === 0) {
    return { expired: true, remainingSeconds, label: "Approval expired" }
  }
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60
  return {
    expired: false,
    remainingSeconds,
    label:
      minutes > 0
        ? `Expires in ${minutes}m ${seconds.toString().padStart(2, "0")}s`
        : `Expires in ${seconds}s`,
  }
}

export interface UndoPreviewSummary {
  requestedCount: number
  totalCount: number
  expandedDependencyCount: number
  eligibleCount: number
  conflictedCount: number
  blockedCount: number
  nonUndoableCount: number
  canExecute: boolean
  partialExpected: boolean
}

export function summarizeUndoPreview(
  preview: AgentActionPreview,
  requestedActionIds: readonly string[]
): UndoPreviewSummary {
  const requested = new Set(requestedActionIds)
  const expandedDependencyCount = preview.actionIds.filter(
    (actionId) => !requested.has(actionId)
  ).length
  const unresolvedCount =
    preview.conflicted.length +
    preview.blocked.length +
    preview.nonUndoable.length
  return {
    requestedCount: requested.size,
    totalCount: preview.actionIds.length,
    expandedDependencyCount,
    eligibleCount: preview.eligible.length,
    conflictedCount: preview.conflicted.length,
    blockedCount: preview.blocked.length,
    nonUndoableCount: preview.nonUndoable.length,
    canExecute: preview.eligible.length > 0,
    partialExpected: unresolvedCount > 0,
  }
}

export interface CompensationResultSummary {
  kind: "complete" | "partial" | "failed"
  compensatedCount: number
  conflictedCount: number
  failedCount: number
  blockedCount: number
  notAttemptedCount: number
  unresolvedActionIds: string[]
}

export function summarizeCompensationResult(
  result: AgentActionBatchCompensationResult
): CompensationResultSummary {
  const count = (
    state: AgentActionBatchCompensationResult["outcomes"][number]["state"]
  ) => result.outcomes.filter((outcome) => outcome.state === state).length
  const compensatedCount = count("compensated")
  return {
    kind: result.complete
      ? "complete"
      : result.partial || compensatedCount > 0
        ? "partial"
        : "failed",
    compensatedCount,
    conflictedCount: count("conflicted"),
    failedCount: count("failed"),
    blockedCount: count("blocked"),
    notAttemptedCount: count("not-attempted"),
    unresolvedActionIds: result.outcomes
      .filter((outcome) => outcome.state !== "compensated")
      .map((outcome) => outcome.sourceActionId),
  }
}

export function trimActionJson(value: unknown, limit = 12_000): string {
  let output: string
  try {
    output = JSON.stringify(value, null, 2)
  } catch {
    output = "[unserializable]"
  }
  return output.length > limit ? `${output.slice(0, limit)}\n…` : output
}
