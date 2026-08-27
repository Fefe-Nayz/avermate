import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { assistantHrefWithoutInvalidThread } from "./assistant-deep-link"

const client = readFileSync(
  new URL("./assistant-client.tsx", import.meta.url),
  "utf8"
)

describe("project assistant deep-link scope", () => {
  test("validates a selected thread through the server, never through the bounded list", () => {
    expect(client).toContain(
      "const effectiveThreadId = selectedThreadId ?? threads[0]?.id ?? null"
    )
    expect(client).toContain(
      "...(projectId ? { expectedProjectId: projectId } : {})"
    )
    expect(client).toContain("orpc.assistant.threads.get.queryOptions")

    // There is one list for presentation. A second unsearched list used as a
    // membership authority was the exact regression that rejected thread 101.
    expect(
      client.match(/assistant\.threads\.list\.queryOptions/g)
    ).toHaveLength(1)
    expect(client).not.toContain("projectThreadScopeQuery")
    expect(client).not.toContain("resolveProjectScopedThreadSelection")
    expect(client).not.toContain("projectThreadIds.some")
  })

  test("cleans an invalid project thread before falling back", () => {
    expect(
      assistantHrefWithoutInvalidThread(
        "/projects/project-1",
        "thread=thread-2&branch=branch-3&locator=page%3A4&tab=chat"
      )
    ).toBe("/projects/project-1?tab=chat")
    expect(
      assistantHrefWithoutInvalidThread(
        "/projects/project-1",
        "thread=thread-2&branch=branch-3"
      )
    ).toBe("/projects/project-1")

    expect(client).toContain("router.replace(cleanHref, { scroll: false })")
    expect(client).toContain(
      "This conversation is unavailable in this project. The project assistant was reset."
    )
  })
})
