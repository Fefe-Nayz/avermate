import { describe, expect, test } from "bun:test"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("project source version tracking", () => {
  test("exposes pinned/follow-head controls and conversation review without mutating a branch", async () => {
    const [manager, client] = await Promise.all([
      source("./project-source-manager.tsx"),
      source("./projects-client.tsx"),
    ])

    expect(client).toContain("orpc.projects.setItemTracking.mutationOptions")
    expect(client).toContain("onTracking={(input)")
    expect(manager).toContain('trackingMode: "pinned" | "follow-head"')
    expect(manager).toContain("selectorReviewRequired")
    expect(manager).toContain('t("Pin the current version")')
    expect(manager).toContain('t("Follow the latest version again")')
    expect(manager).toContain("/assistant?thread=")
    expect(manager).not.toContain("conversationHeadMessageId =")
  })

  test("shows the real hybrid/rerank pipeline and its explicit fallback", async () => {
    const search = await source("./project-search.tsx")

    expect(search).toContain('retrievalMode === "reranked"')
    expect(search).toContain("rerankImplementation")
    expect(search).toContain("fallbackReason")
    expect(search).toContain("resultQuery.data?.stages.map")
    expect(search).toContain("operationId.slice")
    expect(search).toContain('process.env.NODE_ENV === "development"')
    expect(search).toContain('t("Open exact source")')
    expect(search).toContain("useOnlineStatus")
  })
})
