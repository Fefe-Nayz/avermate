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
    expect(client).toContain("sourceSummary.indexed")
    expect(client).toContain("sourceSummary.included")
    expect(client).toContain("sourceSummary.onDemand")
    expect(client).toContain("sourceSummary.excluded")
    expect(client).toContain("sourceSummary.contextSearchable")
    expect(client).toContain("sourceSummary.contextEligible")
    expect(client).toContain("sourceSummary.automaticSearchable")
    expect(client).toContain("sourceSummary.automaticEligible")
    expect(client).toContain(
      "sourceSummary.contextSearchable - sourceSummary.automaticSearchable"
    )
    expect(client).toContain('t("Automatic context")')
    expect(client).toContain('t("Available on demand")')
    expect(client).toContain("sourceSummary.recentContextItemIds.flatMap")
    expect(client).toContain('item.contextMode === "exclude"')
    expect(client).toContain('t("Technical index")')
    expect(client).toContain('t("Assistant context rules")')
    expect(client).toContain("sourceSummary.indexed}/{sourceSummary.total")
    expect(client).toContain("sourceSummary.contextEligible === 0")
    expect(client).toContain('t("Choose what belongs in the project context")')
    expect(client).toContain("sourceSummary.contextEligible > 0")
    expect(client).not.toContain("items.slice(0, 4)")
  })

  test("localizes source modes, states and actions instead of leaking French labels into English", async () => {
    const manager = await source("./project-source-manager.tsx")

    expect(manager).toContain('t("Always include")')
    expect(manager).toContain('t("Available on demand")')
    expect(manager).toContain('t("Exclude from context")')
    expect(manager).toContain("const coverageText = useCoverageText()")
    expect(manager).toContain("const indexStatusText = useIndexStatusText()")
    expect(manager).toContain("coverageText(item.coverage)")
    expect(manager).toContain("indexStatusText(item.indexStatus)")
    expect(manager).toContain('aria-label={t("Move source up")}')
    expect(manager).toContain('aria-label={t("Remove reference from project")}')
    for (const hardcodedFrench of [
      "Toujours inclure",
      "À la demande",
      "Exclure du contexte",
      "Trouver une source",
      "Choisir une source",
      "Aucune source dans ce projet",
      "Source manquante",
      "Monter la source",
      "Retirer la référence du projet",
    ]) {
      expect(manager).not.toContain(hardcodedFrench)
    }
  })

  test("updates the context rule of an existing source through the owned project route", async () => {
    const [manager, client] = await Promise.all([
      source("./project-source-manager.tsx"),
      source("./projects-client.tsx"),
    ])

    expect(manager).toContain("onContextMode({")
    expect(manager).toContain("value={item.contextMode}")
    expect(manager).toContain('t("Context for {source}"')
    expect(manager).toContain("htmlFor={itemContextSelectId}")
    expect(client).toContain(
      "orpc.projects.setItemContextMode.mutationOptions()"
    )
    expect(client).toContain("onContextMode={(input) =>")
    expect(client).toContain('t("Source context rule updated")')
  })

  test("localizes the project list and editor in both locales", async () => {
    const [client, dialog] = await Promise.all([
      source("./projects-client.tsx"),
      source("./project-dialog.tsx"),
    ])

    expect(client).toContain('title={t("Study projects")}')
    expect(client).toContain('t("Projects could not be loaded")')
    expect(client).toContain('t("Create your first study project")')
    expect(dialog).toContain("const t = useExtracted()")
    expect(dialog).toContain('htmlFor="project-color"')
    expect(dialog).toContain('id="project-color"')
    expect(dialog).toContain('htmlFor="project-subject"')
    expect(dialog).toContain('id="project-subject"')

    for (const hardcodedFrench of [
      "Projets d’étude",
      "Nouveau projet",
      "Les projets ne peuvent pas être chargés",
      "Créez votre premier projet d’étude",
      "Toutes les matières",
      "Modifier le projet",
      "Donnez un nom au projet",
      "Matière par défaut",
      "Instructions du projet",
      "Créer le projet",
    ]) {
      expect(client).not.toContain(hardcodedFrench)
      expect(dialog).not.toContain(hardcodedFrench)
    }
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
