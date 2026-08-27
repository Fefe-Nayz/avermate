import { describe, expect, test } from "bun:test"
import { resolveProjectScopedThreadSelection } from "./assistant-project-scope"

describe("project-scoped assistant thread selection", () => {
  test("leaves global assistant deep links unchanged", () => {
    expect(
      resolveProjectScopedThreadSelection({
        selectedThreadId: "thread-from-url",
        projectThreadIds: [],
        projectScopeReady: false,
        fallbackThreadId: "first-global-thread",
      })
    ).toEqual({
      effectiveThreadId: "thread-from-url",
      resetSelection: false,
    })
  })

  test("waits for project membership before opening a deep link", () => {
    expect(
      resolveProjectScopedThreadSelection({
        projectId: "project-a",
        selectedThreadId: "thread-from-url",
        projectThreadIds: [],
        projectScopeReady: false,
        fallbackThreadId: null,
      })
    ).toEqual({ effectiveThreadId: null, resetSelection: false })
  })

  test("keeps valid project deep links, including while search hides them", () => {
    expect(
      resolveProjectScopedThreadSelection({
        projectId: "project-a",
        selectedThreadId: "thread-a",
        projectThreadIds: ["thread-a", "thread-b"],
        projectScopeReady: true,
        fallbackThreadId: "thread-b",
      })
    ).toEqual({ effectiveThreadId: "thread-a", resetSelection: false })
  })

  test("rejects a thread from another project and selects a safe fallback", () => {
    expect(
      resolveProjectScopedThreadSelection({
        projectId: "project-a",
        selectedThreadId: "thread-from-project-b",
        projectThreadIds: ["thread-a"],
        projectScopeReady: true,
        fallbackThreadId: "thread-a",
      })
    ).toEqual({ effectiveThreadId: "thread-a", resetSelection: true })
  })
})
