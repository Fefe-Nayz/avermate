import { describe, expect, test } from "bun:test"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("project source version tracking", () => {
  test("composes a project as one study workspace instead of a source-only screen", async () => {
    const client = await source("./projects-client.tsx")

    for (const tab of [
      "overview",
      "chat",
      "sources",
      "productions",
      "search",
    ]) {
      expect(client).toContain(`TabsTrigger value="${tab}"`)
      expect(client).toContain(`TabsContent value="${tab}"`)
    }
    expect(client).toContain("<ProjectOverview")
    expect(client).toContain("<AssistantWorkspaceClient")
    expect(client).toContain("projectId={selected.id}")
    expect(client).toContain("<ProjectSourceManager")
    expect(client).toContain("<ProjectProductions")
    expect(client).toContain("<ProjectSearch")
    expect(client).toContain('aria-label={t("Project actions")}')
    expect(client).not.toContain('aria-label="Actions du projet"')
    expect(client).toContain('item.trackingMode === "pinned"')
    expect(client).toContain("Boolean(selectedVersion(item))")
  })

  test("imports files, Web pages and notes into Materials before attaching them", async () => {
    const dialog = await source("./project-add-source-dialog.tsx")

    for (const mode of ["upload", "link", "note"]) {
      expect(dialog).toContain(`TabsTrigger value="${mode}"`)
      expect(dialog).toContain(`TabsContent value="${mode}"`)
    }
    expect(dialog).toContain("uploadBrowserFile(")
    expect(dialog).toContain("rpc.materials.documents.upload({")
    expect(dialog).toContain("rpc.materials.documents.createLink({")
    expect(dialog).toContain("rpc.materials.documents.createText({")
    expect(dialog).toContain("rpc.projects.addItem({")
    expect(dialog).toContain('kind: "material"')
    expect(dialog).toContain("referenceId: documentId")
    expect(dialog.indexOf("documentId = await createSource()")).toBeLessThan(
      dialog.indexOf("await rpc.projects.addItem({")
    )
  })

  test("keeps the selected project when opening and hydrating Studio", async () => {
    const [client, page, studio] = await Promise.all([
      source("./projects-client.tsx"),
      source("../../app/(app)/materials/studio/page.tsx"),
      source("../media-studio/media-studio-client.tsx"),
    ])

    expect(client).toContain(
      "`/materials/studio?project=${encodeURIComponent(projectId)}`"
    )
    expect(page).toContain("project?: string | string[]")
    expect(page).toContain("artifact?: string | string[]")
    expect(page).toContain("input: { projectId }")
    expect(page).toContain("initialProjectId={projectId}")
    expect(page).toContain("initialArtifactId={artifactId}")
    expect(studio).toContain("initialProjectId = null")
    expect(studio).toContain("initialArtifactId = null")
  })

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
