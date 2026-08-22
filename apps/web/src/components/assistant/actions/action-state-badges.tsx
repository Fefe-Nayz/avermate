"use client"

import type { AgentActionDto } from "@avermate/agent-contracts"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { actionStatePresentation, undoStatePresentation } from "./action-model"

export function ActionStateBadges({ action }: { action: AgentActionDto }) {
  const t = useExtracted()
  const execution = actionStatePresentation(action)
  const undo = undoStatePresentation(action)
  const executionLabel =
    execution.state === "pending"
      ? action.status === "awaiting-approval"
        ? t("Pending approval")
        : t("Pending")
      : execution.state === "executing"
        ? t("Executing")
        : execution.state === "succeeded" || execution.state === "undone"
          ? t("Succeeded")
          : action.status === "rejected"
            ? t("Rejected")
            : action.status === "expired"
              ? t("Expired")
              : action.status === "inspect-required"
                ? t("Needs inspection")
                : t("Failed")
  const undoLabel =
    action.undoState === "not-applicable"
      ? t("No undo")
      : action.undoState === "ineligible"
        ? t("Not undoable")
        : action.undoState === "eligible"
          ? t("Undo available")
          : action.undoState === "approval-pending"
            ? t("Undo approval pending")
            : action.undoState === "in-progress"
              ? t("Undoing")
              : action.undoState === "compensated"
                ? t("Undone")
                : action.undoState === "partially-compensated"
                  ? t("Partially undone")
                  : action.undoState === "conflicted"
                    ? t("Undo conflict")
                    : action.undoState === "failed"
                      ? t("Compensation failed")
                      : t("Undo blocked")

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Badge
        variant={execution.variant}
        aria-label={t("Execution: {state}", { state: executionLabel })}
        data-action-state={execution.state}
      >
        {executionLabel}
      </Badge>
      <Badge
        variant={undo.variant}
        aria-label={t("Undo: {state}", { state: undoLabel })}
        data-undo-state={action.undoState}
      >
        {undoLabel}
      </Badge>
    </div>
  )
}
