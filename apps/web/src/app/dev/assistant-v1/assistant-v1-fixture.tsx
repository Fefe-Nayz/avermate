"use client"

import { historicalBranchPreviewSchema } from "@avermate/agent-contracts"
import { QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace"
import type {
  AssistantWorkspaceActions,
  AssistantWorkspaceState,
} from "@/components/assistant/assistant-types"
import { createQueryClient } from "@/lib/query-client"

declare global {
  interface Window {
    __assistantFixtureSends?: number
    __assistantFixtureTranscriptions?: number
    __assistantFixtureReady?: boolean
  }
}

const now = "2026-08-22T12:00:00.000Z"

function initialState(): AssistantWorkspaceState {
  const thread = {
    id: "fixture-thread",
    userId: "fixture-user",
    title: "Dictation browser fixture",
    activeBranchId: "fixture-branch",
    projectId: null,
    placement: { kind: "core" as const },
    revision: 1,
    starredAt: null,
    archivedAt: null,
    deletedAt: null,
    purgeAfter: null,
    createdAt: now,
    updatedAt: now,
  }
  return {
    threads: [{ ...thread, running: false }],
    detail: {
      thread,
      activeBranchId: "fixture-branch",
      branches: [
        {
          id: "fixture-branch",
          threadId: thread.id,
          name: "Main",
          forkedFromMessageId: null,
          headMessageId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      messages: [],
      activePathMessageIds: [],
      runs: [],
      attachments: [],
      citations: [],
      manifests: [],
      usage: [],
      activeRunProjections: [],
    },
    models: [
      {
        modelKey: "fixture-model",
        providerKey: "fixture",
        label: "Fixture model",
        placement: "direct-byok",
        modalities: ["text", "audio"],
        supportsTools: true,
        supportsReasoningSummary: false,
        contextTokens: 16_384,
        maxOutputTokens: 2_048,
        estimatedInputPrice: null,
        estimatedOutputPrice: null,
        currency: null,
        contentLeavesPlacement: false,
        privacyUrl: null,
      },
    ],
    skills: [],
    projects: [],
    referenceOptions: [],
    selectedModelKey: "fixture-model",
    selectedSkillId: null,
    planMode: false,
    searchQuery: "",
    loadingThreads: false,
    loadingDetail: false,
    error: null,
  }
}

export function AssistantV1Fixture() {
  const [queryClient] = useState(createQueryClient)
  const [state, setState] = useState(initialState)
  useEffect(() => {
    window.__assistantFixtureReady = true
    return () => {
      window.__assistantFixtureReady = false
    }
  }, [])
  const actions = useMemo<AssistantWorkspaceActions>(
    () => ({
      createThread: async () => "fixture-thread",
      selectThread: () => undefined,
      searchThreads: () => undefined,
      updateThread: async () => undefined,
      trashThread: async () => undefined,
      restoreThread: async () => undefined,
      send: async () => {
        window.__assistantFixtureSends =
          (window.__assistantFixtureSends ?? 0) + 1
      },
      edit: async () => undefined,
      retry: async () => undefined,
      previewHistoricalBranch: async (input) =>
        historicalBranchPreviewSchema.parse({
          ...input,
          threadId: "fixture-thread",
          conversationOnly: { available: true },
          workspaceCopy: {
            available: false,
            reason: "no-committed-snapshot",
            message: "No committed workspace snapshot exists in this fixture.",
            snapshot: null,
          },
        }),
      cancel: async () => undefined,
      answerQuestion: async () => undefined,
      switchBranch: () => undefined,
      refetch: async () => undefined,
      setModel: (modelKey) =>
        setState((current) => ({ ...current, selectedModelKey: modelKey })),
      setSkill: (skillId) =>
        setState((current) => ({ ...current, selectedSkillId: skillId })),
      setPlanMode: (enabled) =>
        setState((current) => ({ ...current, planMode: enabled })),
      uploadAttachment: async (file) => ({
        clientId: `fixture:${file.name}`,
        kind: "file",
        referenceId: `fixture:${file.name}`,
        label: file.name,
        mimeType: file.type,
      }),
      transcribeDictation: async () => {
        window.__assistantFixtureTranscriptions =
          (window.__assistantFixtureTranscriptions ?? 0) + 1
        return "Texte dicté depuis Chrome"
      },
      openCitation: async (citationId) => ({
        citationId,
        title: "Fixture",
      }),
      openArtifact: () => undefined,
      exportThread: async () => ({
        fileName: "fixture.md",
        mimeType: "text/markdown",
        content: "",
        digest: "fixture",
      }),
      saveToProject: async () => undefined,
    }),
    []
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AssistantWorkspace
        state={state}
        actions={actions}
        className="h-svh min-h-0"
      />
    </QueryClientProvider>
  )
}
