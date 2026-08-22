import type { AgentActionDto } from "@avermate/agent-contracts"
import { Badge } from "@/components/ui/badge"
import { actionStatePresentation, undoStatePresentation } from "./action-model"

export function ActionStateBadges({ action }: { action: AgentActionDto }) {
  const execution = actionStatePresentation(action)
  const undo = undoStatePresentation(action)

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Badge
        variant={execution.variant}
        aria-label={`Execution: ${execution.label}`}
        data-action-state={execution.state}
      >
        {execution.label}
      </Badge>
      <Badge
        variant={undo.variant}
        aria-label={`Undo: ${undo.label}`}
        data-undo-state={action.undoState}
      >
        {undo.label}
      </Badge>
    </div>
  )
}
