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
import {
  ActivityIcon,
  ArchiveIcon,
  BookOpenIcon,
  ChevronDownIcon,
  DownloadIcon,
  InfoIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SaveIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AssistantThreadActionProvider } from "./actions/action-interactions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { AssistantComposer } from "./assistant-composer"
import {
  AssistantEditComposer,
  AssistantMessageActionsProvider,
  AssistantModelMessage,
  AssistantSystemMessage,
  AssistantUserMessage,
} from "./assistant-message"
import {
  createAvermateAssistantRuntimeAdapter,
  type AssistantRuntimeActions,
} from "./assistant-runtime-adapter"
import { AssistantThreadRail } from "./assistant-thread-rail"
import { HistoricalBranchDialog } from "./historical-branch-dialog"
import type {
  AssistantCitationTarget,
  AssistantPendingReference,
  AssistantProjectOption,
  AssistantThreadDetail,
  AssistantWorkspaceActions,
  AssistantWorkspaceState,
} from "./assistant-types"

type DrawerState =
  | { kind: "closed" }
  | {
      kind: "citation"
      loading: boolean
      target: AssistantCitationTarget | null
    }
  | { kind: "context" }

type HistoricalChoiceView = {
  token: string
  operation: HistoricalBranchOperation
  sourceBranchId: string
  preview: HistoricalBranchPreview | null
  loading: boolean
  error: string | null
}

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

function downloadExport(result: {
  fileName: string
  mimeType: string
  content: string
}) {
  const url = URL.createObjectURL(
    new Blob([result.content], { type: result.mimeType })
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = result.fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function placementLabel(
  detail: AssistantThreadDetail,
  model: AssistantWorkspaceState["models"][number] | undefined
): string {
  const placement = detail.thread.placement
  if (placement.kind === "node") return `Custom node · ${placement.nodeId}`
  if (!model) return "Avermate core"
  if (model.placement === "direct-byok") {
    return model.contentLeavesPlacement
      ? `BYOK · ${model.providerKey} receives selected context`
      : `BYOK · ${model.providerKey}`
  }
  if (model.placement === "managed") return "Avermate managed AI"
  if (model.placement === "node") return "Custom node model"
  return `Avermate core · ${model.providerKey}`
}

function activeRun(detail: AssistantThreadDetail) {
  return [...detail.runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((run) =>
      ["reserved", "running", "waiting-for-user"].includes(run.status)
    )
}

function ConversationHeader({
  detail,
  railOpen,
  onToggleRail,
  onClose,
  actions,
  projects,
  openContext,
}: {
  detail: AssistantThreadDetail
  railOpen: boolean
  onToggleRail: () => void
  onClose?: () => void
  actions: AssistantWorkspaceActions
  projects: readonly AssistantProjectOption[]
  openContext: () => void
}) {
  const thread = detail.thread
  const exportConversation = async (
    format: "json" | "markdown",
    mode: "active-branch" | "whole-dag"
  ) => downloadExport(await actions.exportThread(thread.id, format, mode))

  return (
    <header className="flex min-h-14 items-center gap-2 border-b px-2 md:px-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onToggleRail}
        aria-label={railOpen ? "Hide conversations" : "Show conversations"}
      >
        {railOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
      </Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium">{thread.title}</h2>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{detail.messages.length} messages</span>
          {activeRun(detail) ? (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-primary">
                <LoaderCircleIcon className="size-3 animate-spin" /> Running
              </span>
            </>
          ) : null}
        </div>
      </div>
      {detail.branches.length > 1 ? (
        <Select
          value={detail.activeBranchId ?? undefined}
          onValueChange={(value) => {
            const branch = detail.branches.find(
              (candidate) => candidate.id === value
            )
            if (branch) actions.switchBranch(branch)
          }}
        >
          <SelectTrigger size="sm" className="hidden max-w-40 md:flex">
            <ListTreeIcon /> <SelectValue placeholder="Branch" />
          </SelectTrigger>
          <SelectContent>
            {detail.branches.map((branch, index) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name ?? `Branch ${index + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Inspect context and usage"
        onClick={openContext}
      >
        <InfoIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open action activity"
        render={<Link href="/assistant/actions" />}
        nativeButton={false}
      >
        <ActivityIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Conversation actions"
          render={<Button type="button" variant="ghost" size="icon-sm" />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Conversation</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() =>
              void actions.updateThread(thread.id, {
                starred: !thread.starredAt,
              })
            }
          >
            <StarIcon /> {thread.starredAt ? "Unstar" : "Star"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void actions.updateThread(thread.id, {
                archived: !thread.archivedAt,
              })
            }
          >
            <ArchiveIcon /> {thread.archivedAt ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DownloadIcon /> Export
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onClick={() =>
                  void exportConversation("markdown", "active-branch")
                }
              >
                Markdown · active branch
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void exportConversation("json", "active-branch")}
              >
                JSON · active branch
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void exportConversation("json", "whole-dag")}
              >
                JSON · whole DAG
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SaveIcon /> Save to project
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {projects.length ? (
                projects.flatMap((project) => [
                  <DropdownMenuLabel key={`${project.id}-label`}>
                    {project.emoji ? `${project.emoji} ` : ""}
                    {project.title}
                  </DropdownMenuLabel>,
                  <DropdownMenuItem
                    key={`${project.id}-reference`}
                    onClick={() =>
                      void actions.saveToProject(
                        thread.id,
                        project.id,
                        "reference"
                      )
                    }
                  >
                    Add conversation reference
                  </DropdownMenuItem>,
                  <DropdownMenuItem
                    key={`${project.id}-markdown`}
                    onClick={() =>
                      void actions.saveToProject(
                        thread.id,
                        project.id,
                        "markdown"
                      )
                    }
                  >
                    Create Markdown document
                  </DropdownMenuItem>,
                ])
              ) : (
                <DropdownMenuItem disabled>
                  Create a study project first
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void actions.trashThread(thread.id)}
          >
            <Trash2Icon /> Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close assistant"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      ) : null}
    </header>
  )
}

function AssistantDrawer({
  drawer,
  detail,
  onClose,
}: {
  drawer: DrawerState
  detail: AssistantThreadDetail
  onClose: () => void
}) {
  return (
    <Sheet
      open={drawer.kind !== "closed"}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent side="right" className="w-[min(30rem,100vw)] sm:max-w-md">
        {drawer.kind === "citation" ? (
          <>
            <SheetHeader>
              <SheetTitle>Source</SheetTitle>
              <SheetDescription>
                Exact evidence used for this claim.
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              {drawer.loading ? (
                <div className="space-y-3 pt-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : drawer.target ? (
                <div className="space-y-4 pt-4">
                  <div>
                    <h3 className="font-medium">{drawer.target.title}</h3>
                    {drawer.target.subtitle ? (
                      <p className="text-sm text-muted-foreground">
                        {drawer.target.subtitle}
                      </p>
                    ) : null}
                  </div>
                  {drawer.target.locatorLabel ? (
                    <Badge variant="outline">
                      {drawer.target.locatorLabel}
                    </Badge>
                  ) : null}
                  {drawer.target.excerpt ? (
                    <blockquote className="border-l-2 pl-4 text-sm leading-relaxed">
                      {drawer.target.excerpt}
                    </blockquote>
                  ) : null}
                  {drawer.target.href ? (
                    <Button
                      render={
                        <a
                          href={drawer.target.href}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      <BookOpenIcon data-icon="inline-start" /> Open exact
                      source
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="pt-4 text-sm text-muted-foreground">
                  This source is unavailable.
                </p>
              )}
            </ScrollArea>
          </>
        ) : drawer.kind === "context" ? (
          <>
            <SheetHeader>
              <SheetTitle>Run context</SheetTitle>
              <SheetDescription>
                Committed manifests, model usage and durable run state.
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              <div className="space-y-5 pt-4">
                <section>
                  <h3 className="text-sm font-medium">Runs</h3>
                  <div className="mt-2 space-y-2">
                    {[...detail.runs].reverse().map((run) => (
                      <div
                        key={run.id}
                        className="rounded-lg border p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono">{run.modelKey}</span>
                          <Badge variant="outline">{run.status}</Badge>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {run.runtimeId} {run.runtimeVersion}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-medium">Context manifests</h3>
                  <div className="mt-2 space-y-2">
                    {detail.manifests.map((manifest) => (
                      <div
                        key={manifest.id}
                        className="rounded-lg border p-3 text-xs"
                      >
                        <div className="flex justify-between gap-2">
                          <span>{manifest.items.length} context items</span>
                          <span className="text-muted-foreground tabular-nums">
                            {manifest.budget.usedTokens}/
                            {manifest.budget.maxTokens} tokens
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-muted-foreground">
                          {manifest.digest}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-medium">Usage</h3>
                  <div className="mt-2 space-y-2">
                    {detail.usage.map((usage) => (
                      <div
                        key={usage.runId}
                        className="flex flex-wrap gap-1.5 rounded-lg border p-3 text-xs"
                      >
                        <Badge variant="outline">
                          {usage.inputTokens ?? "—"} input
                        </Badge>
                        <Badge variant="outline">
                          {usage.outputTokens ?? "—"} output
                        </Badge>
                        <Badge variant="outline">
                          {usage.cachedReadTokens ?? "—"} cached
                        </Badge>
                        {usage.estimatedCost ? (
                          <Badge variant="secondary">
                            {usage.estimatedCost} {usage.currency}
                          </Badge>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ConversationPane({
  state,
  actions,
  onClose,
  railOpen,
  onToggleRail,
}: {
  state: AssistantWorkspaceState & { detail: AssistantThreadDetail }
  actions: AssistantWorkspaceActions
  onClose?: () => void
  railOpen: boolean
  onToggleRail: () => void
}) {
  const { detail } = state
  const [references, setReferences] = useState<AssistantPendingReference[]>([])
  const [drawer, setDrawer] = useState<DrawerState>({ kind: "closed" })
  const [historicalChoice, setHistoricalChoice] =
    useState<HistoricalChoiceView | null>(null)
  const [historicalChoiceCoordinator] = useState(
    createHistoricalChoiceCoordinator
  )
  const currentRun = activeRun(detail)

  const finishHistoricalChoice = useCallback(
    (token: string, choice: HistoricalBranchChoice | null) => {
      historicalChoiceCoordinator.resolve(token, choice)
      setHistoricalChoice(null)
    },
    [historicalChoiceCoordinator]
  )

  useEffect(
    () => () => {
      historicalChoiceCoordinator.resolve(null, null)
    },
    [historicalChoiceCoordinator]
  )

  const requestHistoricalChoice = useCallback(
    (
      operation: HistoricalBranchOperation,
      messageId: string
    ): Promise<HistoricalBranchChoice | null> => {
      if (!detail.activeBranchId) {
        return Promise.reject(new Error("No source branch is selected"))
      }
      const token = crypto.randomUUID()
      const promise = historicalChoiceCoordinator.request(token)
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
              : "Historical branch options could not be loaded."
          setHistoricalChoice((current) =>
            current?.token === token
              ? { ...current, error: message, loading: false }
              : current
          )
        })
      return promise
    },
    [actions, detail.activeBranchId, historicalChoiceCoordinator]
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
        if (!run) throw new Error("No run is waiting for an answer")
        await actions.answerQuestion(run.id, questionId, answer)
      },
    }),
    [actions, detail, openCitation]
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
              actions={actions}
              projects={state.projects}
              openContext={() => setDrawer({ kind: "context" })}
            />
            {state.error ? (
              <div
                role="alert"
                className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
              >
                {state.error}
              </div>
            ) : null}
            <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col">
              <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
                <ThreadPrimitive.Empty>
                  <Empty className="min-h-full">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageSquarePlusIcon />
                      </EmptyMedia>
                      <EmptyTitle>Start a study conversation</EmptyTitle>
                      <EmptyDescription>
                        Attach a course, grade, document, image, or simply ask a
                        question.
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
                aria-label="Scroll to latest message"
                className="absolute right-4 bottom-36 z-10 rounded-full border bg-background p-2 shadow-md disabled:hidden"
              >
                <ChevronDownIcon className="size-4" />
              </ThreadPrimitive.ScrollToBottom>
              {!detail.thread.deletedAt ? (
                <AssistantComposer
                  models={state.models}
                  skills={state.skills}
                  referenceOptions={state.referenceOptions}
                  selectedModelKey={state.selectedModelKey}
                  selectedSkillId={state.selectedSkillId}
                  planMode={state.planMode}
                  references={references}
                  placementLabel={placementLabel(
                    detail,
                    state.models.find(
                      (model) => model.modelKey === state.selectedModelKey
                    )
                  )}
                  actions={actions}
                  onAddReference={(reference) =>
                    setReferences((current) =>
                      current.some(
                        (item) => item.clientId === reference.clientId
                      )
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
              ) : (
                <div className="border-t p-4 text-center text-sm text-muted-foreground">
                  Restore this conversation before sending another message.
                </div>
              )}
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

export function AssistantWorkspace({
  state,
  actions,
  onClose,
  className,
  compactRail = false,
}: {
  state: AssistantWorkspaceState
  actions: AssistantWorkspaceActions
  onClose?: () => void
  className?: string
  compactRail?: boolean
}) {
  const [railOpen, setRailOpen] = useState(true)
  const selectedThreadId = state.detail?.thread.id ?? null

  return (
    <div
      className={cn(
        "relative flex min-h-0 overflow-hidden bg-background",
        className
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-30 flex shadow-xl transition-transform md:static md:z-auto md:shadow-none",
          railOpen ? "translate-x-0" : "-translate-x-full md:hidden"
        )}
      >
        <AssistantThreadRail
          threads={state.threads}
          selectedThreadId={selectedThreadId}
          searchQuery={state.searchQuery}
          loading={state.loadingThreads}
          actions={actions}
          compact={compactRail}
        />
      </div>
      {railOpen ? (
        <button
          type="button"
          aria-label="Close conversations"
          className="absolute inset-0 z-20 bg-black/20 md:hidden"
          onClick={() => setRailOpen(false)}
        />
      ) : null}
      {state.detail ? (
        <ConversationPane
          key={state.detail.thread.id}
          state={{ ...state, detail: state.detail }}
          actions={actions}
          onClose={onClose}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((current) => !current)}
        />
      ) : state.loadingDetail ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 items-center gap-3 border-b px-4">
            <Skeleton className="size-8" /> <Skeleton className="h-4 w-44" />
          </div>
          <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
            <Skeleton className="ml-auto h-20 w-2/3 rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        </div>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center border-b px-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setRailOpen((current) => !current)}
            >
              <MenuIcon /> <span className="sr-only">Show conversations</span>
            </Button>
            {onClose ? (
              <Button
                className="ml-auto"
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
              >
                <XIcon /> <span className="sr-only">Close assistant</span>
              </Button>
            ) : null}
          </header>
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquarePlusIcon />
              </EmptyMedia>
              <EmptyTitle>Your study assistant</EmptyTitle>
              <EmptyDescription>
                Open a previous conversation or start a new one. Your notes and
                files stay where the selected placement says they do.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => void actions.createThread()}>
                <MessageSquarePlusIcon data-icon="inline-start" /> New chat
              </Button>
            </EmptyContent>
          </Empty>
        </main>
      )}
    </div>
  )
}
