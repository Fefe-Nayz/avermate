export interface ProjectScopedThreadSelectionInput {
  projectId?: string
  selectedThreadId: string | null
  projectThreadIds: readonly string[]
  projectScopeReady: boolean
  fallbackThreadId: string | null
}

/**
 * Resolve a thread without ever opening an unvalidated deep link inside a
 * project workspace. The global assistant deliberately keeps its existing
 * behavior: any user-owned thread id may be opened there.
 */
export function resolveProjectScopedThreadSelection({
  projectId,
  selectedThreadId,
  projectThreadIds,
  projectScopeReady,
  fallbackThreadId,
}: ProjectScopedThreadSelectionInput): {
  effectiveThreadId: string | null
  resetSelection: boolean
} {
  if (!projectId) {
    return {
      effectiveThreadId: selectedThreadId ?? fallbackThreadId,
      resetSelection: false,
    }
  }

  // The filtered list is the authority for project membership. Until it has
  // resolved, opening the URL-provided id would briefly expose another
  // project's conversation in this workspace.
  if (!projectScopeReady) {
    return { effectiveThreadId: null, resetSelection: false }
  }

  if (
    selectedThreadId &&
    projectThreadIds.some((threadId) => threadId === selectedThreadId)
  ) {
    return { effectiveThreadId: selectedThreadId, resetSelection: false }
  }

  return {
    effectiveThreadId: fallbackThreadId,
    resetSelection: selectedThreadId !== null,
  }
}
