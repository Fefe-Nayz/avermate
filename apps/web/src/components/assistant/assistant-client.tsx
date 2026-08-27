"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AgentApprovalMode } from "@avermate/agent-contracts"
import { useRouter, useSearchParams } from "next/navigation"
import { useExtracted } from "next-intl"
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import { useMaybeYear } from "@/components/year/year-provider"
import {
  citationOpenHref,
  locatorLabel,
} from "@/components/projects/project-model"
import { uploadBrowserFile } from "@/lib/file-upload"
import { env } from "@/lib/env"
import { orpc, rpc } from "@/lib/orpc"
import { activeRun } from "./assistant-thread-model"
import { resolveProjectScopedThreadSelection } from "./assistant-project-scope"
import { AssistantWorkspace } from "./assistant-workspace"
import {
  findBranchContainingMessage,
  messageElement,
  parseConversationCitationTarget,
} from "./assistant-citation-navigation"
import { connectAssistantRunEvents } from "./assistant-event-client"
import { applyAssistantEvent } from "./assistant-event-projection"
import type {
  AssistantPendingReference,
  AssistantReferenceOption,
  AssistantThreadDetail,
  AssistantThreadSummary,
  AssistantWorkspaceActions,
  AssistantWorkspaceState,
} from "./assistant-types"

function randomRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function reference(
  kind: AssistantReferenceOption["kind"],
  referenceId: string,
  label: string,
  description?: string | null
): AssistantReferenceOption {
  return {
    clientId: `${kind}:${referenceId}`,
    kind,
    referenceId,
    label,
    description,
    searchText: `${kind} ${label} ${description ?? ""}`,
  }
}

function citationHref(
  target:
    | Parameters<typeof citationOpenHref>[0]
    | {
        kind: "conversation"
        resourceId: string
        locator: Parameters<typeof citationOpenHref>[0]["locator"]
      }
): string {
  return citationOpenHref(target)
}

export function AssistantWorkspaceClient({
  onClose,
  expandHref,
  pane,
  paneTitle,
  paneCloseHref,
  className,
  compactRail = false,
  projectId,
}: {
  onClose?: () => void
  expandHref?: string
  pane?: ReactNode
  paneTitle?: string
  paneCloseHref?: string
  className?: string
  compactRail?: boolean
  /** Restrict the rail to one project and bind every new thread to it. */
  projectId?: string
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const year = useMaybeYear()
  const [searchQuery, setSearchQuery] = useState("")
  const deferredSearch = useDeferredValue(searchQuery.trim())
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() =>
    searchParams.get("thread")
  )
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [selectedModelKey, setSelectedModelKey] = useState("")
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [planMode, setPlanMode] = useState(false)
  const [approvalMode, setApprovalMode] =
    useState<AgentApprovalMode>("read-only")
  const [error, setError] = useState<string | null>(null)
  const focusedCitationRef = useRef<string | null>(null)

  const conversationCitation = useMemo(
    () =>
      parseConversationCitationTarget(
        searchParams.get("locator"),
        searchParams.get("thread")
      ),
    [searchParams]
  )

  const threadListInput = {
    ...(projectId ? { projectId } : {}),
    limit: 100,
    includeArchived: true,
    includeDeleted: true,
    starredOnly: false,
  }
  const threadsQuery = useQuery(
    deferredSearch
      ? orpc.assistant.threads.search.queryOptions({
          input: { ...threadListInput, query: deferredSearch },
        })
      : orpc.assistant.threads.list.queryOptions({ input: threadListInput })
  )
  // Search results are only a presentation subset. Keep the unsearched,
  // project-filtered list as the authority that validates a selected thread.
  // With no search both observers share one TanStack query and one request.
  const projectThreadScopeQuery = useQuery({
    ...orpc.assistant.threads.list.queryOptions({ input: threadListInput }),
    enabled: Boolean(projectId),
  })
  const threads = useMemo<AssistantThreadSummary[]>(
    () =>
      (threadsQuery.data?.items ?? []).map((item) => ({
        ...item.thread,
        preview: item.matchedMessagePreview,
        lastMessageAt: item.lastMessageAt,
        running: item.activeRunId !== null,
      })),
    [threadsQuery.data]
  )
  const projectThreadIds = useMemo(
    () =>
      (projectThreadScopeQuery.data?.items ?? []).map((item) => item.thread.id),
    [projectThreadScopeQuery.data]
  )
  const threadSelection = resolveProjectScopedThreadSelection({
    projectId,
    selectedThreadId,
    projectThreadIds,
    projectScopeReady: projectThreadScopeQuery.isSuccess,
    fallbackThreadId: threads[0]?.id ?? null,
  })
  const effectiveThreadId = threadSelection.effectiveThreadId

  useEffect(() => {
    if (!threadSelection.resetSelection) return
    const resetFrame = window.requestAnimationFrame(() => {
      setSelectedThreadId(null)
      setSelectedBranchId(null)
    })
    return () => window.cancelAnimationFrame(resetFrame)
  }, [threadSelection.resetSelection])

  const previousProjectIdRef = useRef(projectId)
  useEffect(() => {
    if (previousProjectIdRef.current === projectId) return
    previousProjectIdRef.current = projectId
    const resetFrame = window.requestAnimationFrame(() => {
      setSelectedBranchId(null)
    })
    return () => window.cancelAnimationFrame(resetFrame)
  }, [projectId])

  const detailInput = useMemo(
    () =>
      effectiveThreadId
        ? {
            threadId: effectiveThreadId,
            branchId: selectedBranchId ?? undefined,
          }
        : null,
    [effectiveThreadId, selectedBranchId]
  )
  const detailQuery = useQuery({
    ...orpc.assistant.threads.get.queryOptions({
      input: detailInput ?? { threadId: "assistant-not-selected" },
    }),
    enabled: detailInput !== null,
  })
  const modelsQuery = useQuery(orpc.assistant.models.list.queryOptions())
  const modelCatalogueQuery = useQuery(
    orpc.assistant.models.catalogue.queryOptions()
  )
  const modelPreferenceQuery = useQuery(
    orpc.assistant.models.preference.get.queryOptions()
  )
  const skillsQuery = useQuery(orpc.assistant.skills.list.queryOptions())
  const projectsQuery = useQuery(
    orpc.projects.list.queryOptions({ input: { include: "live" } })
  )
  const materialsQuery = useQuery({
    ...orpc.materials.documents.list.queryOptions({
      input: { yearId: year?.yearId ?? "", include: "live" },
    }),
    enabled: Boolean(year?.yearId),
  })
  const studyDocumentsQuery = useQuery({
    ...orpc.documents.list.queryOptions({
      input: { yearId: year?.yearId ?? "", include: "live" },
    }),
    enabled: Boolean(year?.yearId),
  })
  const recordingsQuery = useQuery({
    ...orpc.recordings.list.queryOptions({
      input: { yearId: year?.yearId ?? "", include: "live" },
    }),
    enabled: Boolean(year?.yearId),
  })

  const detail = (detailQuery.data ?? null) as AssistantThreadDetail | null
  const detailRef = useRef(detail)
  useEffect(() => {
    detailRef.current = detail
  }, [detail])

  useEffect(() => {
    if (
      !conversationCitation ||
      !detail ||
      detail.thread.id !== conversationCitation.threadId
    ) {
      return
    }

    if (!detail.activePathMessageIds.includes(conversationCitation.messageId)) {
      const containingBranchId = findBranchContainingMessage(
        detail.branches,
        detail.messages,
        conversationCitation.messageId
      )
      if (containingBranchId && containingBranchId !== selectedBranchId) {
        // Citation navigation is a read-only projection choice. It must not
        // mutate the thread's canonical active branch.
        const branchFrame = window.requestAnimationFrame(() => {
          setSelectedBranchId(containingBranchId)
        })
        return () => window.cancelAnimationFrame(branchFrame)
      }
      return
    }

    const focusKey = `${conversationCitation.threadId}:${conversationCitation.messageId}:${conversationCitation.partId}:${conversationCitation.startOffset ?? ""}:${conversationCitation.endOffset ?? ""}`
    if (focusedCitationRef.current === focusKey) return

    let frame = 0
    let attempts = 0
    let highlightTimer = 0
    const focusMessage = () => {
      const element = messageElement(conversationCitation.messageId)
      if (!element && attempts < 10) {
        attempts += 1
        frame = window.requestAnimationFrame(focusMessage)
        return
      }
      if (!element) return

      focusedCitationRef.current = focusKey
      element.dataset.citationTarget = "true"
      element.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      })
      highlightTimer = window.setTimeout(() => {
        delete element.dataset.citationTarget
      }, 3_000)
    }
    frame = window.requestAnimationFrame(focusMessage)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(highlightTimer)
    }
  }, [conversationCitation, detail, selectedBranchId])
  const models = useMemo(
    () => modelsQuery.data?.items ?? [],
    [modelsQuery.data]
  )
  const preferredModelKey = modelPreferenceQuery.data?.defaultModelKey ?? ""
  const effectiveModelKey = models.some(
    (model) => model.modelKey === selectedModelKey
  )
    ? selectedModelKey
    : models.some((model) => model.modelKey === preferredModelKey)
      ? preferredModelKey
      : (models[0]?.modelKey ?? "")
  const skills = useMemo(
    () =>
      (skillsQuery.data?.items ?? []).map((skill) => ({
        id: skill.id,
        label: skill.label,
        description: skill.description,
        enabled: true,
      })),
    [skillsQuery.data]
  )
  const projects = useMemo(
    () =>
      (projectsQuery.data ?? []).map((project) => ({
        id: project.id,
        title: project.title,
        emoji: project.emoji,
      })),
    [projectsQuery.data]
  )

  const referenceOptions = useMemo<AssistantReferenceOption[]>(() => {
    const options: AssistantReferenceOption[] = []
    for (const item of year?.years ?? []) {
      options.push(reference("year", item.id, item.name, t("Academic year")))
    }
    for (const subject of year?.subjects ?? []) {
      options.push(reference("subject", subject.id, subject.name, t("Subject")))
      for (const grade of subject.grades) {
        options.push(reference("grade", grade.id, grade.name, subject.name))
      }
    }
    for (const item of materialsQuery.data ?? []) {
      options.push(
        reference(
          "material",
          item.document.id,
          item.document.title,
          item.file?.mimeType ?? item.document.sourceType
        )
      )
    }
    for (const document of studyDocumentsQuery.data ?? []) {
      options.push(
        reference("document", document.id, document.title, document.kind)
      )
    }
    for (const recording of recordingsQuery.data ?? []) {
      options.push(
        reference(
          "transcript",
          recording.id,
          recording.title,
          t("Course recording · {status}", { status: recording.status })
        )
      )
    }
    for (const project of projects) {
      options.push(
        reference("project", project.id, project.title, t("Project"))
      )
    }
    return options.sort(
      (left, right) =>
        left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        }) || left.clientId.localeCompare(right.clientId)
    )
  }, [
    materialsQuery.data,
    projects,
    recordingsQuery.data,
    studyDocumentsQuery.data,
    t,
    year?.subjects,
    year?.years,
  ])

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.assistant.threads.key() }),
      effectiveThreadId
        ? queryClient.invalidateQueries({
            queryKey: orpc.assistant.threads.get.key(),
          })
        : Promise.resolve(),
    ])
  }, [effectiveThreadId, queryClient])

  const activeRunId = activeRun(detail)?.id ?? null
  useEffect(() => {
    const currentDetail = detailRef.current
    const run = activeRun(currentDetail)
    if (!run || !detailInput) return
    const queryKey = orpc.assistant.threads.get.queryKey({ input: detailInput })
    return connectAssistantRunEvents({
      apiUrl: env.apiUrl,
      runId: run.id,
      cursor:
        currentDetail?.activeRunProjections.find(
          (projection) => projection.runId === run.id
        )?.lastSequence ?? 0,
      poll: (input) => rpc.assistant.events.poll(input),
      onEvent: (event) => {
        queryClient.setQueryData<AssistantThreadDetail>(queryKey, (current) =>
          current ? applyAssistantEvent(current, event) : current
        )
        if (event.terminal) {
          window.setTimeout(() => void refresh(), 25)
        }
      },
      onError: (streamError) =>
        setError(
          messageFromError(streamError, t("The assistant request failed."))
        ),
    })
  }, [activeRunId, detailInput, queryClient, refresh, t])

  const runAction = useCallback(
    async function runAssistantAction<T>(
      operation: () => Promise<T>
    ): Promise<T> {
      setError(null)
      try {
        return await operation()
      } catch (actionError) {
        const message = messageFromError(
          actionError,
          t("The assistant request failed.")
        )
        setError(message)
        throw actionError
      }
    },
    [t]
  )

  const actions = useMemo<AssistantWorkspaceActions>(
    () => ({
      createThread: () =>
        runAction(async () => {
          const created = await rpc.assistant.threads.create({
            projectId: projectId ?? null,
          })
          // A project selection is validated against its filtered list. Make
          // that list authoritative before selecting the newly created id;
          // the global assistant keeps its immediate-selection behavior.
          if (projectId) await refresh()
          setSelectedBranchId(created.branch.id)
          setSelectedThreadId(created.thread.id)
          if (!projectId) await refresh()
          return created.thread.id
        }),
      selectThread: (threadId) => {
        setSelectedBranchId(null)
        setSelectedThreadId(threadId)
      },
      searchThreads: setSearchQuery,
      updateThread: (threadId, patch) =>
        runAction(async () => {
          const thread =
            detail?.thread.id === threadId
              ? detail.thread
              : threads.find((item) => item.id === threadId)
          if (!thread) throw new Error(t("Conversation not found"))
          await rpc.assistant.threads.update({
            threadId,
            expectedRevision: thread.revision,
            ...patch,
          })
          await refresh()
        }),
      trashThread: (threadId) =>
        runAction(async () => {
          const thread =
            detail?.thread.id === threadId
              ? detail.thread
              : threads.find((item) => item.id === threadId)
          if (!thread) throw new Error(t("Conversation not found"))
          await rpc.assistant.threads.trash({
            threadId,
            expectedRevision: thread.revision,
          })
          await refresh()
        }),
      restoreThread: (threadId) =>
        runAction(async () => {
          const thread =
            detail?.thread.id === threadId
              ? detail.thread
              : threads.find((item) => item.id === threadId)
          if (!thread) throw new Error(t("Conversation not found"))
          await rpc.assistant.threads.restore({
            threadId,
            expectedRevision: thread.revision,
          })
          await refresh()
        }),
      send: (intent) =>
        runAction(async () => {
          if (!detail?.activeBranchId)
            throw new Error(t("No conversation branch is selected"))
          if (!intent.modelKey) throw new Error(t("Select a model first"))
          await rpc.assistant.messages.send({
            threadId: detail.thread.id,
            branchId: detail.activeBranchId,
            expectedHeadMessageId: intent.parentMessageId,
            clientRequestId: randomRequestId("send"),
            markdown: intent.markdown,
            modelKey: intent.modelKey,
            skillId: intent.skillId,
            planMode: intent.planMode,
            forkOnConflict: false,
            approvalMode,
            attachments: intent.references.map((item) => ({
              kind: item.kind,
              referenceId: item.referenceId,
              snapshotVersion: item.snapshotVersion ?? null,
              label: item.label,
            })),
          })
          await refresh()
        }),
      edit: (intent) =>
        runAction(async () => {
          await rpc.assistant.messages.edit({
            messageId: intent.sourceMessageId,
            clientRequestId: randomRequestId("edit"),
            markdown: intent.markdown,
            modelKey: intent.modelKey,
            approvalMode,
            historicalBranch: intent.historicalBranch,
          })
          await refresh()
        }),
      retry: (input) =>
        runAction(async () => {
          await rpc.assistant.messages.retry({
            messageId: input.messageId,
            clientRequestId: randomRequestId("retry"),
            modelKey: input.modelKey || undefined,
            approvalMode,
            historicalBranch: input.historicalBranch,
          })
          await refresh()
        }),
      previewHistoricalBranch: (input) =>
        runAction(() => rpc.assistant.messages.branchPreview(input)),
      cancel: (runId) =>
        runAction(async () => {
          await rpc.assistant.runs.cancel({ runId })
          await refresh()
        }),
      answerQuestion: (runId, questionId, answer) =>
        runAction(async () => {
          await rpc.assistant.runs.respond({ runId, questionId, answer })
          await refresh()
        }),
      switchBranch: (branch) => {
        setSelectedBranchId(branch.id)
        if (!detail) return
        void runAction(async () => {
          await rpc.assistant.threads.update({
            threadId: detail.thread.id,
            expectedRevision: detail.thread.revision,
            activeBranchId: branch.id,
          })
          await refresh()
        })
      },
      refetch: refresh,
      setModel: setSelectedModelKey,
      setSkill: setSelectedSkillId,
      setPlanMode,
      setApprovalMode,
      uploadAttachment: (file) =>
        runAction(async () => {
          if (!year?.yearId) {
            throw new Error(
              t("Select an academic year before attaching a file")
            )
          }
          const route =
            file.type.startsWith("audio/") || file.type.startsWith("video/")
              ? "courseMedia"
              : "courseMaterial"
          const uploaded = await uploadBrowserFile(route, file)
          const adopted = await rpc.materials.documents.upload({
            yearId: year.yearId,
            folderId: null,
            title: file.name.slice(0, 160),
            fileId: uploaded.fileId,
            fileName: file.name.slice(0, 160),
          })
          await queryClient.invalidateQueries({
            queryKey: orpc.materials.documents.key(),
          })
          return {
            clientId: randomRequestId("material"),
            kind: "material",
            referenceId: adopted.document.id,
            label: file.name,
            mimeType: file.type || null,
          } satisfies AssistantPendingReference
        }),
      transcribeDictation: (file) =>
        runAction(async () => {
          const body = new FormData()
          body.set("audio", file)
          const response = await fetch(
            `${env.apiUrl}/api/assistant/dictation`,
            {
              method: "POST",
              credentials: "include",
              body,
            }
          )
          const result = (await response.json().catch(() => null)) as {
            text?: unknown
            error?: unknown
          } | null
          if (!response.ok || typeof result?.text !== "string") {
            throw new Error(
              typeof result?.error === "string"
                ? result.error
                : t("Dictation transcription is unavailable.")
            )
          }
          return result.text
        }),
      openCitation: (citationId) =>
        runAction(async () => {
          const result = await rpc.assistant.citations.open({ citationId })
          const target = result.resolved.openTarget
          return {
            citationId,
            title: result.resolved.displayTitle,
            subtitle: target.kind,
            excerpt: result.text,
            locatorLabel: locatorLabel(target.locator),
            href: citationHref(target),
          }
        }),
      openArtifact: (artifactId) => {
        router.push(`/materials?artifact=${encodeURIComponent(artifactId)}`)
      },
      exportThread: (threadId, format, mode) =>
        runAction(() =>
          rpc.assistant.threads.export({
            threadId,
            branchId: detail?.activeBranchId ?? undefined,
            format,
            mode,
          })
        ),
      saveToProject: (threadId, projectId, mode) =>
        runAction(async () => {
          await rpc.assistant.threads.saveToProject({
            threadId,
            projectId,
            branchId: detail?.activeBranchId ?? undefined,
            mode,
          })
          await queryClient.invalidateQueries({ queryKey: orpc.projects.key() })
          toast.success(
            mode === "reference"
              ? t("Conversation linked to the project.")
              : t("Markdown document created in the project.")
          )
        }),
    }),
    [
      approvalMode,
      detail,
      queryClient,
      refresh,
      router,
      runAction,
      t,
      projectId,
      threads,
      year,
    ]
  )

  const state: AssistantWorkspaceState = {
    threads,
    detail,
    models,
    modelReadiness: modelCatalogueQuery.data?.items ?? [],
    skills,
    projects,
    referenceOptions,
    selectedModelKey: effectiveModelKey,
    selectedSkillId,
    planMode,
    approvalMode,
    searchQuery,
    loadingThreads: threadsQuery.isLoading,
    loadingDetail: detailQuery.isLoading,
    error:
      error ??
      (threadsQuery.error
        ? messageFromError(
            threadsQuery.error,
            t("The assistant request failed.")
          )
        : null) ??
      (detailQuery.error
        ? messageFromError(
            detailQuery.error,
            t("The assistant request failed.")
          )
        : null),
  }

  return (
    <AssistantWorkspace
      state={state}
      actions={actions}
      onClose={onClose}
      expandHref={expandHref}
      pane={pane}
      paneTitle={paneTitle}
      paneCloseHref={paneCloseHref}
      className={className}
      compactRail={compactRail}
    />
  )
}
