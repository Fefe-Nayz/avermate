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
  ModelUnavailableReason,
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
import { useExtracted } from "next-intl"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { AssistantThreadActionProvider } from "./actions/action-interactions"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
import { useMediaQuery } from "@/hooks/use-media-query"
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

function modelReadinessAction(reasons: readonly ModelUnavailableReason[]) {
  if (
    reasons.some((reason) =>
      ["node-offline", "node-capability-stale", "sandbox-unavailable"].includes(
        reason
      )
    )
  ) {
    return { href: "/settings/node", kind: "node" } as const
  }
  if (
    reasons.some((reason) =>
      ["managed-disabled", "quota-denied"].includes(reason)
    )
  ) {
    return {
      href: "/settings/managed",
      kind: "managed",
    } as const
  }
  return {
    href: "/settings/integrations",
    kind: "providers",
  } as const
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

function activeRun(detail: AssistantThreadDetail) {
  return [...detail.runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((run) =>
      [
        "reserved",
        "running",
        "waiting-for-user",
        "waiting-approval",
        "cancelling",
      ].includes(run.status)
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
  const t = useExtracted()
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
        aria-label={
          railOpen ? t("Hide conversations") : t("Show conversations")
        }
      >
        {railOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
      </Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium">{thread.title}</h2>
        <div
          className="flex items-center gap-1 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>
            {t("{count, plural, one {# message} other {# messages}}", {
              count: detail.messages.length,
            })}
          </span>
          {activeRun(detail) ? (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-primary">
                <LoaderCircleIcon className="size-3 animate-spin motion-reduce:animate-none" />{" "}
                {t("Running")}
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
            <ListTreeIcon /> <SelectValue placeholder={t("Branch")} />
          </SelectTrigger>
          <SelectContent>
            {detail.branches.map((branch, index) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name ??
                  t("Branch {number}", { number: String(index + 1) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("Inspect context and usage")}
        onClick={openContext}
      >
        <InfoIcon />
      </Button>
      <Link
        href="/assistant/actions"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={t("Open action activity")}
      >
        <ActivityIcon />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("Conversation actions")}
          render={<Button type="button" variant="ghost" size="icon-sm" />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("Conversation")}</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() =>
              void actions.updateThread(thread.id, {
                starred: !thread.starredAt,
              })
            }
          >
            <StarIcon /> {thread.starredAt ? t("Unstar") : t("Star")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void actions.updateThread(thread.id, {
                archived: !thread.archivedAt,
              })
            }
          >
            <ArchiveIcon />
            {thread.archivedAt ? t("Unarchive") : t("Archive")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DownloadIcon /> {t("Export")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onClick={() =>
                  void exportConversation("markdown", "active-branch")
                }
              >
                {t("Markdown · active branch")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void exportConversation("json", "active-branch")}
              >
                {t("JSON · active branch")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void exportConversation("json", "whole-dag")}
              >
                {t("JSON · whole conversation tree")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SaveIcon /> {t("Save to project")}
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
                    {t("Add conversation reference")}
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
                    {t("Create Markdown document")}
                  </DropdownMenuItem>,
                ])
              ) : (
                <DropdownMenuItem disabled>
                  {t("Create a study project first")}
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void actions.trashThread(thread.id)}
          >
            <Trash2Icon /> {t("Move to trash")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("Close assistant")}
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
  const t = useExtracted()
  return (
    <Sheet
      open={drawer.kind !== "closed"}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent side="right" className="w-[min(30rem,100vw)] sm:max-w-md">
        {drawer.kind === "citation" ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("Source")}</SheetTitle>
              <SheetDescription>
                {t("Exact evidence used for this claim.")}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              {drawer.loading ? (
                <div className="flex flex-col gap-3 pt-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : drawer.target ? (
                <div className="flex flex-col gap-4 pt-4">
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
                      <BookOpenIcon data-icon="inline-start" />
                      {t("Open exact source")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="pt-4 text-sm text-muted-foreground">
                  {t("This source is unavailable.")}
                </p>
              )}
            </ScrollArea>
          </>
        ) : drawer.kind === "context" ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("Run context")}</SheetTitle>
              <SheetDescription>
                {t("Committed manifests, model usage and durable run state.")}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              <div className="flex flex-col gap-5 pt-4">
                <section>
                  <h3 className="text-sm font-medium">{t("Runs")}</h3>
                  <div className="mt-2 flex flex-col gap-2">
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
                        <dl className="mt-2 grid gap-1 text-muted-foreground">
                          <div className="flex justify-between gap-2">
                            <dt>{t("Placement")}</dt>
                            <dd className="truncate font-mono">
                              {run.modelPlacement.kind}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Provider")}</dt>
                            <dd className="truncate font-mono">
                              {run.providerKey} · {run.providerRevision}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Policy")}</dt>
                            <dd className="truncate font-mono">
                              {run.policyRevision}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Tools")}</dt>
                            <dd className="truncate font-mono">
                              {run.toolCatalogRevision}
                            </dd>
                          </div>
                        </dl>
                        {run.terminalReason ? (
                          <p className="mt-2 text-destructive">
                            {run.terminalReason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-medium">
                    {t("Context manifests")}
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {detail.manifests.map((manifest) => (
                      <div
                        key={manifest.id}
                        className="rounded-lg border p-3 text-xs"
                      >
                        <div className="flex justify-between gap-2">
                          <span>
                            {t(
                              "{count, plural, one {# context item} other {# context items}}",
                              { count: manifest.items.length }
                            )}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {manifest.budget.usedTokens}/
                            {manifest.budget.maxTokens} {t("tokens")}
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
                  <h3 className="text-sm font-medium">{t("Usage")}</h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {detail.usage.map((usage) => (
                      <div
                        key={usage.runId}
                        className="flex flex-wrap gap-1.5 rounded-lg border p-3 text-xs"
                      >
                        <Badge variant="outline">
                          {usage.inputTokens ?? "—"} {t("input")}
                        </Badge>
                        <Badge variant="outline">
                          {usage.outputTokens ?? "—"} {t("output")}
                        </Badge>
                        <Badge variant="outline">
                          {usage.cachedReadTokens ?? "—"} {t("cached")}
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
  const t = useExtracted()
  const isOnline = useOnlineStatus()
  const { detail } = state
  const [references, setReferences] = useState<AssistantPendingReference[]>([])
  const [drawer, setDrawer] = useState<DrawerState>({ kind: "closed" })
  const [historicalChoice, setHistoricalChoice] =
    useState<HistoricalChoiceView | null>(null)
  const [historicalChoiceCoordinator] = useState(
    createHistoricalChoiceCoordinator
  )
  const currentRun = activeRun(detail)
  const selectedModel = state.models.find(
    (model) => model.modelKey === state.selectedModelKey
  )
  const composerPlacementLabel =
    detail.thread.placement.kind === "node"
      ? t("Custom Node · {node}", { node: detail.thread.placement.nodeId })
      : !selectedModel
        ? t("Avermate Core")
        : selectedModel.placement === "direct-byok"
          ? selectedModel.contentLeavesPlacement
            ? t("BYOK · {provider} receives selected context", {
                provider: selectedModel.providerKey,
              })
            : t("BYOK · {provider}", {
                provider: selectedModel.providerKey,
              })
          : selectedModel.placement === "managed"
            ? t("Avermate managed AI")
            : selectedModel.placement === "node"
              ? t("Custom Node model")
              : t("Avermate Core · {provider}", {
                  provider: selectedModel.providerKey,
                })
  const unavailableModels = state.modelReadiness.filter(
    (entry) => !entry.available && entry.unavailableReason
  )
  const unavailableReasons = [
    ...new Set(
      unavailableModels.flatMap((entry) =>
        entry.unavailableReason ? [entry.unavailableReason] : []
      )
    ),
  ]
  const readinessAction = modelReadinessAction(unavailableReasons)

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
        return Promise.reject(new Error(t("No source branch is selected")))
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
              : t("Historical branch options could not be loaded.")
          setHistoricalChoice((current) =>
            current?.token === token
              ? { ...current, error: message, loading: false }
              : current
          )
        })
      return promise
    },
    [actions, detail.activeBranchId, historicalChoiceCoordinator, t]
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
            {!isOnline ? (
              <Alert className="m-3 w-auto" role="status">
                <InfoIcon />
                <AlertTitle>{t("You are offline")}</AlertTitle>
                <AlertDescription>
                  {t(
                    "Conversation history remains readable. Sending, approvals and source fetches resume after reconnection."
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {state.models.length === 0 ? (
              <Alert
                className="m-3 w-auto"
                data-testid="assistant-model-unavailable"
              >
                <InfoIcon />
                <AlertTitle>{t("No model is ready")}</AlertTitle>
                <AlertDescription>
                  {t(
                    "Add a provider key, pair an Avermate Node or activate a managed placement. Existing conversations remain readable."
                  )}
                  {unavailableModels.length > 0 ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {unavailableModels.slice(0, 4).map((entry) => (
                        <Badge key={entry.routeKey} variant="outline">
                          {entry.capability.label} · {entry.unavailableReason}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </AlertDescription>
                <AlertAction>
                  <Link
                    href={readinessAction.href}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    {readinessAction.kind === "node"
                      ? t("Check Node")
                      : readinessAction.kind === "managed"
                        ? t("Check managed service")
                        : t("Configure providers")}
                  </Link>
                </AlertAction>
              </Alert>
            ) : null}
            <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col">
              <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto">
                <ThreadPrimitive.Empty>
                  <Empty className="min-h-full">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageSquarePlusIcon />
                      </EmptyMedia>
                      <EmptyTitle>{t("Start a study conversation")}</EmptyTitle>
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
                className="absolute right-4 bottom-36 z-10 rounded-full border bg-background p-2 shadow-md disabled:hidden"
              >
                <ChevronDownIcon className="size-4" />
              </ThreadPrimitive.ScrollToBottom>
              {!detail.thread.deletedAt &&
              state.models.length > 0 &&
              isOnline ? (
                <AssistantComposer
                  models={state.models}
                  skills={state.skills}
                  referenceOptions={state.referenceOptions}
                  selectedModelKey={state.selectedModelKey}
                  selectedSkillId={state.selectedSkillId}
                  planMode={state.planMode}
                  approvalMode={state.approvalMode}
                  references={references}
                  placementLabel={composerPlacementLabel}
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
              ) : detail.thread.deletedAt ? (
                <div className="border-t p-4 text-center text-sm text-muted-foreground">
                  {t(
                    "Restore this conversation before sending another message."
                  )}
                </div>
              ) : null}
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
  const t = useExtracted()
  const wideRailDefault = useMediaQuery("(min-width: 768px)")
  const [railPreference, setRailPreference] = useState<boolean | null>(null)
  const railOpen = railPreference ?? wideRailDefault
  const toggleRail = () =>
    setRailPreference((current) => !(current ?? wideRailDefault))
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
          aria-label={t("Close conversations")}
          className="absolute inset-0 z-20 bg-black/20 md:hidden"
          onClick={() => setRailPreference(false)}
        />
      ) : null}
      {state.detail ? (
        <ConversationPane
          key={state.detail.thread.id}
          state={{ ...state, detail: state.detail }}
          actions={actions}
          onClose={onClose}
          railOpen={railOpen}
          onToggleRail={toggleRail}
        />
      ) : state.loadingDetail ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 items-center gap-3 border-b px-4">
            <Skeleton className="size-8" /> <Skeleton className="h-4 w-44" />
          </div>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
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
              onClick={toggleRail}
            >
              <MenuIcon />
              <span className="sr-only">{t("Show conversations")}</span>
            </Button>
            {onClose ? (
              <Button
                className="ml-auto"
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
              >
                <XIcon />
                <span className="sr-only">{t("Close assistant")}</span>
              </Button>
            ) : null}
          </header>
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquarePlusIcon />
              </EmptyMedia>
              <EmptyTitle>{t("Your study assistant")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Open a previous conversation or start a new one. Your notes and files stay where the selected placement says they do."
                )}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => void actions.createThread()}>
                <MessageSquarePlusIcon data-icon="inline-start" />
                {t("New chat")}
              </Button>
            </EmptyContent>
          </Empty>
        </main>
      )}
    </div>
  )
}
