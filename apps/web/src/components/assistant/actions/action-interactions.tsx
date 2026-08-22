"use client"

import type {
  AgentActionBatchCompensationResult,
  AgentActionDto,
  AgentActionPreview,
} from "@avermate/agent-contracts"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { orpc, rpc } from "@/lib/orpc"
import { ActionApprovalDialog } from "./action-approval"
import type { ActionCardOperations } from "./action-card"
import { ActionInspectDialog } from "./action-inspect-dialog"
import { actionIsLive } from "./action-model"
import { ActionUndoDialog } from "./action-undo-dialog"

interface ActionInteractionValue {
  actionsById: ReadonlyMap<string, AgentActionDto>
  actionsByToolCallId: ReadonlyMap<string, AgentActionDto>
  operations: ActionCardOperations
}

const ActionInteractionContext = createContext<ActionInteractionValue | null>(
  null
)

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useAssistantToolAction(toolCallId: string | undefined) {
  const context = useContext(ActionInteractionContext)
  return {
    action: toolCallId
      ? (context?.actionsByToolCallId.get(toolCallId) ?? null)
      : null,
    operations: context?.operations ?? {},
  }
}

export function useActionInteractionOperations(): ActionCardOperations {
  return useContext(ActionInteractionContext)?.operations ?? {}
}

export function ActionInteractionProvider({
  actions,
  children,
  autoPromptApprovals = false,
  onRefresh,
}: {
  actions: readonly AgentActionDto[]
  children: ReactNode
  autoPromptApprovals?: boolean
  onRefresh?: () => Promise<unknown>
}) {
  const t = useExtracted()
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [dismissedApprovals, setDismissedApprovals] = useState<Set<string>>(
    () => new Set()
  )
  const [inspectActionId, setInspectActionId] = useState<string | null>(null)
  const [undoOpen, setUndoOpen] = useState(false)
  const [undoRequestedIds, setUndoRequestedIds] = useState<string[]>([])
  const [undoPreview, setUndoPreview] = useState<AgentActionPreview | null>(
    null
  )
  const [undoResult, setUndoResult] =
    useState<AgentActionBatchCompensationResult | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [executePending, setExecutePending] = useState(false)

  const actionsById = useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions]
  )
  const actionsByToolCallId = useMemo(
    () =>
      new Map(
        actions.flatMap((action) =>
          action.toolCallId ? [[action.toolCallId, action] as const] : []
        )
      ),
    [actions]
  )

  const inspectAction = inspectActionId
    ? (actionsById.get(inspectActionId) ?? null)
    : null
  const eventsQuery = useQuery({
    ...orpc.actions.activity.events.queryOptions({
      input: {
        actionId: inspectActionId ?? "action-not-selected",
        afterSequence: 0,
        limit: 250,
      },
    }),
    enabled: Boolean(inspectActionId) && isOnline,
  })

  const pendingApproval = actions.find(
    (action) =>
      action.status === "awaiting-approval" &&
      action.approval?.state === "pending"
  )
  const approvalDialogOpen = Boolean(
    autoPromptApprovals &&
    pendingApproval &&
    !dismissedApprovals.has(pendingApproval.id)
  )

  const refreshActions = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.actions.activity.key() }),
      onRefresh?.() ?? Promise.resolve(),
    ])
  }, [onRefresh, queryClient])

  const resolveApproval = useCallback(
    async (action: AgentActionDto, decision: "approve" | "reject") => {
      const approval = action.approval
      if (
        !approval ||
        approval.state !== "pending" ||
        pendingActionId ||
        !isOnline
      )
        return
      setPendingActionId(action.id)
      try {
        await rpc.actions.approvals.resolve({
          actionId: action.id,
          approvalId: approval.id,
          previewHash: approval.previewHash,
          decision,
        })
        await refreshActions()
        toast.success(
          decision === "approve"
            ? t(
                "Action approved. Execution resumed from the exact reservation."
              )
            : t("Action rejected. Nothing was executed.")
        )
      } catch (error) {
        await refreshActions().catch(() => undefined)
        toast.error(errorMessage(error, t("The action request failed.")))
      } finally {
        setPendingActionId(null)
      }
    },
    [isOnline, pendingActionId, refreshActions, t]
  )

  const requestUndo = useCallback(
    async (actionIds: readonly string[]) => {
      if (
        actionIds.length === 0 ||
        previewPending ||
        executePending ||
        !isOnline
      )
        return
      const requested = [...new Set(actionIds)]
      setUndoOpen(true)
      setUndoRequestedIds(requested)
      setUndoPreview(null)
      setUndoResult(null)
      setUndoError(null)
      setPreviewPending(true)
      setPendingActionId(requested[0] ?? null)
      try {
        const preview = await rpc.actions.undo.preview({ actionIds: requested })
        setUndoPreview(preview)
      } catch (error) {
        setUndoError(errorMessage(error, t("The action request failed.")))
      } finally {
        setPreviewPending(false)
        setPendingActionId(null)
      }
    },
    [executePending, isOnline, previewPending, t]
  )

  const executeUndo = useCallback(async () => {
    if (!undoPreview || executePending) return
    setExecutePending(true)
    setUndoError(null)
    try {
      const result = await rpc.actions.undo.execute({ preview: undoPreview })
      setUndoResult(result)
      await refreshActions()
      if (result.complete) {
        toast.success(t("Undo completed in safe dependency order."))
      } else if (result.partial) {
        toast.warning(
          t(
            "Undo was partial. Completed compensations were kept; unresolved actions need review."
          )
        )
      } else {
        toast.error(t("No selected action could be safely undone."))
      }
    } catch (error) {
      setUndoError(errorMessage(error, t("The action request failed.")))
      await refreshActions().catch(() => undefined)
    } finally {
      setExecutePending(false)
    }
  }, [executePending, refreshActions, t, undoPreview])

  const resolveConflictKeepCurrent = useCallback(
    async (action: AgentActionDto) => {
      if (pendingActionId || action.undoState !== "conflicted" || !isOnline)
        return
      setPendingActionId(action.id)
      try {
        await rpc.actions.undo.resolveConflict({
          actionId: action.id,
          resolution: "keep-current",
        })
        await refreshActions()
        setInspectActionId(null)
        toast.success(
          t("Conflict resolved. The current version was preserved.")
        )
      } catch (error) {
        toast.error(
          errorMessage(error, t("The conflict could not be resolved."))
        )
      } finally {
        setPendingActionId(null)
      }
    },
    [isOnline, pendingActionId, refreshActions, t]
  )

  const operations = useMemo<ActionCardOperations>(
    () => ({
      pendingActionId,
      disabled: !isOnline,
      onApprovalDecision: (action, decision) =>
        void resolveApproval(action, decision),
      onInspect: (action) => setInspectActionId(action.id),
      onRequestUndo: (actionIds) => void requestUndo(actionIds),
    }),
    [isOnline, pendingActionId, requestUndo, resolveApproval]
  )
  const context = useMemo<ActionInteractionValue>(
    () => ({ actionsById, actionsByToolCallId, operations }),
    [actionsById, actionsByToolCallId, operations]
  )

  return (
    <ActionInteractionContext.Provider value={context}>
      {children}
      <ActionApprovalDialog
        action={pendingApproval ?? null}
        open={approvalDialogOpen}
        pending={pendingActionId === pendingApproval?.id}
        onOpenChange={(open) => {
          if (!open && pendingApproval) {
            setDismissedApprovals((current) => {
              const next = new Set(current)
              next.add(pendingApproval.id)
              return next
            })
          }
        }}
        onDecision={(decision) => {
          if (pendingApproval) void resolveApproval(pendingApproval, decision)
        }}
      />
      <ActionUndoDialog
        open={undoOpen}
        requestedActionIds={undoRequestedIds}
        preview={undoPreview}
        result={undoResult}
        actions={actionsById}
        previewPending={previewPending}
        executePending={executePending}
        error={undoError}
        onOpenChange={setUndoOpen}
        onExecute={() => void executeUndo()}
        onRetryUnresolved={(actionIds) => void requestUndo(actionIds)}
      />
      <ActionInspectDialog
        action={inspectAction}
        open={Boolean(inspectAction)}
        events={eventsQuery.data?.events ?? []}
        loading={eventsQuery.isLoading}
        error={
          eventsQuery.error
            ? errorMessage(eventsQuery.error, t("The action request failed."))
            : null
        }
        resolvingConflict={pendingActionId === inspectAction?.id}
        onKeepCurrent={(action) => void resolveConflictKeepCurrent(action)}
        onOpenChange={(open) => !open && setInspectActionId(null)}
      />
    </ActionInteractionContext.Provider>
  )
}

export function AssistantThreadActionProvider({
  threadId,
  children,
}: {
  threadId: string
  children: ReactNode
}) {
  const isOnline = useOnlineStatus()
  const input = useMemo(() => ({ limit: 100, threadId }), [threadId])
  const query = useQuery({
    ...orpc.actions.activity.list.queryOptions({ input }),
    enabled: isOnline,
    refetchInterval: (current) =>
      current.state.data?.items.some(actionIsLive) ? 1_500 : false,
  })

  return (
    <ActionInteractionProvider
      actions={query.data?.items ?? []}
      autoPromptApprovals
      onRefresh={() => query.refetch()}
    >
      {children}
    </ActionInteractionProvider>
  )
}
