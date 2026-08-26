"use client"

import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react"
import type {
  HistoricalBranchChoice,
  HistoricalBranchOperation,
  HistoricalBranchPreview,
} from "@avermate/agent-contracts"
import { ChevronDownIcon, InfoIcon, MessageSquarePlusIcon } from "lucide-react"
import Link from "next/link"
import { useExtracted } from "next-intl"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useOnlineStatus } from "@/hooks/use-online-status"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { AssistantThreadActionProvider } from "./actions/action-interactions"
import { AssistantComposer } from "./assistant-composer"
import { ConversationHeader } from "./assistant-conversation-header"
import { AssistantDrawer, type DrawerState } from "./assistant-drawer"
import {
  AssistantEditComposer,
  AssistantMessageActionsProvider,
  AssistantModelMessage,
  AssistantSystemMessage,
  AssistantUserMessage,
} from "./assistant-message"
import {
  paneStatus,
  readinessDestination,
  type PaneNotice,
} from "./assistant-pane-status"
import { placementOf } from "./assistant-placement"
import {
  createAvermateAssistantRuntimeAdapter,
  type AssistantRuntimeActions,
} from "./assistant-runtime-adapter"
import { activeRun } from "./assistant-thread-model"
import { HistoricalBranchDialog } from "./historical-branch-dialog"
import type {
  AssistantPendingReference,
  AssistantThreadDetail,
  AssistantWorkspaceActions,
  AssistantWorkspaceState,
} from "./assistant-types"

type HistoricalChoiceView = {
  token: string
  operation: HistoricalBranchOperation
  sourceBranchId: string
  preview: HistoricalBranchPreview | null
  loading: boolean
  error: string | null
}

/**
 * A dialog that has to be answered before an action continues, driven from an
 * async callback rather than from a click. The callback awaits a promise this
 * holds open; the dialog resolves it. A second request supersedes the first
 * rather than queueing, because a reader who asks twice meant the second one.
 */
function createHistoricalChoiceCoordinator() {
  let pending: {
    token: string
    resolve: (choice: HistoricalBranchChoice | null) => void
  } | null = null

  return {
    request(token: string): Promise<HistoricalBranchChoice | null> {
      pending?.resolve(null)
      return new Promise((resolve) => {
        pending = { token, resolve }
      })
    },
    resolve(token: string | null, choice: HistoricalBranchChoice | null) {
      if (!pending || (token !== null && pending.token !== token)) return
      const current = pending
      pending = null
      current.resolve(choice)
    },
  }
}

/**
 * The single strip above the conversation.
 *
 * One notice, never a stack — see `assistant-pane-status` for why, and for the
 * order. Everything here is a statement about the conversation as a whole; a
 * failure that belongs to the message you are writing belongs in the composer.
 */
function ConversationNotice({
  notice,
  unavailableCount,
}: {
  notice: PaneNotice
  unavailableCount: number
}) {
  const t = useExtracted()

  if (notice.kind === "error") {
    return (
      <div
        role="alert"
        className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
      >
        {notice.message}
      </div>
    )
  }

  if (notice.kind === "deleted") {
    return (
      <div
        role="status"
        className="border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
      >
        {t("This conversation is in the trash. Restore it to reply.")}
      </div>
    )
  }

  if (notice.kind === "offline") {
    return (
      <div
        role="status"
        className="border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
      >
        {t(
          "You are offline. Everything here stays readable, and sending resumes when you reconnect."
        )}
      </div>
    )
  }

  const destination = readinessDestination(notice.reasons)
  return (
    <Alert className="m-3 w-auto" data-testid="assistant-model-unavailable">
      <InfoIcon />
      <AlertTitle>{t("No model is ready")}</AlertTitle>
      <AlertDescription>
        {t(
          "Add a provider key, pair an Avermate Node or activate a managed placement. Existing conversations remain readable."
        )}
        {unavailableCount > 0 ? (
          <span className="mt-1 block text-xs">
            {t("{count} models are configured but not reachable.", {
              count: String(unavailableCount),
            })}
          </span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Link
          href={destination.href}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {destination.kind === "node"
            ? t("Check Node")
            : destination.kind === "managed"
              ? t("Check managed service")
              : t("Configure providers")}
        </Link>
      </AlertAction>
    </Alert>
  )
}

/**
 * One conversation: what was said, and the box you say the next thing in.
 *
 * Three rules hold this layout together, and each replaces something that was
 * here before. The pane says **one** thing at a time above the messages rather
 * than stacking three alerts down the screen. The composer is **always
 * mounted**, disabled with a reason, because unmounting it threw away whatever
 * the reader had typed. And the scroll-to-bottom button is anchored to the
 * messages rather than to the pane, so it cannot slide behind a composer that
 * grew.
 */
export function ConversationPane({
  state,
  actions,
  onClose,
  expandHref,
  railOpen,
  onToggleRail,
}: {
  state: AssistantWorkspaceState & { detail: AssistantThreadDetail }
  actions: AssistantWorkspaceActions
  onClose?: () => void
  expandHref?: string
  railOpen: boolean
  onToggleRail: () => void
}) {
  const t = useExtracted()
  const online = useOnlineStatus()
  const { detail } = state
  const [references, setReferences] = useState<AssistantPendingReference[]>([])
  const [drawer, setDrawer] = useState<DrawerState>({ kind: "closed" })
  const [historicalChoice, setHistoricalChoice] =
    useState<HistoricalChoiceView | null>(null)
  const [coordinator] = useState(createHistoricalChoiceCoordinator)

  const currentRun = activeRun(detail)
  const selectedModel = state.models.find(
    (model) => model.modelKey === state.selectedModelKey
  )
  const unavailable = state.modelReadiness.filter(
    (entry) => !entry.available && entry.unavailableReason
  )
  /**
   * Where this runs, in words. The rule lives in `assistant-placement`; the
   * sentences live here, because the extractor only sees `t("…")` at a site
   * where `t` came from `useExtracted()`.
   */
  const placement = placementOf(detail, selectedModel)
  const placementLabel =
    placement.kind === "node"
      ? t("Runs on your own Node")
      : placement.kind === "avermate"
        ? t("Handled by Avermate")
        : placement.kind === "avermate-via"
          ? t("Handled by Avermate, through {provider}", {
              provider: placement.provider,
            })
          : placement.withAttachedContext
            ? t("Sent straight to {provider}, with the context you attach", {
                provider: placement.provider,
              })
            : t("Sent straight to {provider}", { provider: placement.provider })

  const status = paneStatus({
    deleted: detail.thread.deletedAt !== null,
    modelCount: state.models.length,
    online,
    error: state.error ?? null,
    unavailable,
  })

  /**
   * Why the composer is closed, in the words of the thing blocking it. `null`
   * when nothing is: the composer reads this as "you may write".
   */
  const blockedReason = status.canSend
    ? null
    : detail.thread.deletedAt !== null
      ? t("Restore this conversation before sending another message.")
      : state.models.length === 0
        ? t("Choose a model before sending.")
        : // The strip above already said they are offline; repeating it here
          // is the same sin the strip was built to stop. This adds the part
          // that belongs to the composer and nothing else.
          t("Your draft is kept until you reconnect.")

  const finishHistoricalChoice = useCallback(
    (token: string, choice: HistoricalBranchChoice | null) => {
      coordinator.resolve(token, choice)
      setHistoricalChoice(null)
    },
    [coordinator]
  )

  useEffect(
    () => () => {
      coordinator.resolve(null, null)
    },
    [coordinator]
  )

  const requestHistoricalChoice = useCallback(
    (
      operation: HistoricalBranchOperation,
      messageId: string
    ): Promise<HistoricalBranchChoice | null> => {
      if (!detail.activeBranchId) {
        return Promise.reject(new Error(t("No source branch is selected")))
      }
      const token = crypto.randomUUID()
      const promise = coordinator.request(token)
      setHistoricalChoice({
        token,
        operation,
        sourceBranchId: detail.activeBranchId,
        preview: null,
        loading: true,
        error: null,
      })
      void actions
        .previewHistoricalBranch({
          messageId,
          sourceBranchId: detail.activeBranchId,
          operation,
        })
        .then((preview) => {
          setHistoricalChoice((current) =>
            current?.token === token
              ? { ...current, preview, loading: false }
              : current
          )
        })
        .catch((previewError: unknown) => {
          const message =
            previewError instanceof Error && previewError.message
              ? previewError.message
              : t("Historical branch options could not be loaded.")
          setHistoricalChoice((current) =>
            current?.token === token
              ? { ...current, error: message, loading: false }
              : current
          )
        })
      return promise
    },
    [actions, coordinator, detail.activeBranchId, t]
  )

  const runtimeActions = useMemo<AssistantRuntimeActions>(
    () => ({
      send: async (intent) => {
        await actions.send({
          ...intent,
          modelKey: state.selectedModelKey,
          skillId: state.selectedSkillId,
          planMode: state.planMode,
          references,
        })
        setReferences([])
      },
      edit: async (intent) => {
        const historicalBranch = await requestHistoricalChoice(
          "edit",
          intent.sourceMessageId
        )
        if (!historicalBranch) return
        await actions.edit({
          ...intent,
          modelKey: state.selectedModelKey,
          skillId: state.selectedSkillId,
          planMode: state.planMode,
          references,
          historicalBranch,
        })
        setReferences([])
      },
      retry: async (messageId) => {
        const historicalBranch = await requestHistoricalChoice(
          "retry",
          messageId
        )
        if (!historicalBranch) return
        await actions.retry({
          messageId,
          modelKey: state.selectedModelKey,
          skillId: state.selectedSkillId,
          planMode: state.planMode,
          historicalBranch,
        })
      },
      cancel: async () => {
        if (currentRun) await actions.cancel(currentRun.id)
      },
      refetch: actions.refetch,
      switchBranch: (headMessageId) => {
        const branch = detail.branches.find(
          (candidate) => candidate.headMessageId === headMessageId
        )
        if (branch) actions.switchBranch(branch)
      },
    }),
    [
      actions,
      currentRun,
      detail.branches,
      references,
      requestHistoricalChoice,
      state.planMode,
      state.selectedModelKey,
      state.selectedSkillId,
    ]
  )

  const adapter = useMemo(
    () =>
      createAvermateAssistantRuntimeAdapter({
        snapshot: detail,
        actions: runtimeActions,
      }),
    [detail, runtimeActions]
  )
  const runtime = useExternalStoreRuntime(adapter)

  const openCitation = useCallback(
    async (citationId: string) => {
      setDrawer({ kind: "citation", loading: true, target: null })
      try {
        const target = await actions.openCitation(citationId)
        setDrawer({ kind: "citation", loading: false, target })
      } catch {
        setDrawer({ kind: "citation", loading: false, target: null })
      }
    },
    [actions]
  )

  const messageActions = useMemo(
    () => ({
      openCitation: (citationId: string) => void openCitation(citationId),
      openArtifact: actions.openArtifact,
      answerQuestion: async (questionId: string, answer: string) => {
        const run = activeRun(detail)
        if (!run) throw new Error(t("No run is waiting for an answer"))
        await actions.answerQuestion(run.id, questionId, answer)
      },
    }),
    [actions, detail, openCitation, t]
  )

  return (
    <AssistantThreadActionProvider threadId={detail.thread.id}>
      <AssistantRuntimeProvider runtime={runtime}>
        <AssistantMessageActionsProvider actions={messageActions}>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <ConversationHeader
              detail={detail}
              railOpen={railOpen}
              onToggleRail={onToggleRail}
              onClose={onClose}
              expandHref={expandHref}
              actions={actions}
              projects={state.projects}
              openContext={() => setDrawer({ kind: "context" })}
              approvalMode={state.approvalMode}
              placementLabel={placementLabel}
            />
            {status.notice ? (
              <ConversationNotice
                notice={status.notice}
                unavailableCount={unavailable.length}
              />
            ) : null}
            <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
              <div className="relative flex min-h-0 flex-1 flex-col">
                <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto">
                  <ThreadPrimitive.Empty>
                    <Empty className="min-h-full">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <MessageSquarePlusIcon />
                        </EmptyMedia>
                        <EmptyTitle>
                          {t("Start a study conversation")}
                        </EmptyTitle>
                        <EmptyDescription>
                          {t(
                            "Attach a course, grade, document or image, or simply ask a question."
                          )}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </ThreadPrimitive.Empty>
                  <ThreadPrimitive.Messages
                    components={{
                      UserMessage: AssistantUserMessage,
                      AssistantMessage: AssistantModelMessage,
                      SystemMessage: AssistantSystemMessage,
                      EditComposer: AssistantEditComposer,
                    }}
                  />
                  <div className="h-2" />
                </ThreadPrimitive.Viewport>
                <ThreadPrimitive.ScrollToBottom
                  aria-label={t("Scroll to latest message")}
                  className="absolute right-4 bottom-4 z-10 rounded-full border bg-background p-2 shadow-md disabled:hidden"
                >
                  <ChevronDownIcon className="size-4" />
                </ThreadPrimitive.ScrollToBottom>
              </div>
              <AssistantComposer
                models={state.models}
                skills={state.skills}
                referenceOptions={state.referenceOptions}
                selectedModelKey={state.selectedModelKey}
                selectedSkillId={state.selectedSkillId}
                planMode={state.planMode}
                references={references}
                actions={actions}
                blockedReason={blockedReason}
                onAddReference={(reference) =>
                  setReferences((current) =>
                    current.some((item) => item.clientId === reference.clientId)
                      ? current
                      : [...current, reference]
                  )
                }
                onRemoveReference={(clientId) =>
                  setReferences((current) =>
                    current.filter((item) => item.clientId !== clientId)
                  )
                }
              />
            </ThreadPrimitive.Root>
          </section>
          <AssistantDrawer
            drawer={drawer}
            detail={detail}
            onClose={() => setDrawer({ kind: "closed" })}
          />
          <HistoricalBranchDialog
            open={historicalChoice !== null}
            operation={historicalChoice?.operation ?? null}
            sourceBranchId={historicalChoice?.sourceBranchId ?? null}
            preview={historicalChoice?.preview ?? null}
            loading={historicalChoice?.loading ?? false}
            error={historicalChoice?.error ?? null}
            onCancel={() => {
              if (historicalChoice) {
                finishHistoricalChoice(historicalChoice.token, null)
              }
            }}
            onChoose={(choice) => {
              if (historicalChoice) {
                finishHistoricalChoice(historicalChoice.token, choice)
              }
            }}
          />
        </AssistantMessageActionsProvider>
      </AssistantRuntimeProvider>
    </AssistantThreadActionProvider>
  )
}
