import { describe, expect, test } from "bun:test"
import { syncConnectionsInput, syncStatusInput } from "@/lib/route-query-inputs"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("Moodle integration read model", () => {
  test("hydrates the exact year list and every initial connection status", async () => {
    const [page, section] = await Promise.all([
      source("./page.tsx"),
      source("./moodle-sync-section.tsx"),
    ])

    expect(page).not.toContain('"use client"')
    expect(page).toContain("prepareAuthenticatedShell")
    expect(page).toContain("syncConnectionsInput(activeYearId)")
    expect(page).toContain("syncStatusInput(connection.id)")
    expect(page).toContain("connections.map")
    expect(page).toContain("orpc.sync.status.queryOptions")
    expect(page).toContain("HydrateClient")

    expect(section).toContain('"use client"')
    expect(section).toContain("syncConnectionsInput(activeYearId)")
    expect(section).toContain("useYear()")
    expect(section).toContain("syncStatusInput(connection.id)")
    expect(section).toContain("orpc.sync.connections.list.queryOptions")
    expect(syncConnectionsInput("year-8")).toEqual({ yearId: "year-8" })
    expect(syncStatusInput("connection-8")).toEqual({
      connectionId: "connection-8",
    })
  })

  test("keeps refreshes scoped to exact sync queries", async () => {
    const section = await source("./moodle-sync-section.tsx")

    expect(section).toContain("orpc.sync.connections.list.queryKey")
    expect(section).toContain("orpc.sync.status.queryKey")
    expect(section).toContain("exact: true")
    expect(section).not.toContain("orpc.sync.key()")
    expect(section).not.toContain("orpc.snapshot")
    expect(section).toContain("orpc.jobs.get.queryOptions")
  })

  test("preserves BYOK and never reads stored secret material", async () => {
    const [page, client, section] = await Promise.all([
      source("./page.tsx"),
      source("./integrations-client.tsx"),
      source("./moodle-sync-section.tsx"),
    ])

    expect(page).toContain("orpc.serviceKeys.metadata.queryOptions")
    expect(page).not.toContain("orpc.serviceKeys.list.queryOptions")
    expect(client).toContain("<ServiceKeysSection />")
    expect(page).toContain("orpc.assistant.toolSources.list.queryOptions")
    expect(client).toContain("<CustomMcpSection />")
    expect(section).not.toContain("connection.sealedCredentials")
    expect(section).not.toContain("connection.caCertPem")
    expect(section).toContain("current.hasCustomCa")
    expect(section).toContain('useState("")')
    expect(section).toContain('autoComplete="off"')
  })

  test("validates and revokes every provider credential independently", async () => {
    const section = await source("./service-keys-section.tsx")

    expect(section).toContain("orpc.serviceKeys.metadata.queryOptions")
    expect(section).toContain("orpc.serviceKeys.setValidated.mutationOptions")
    expect(section).toContain("provider: credential.provider")
    expect(section).toContain("scopes: [...credential.scopes]")
    expect(section).toContain('type="password"')
    expect(section).toContain('autoComplete="new-password"')
    for (const provider of [
      "mistral",
      "openai",
      "openrouter",
      "gemini",
      "cohere",
      "elevenlabs",
    ]) {
      expect(section).toContain(`provider: "${provider}"`)
    }
    expect(section).not.toContain("sealedKey")
    expect(section).not.toContain("invalidationToken")
    expect(section).not.toContain("orpc.serviceKeys.list")
  })

  test("hydrates and exposes the complete advanced retrieval control plane", async () => {
    const [page, client, section] = await Promise.all([
      source("./page.tsx"),
      source("./integrations-client.tsx"),
      source("./retrieval-settings-section.tsx"),
    ])

    expect(page).toContain("orpc.retrieval.readiness.queryOptions")
    expect(page).toContain("orpc.retrieval.traces.queryOptions")
    expect(page).toContain("orpc.retrieval.evaluations.queryOptions")
    expect(client).toContain("<RetrievalSettingsSection />")
    expect(section).toContain("orpc.retrieval.grantConsent.mutationOptions")
    expect(section).toContain("orpc.retrieval.revokeConsent.mutationOptions")
    expect(section).toContain("<ProjectRetrievalPolicyCard")
    expect(section).toContain("orpc.projects.retrievalPolicy.queryKey")
    expect(section).toContain("projects.isPending")
    expect(section).toContain("projects.isError")
    expect(section).toContain("projects.refetch()")
    expect(section).toContain("htmlFor={projectSelectId}")
    expect(section).toContain("id={projectSelectId}")
    expect(section).toContain('t("No study projects yet")')
    expect(section).toContain('t("Configured")')
    expect(section).not.toContain('ready ? t("Ready")')
    expect(section).not.toContain("geminiDisclosure?.summary")
    expect(section).not.toContain("cohereDisclosure?.summary")
    expect(section).not.toContain("consentTarget?.summary")
    expect(section).toContain(
      "Selected source content—text, images and PDF pages, and audio or video segments—is sent to Google Gemini to create search embeddings. Search queries are also sent; a follow-up query may include up to two recent user messages and three project titles. Secrets and signed URLs are never sent."
    )
    expect(section).toContain(
      "The query and a bounded excerpt of already authorized candidates are sent to Cohere for ranking. The full corpus, secrets and signed URLs are never sent."
    )
    expect(section).not.toContain(
      "orpc.retrieval.updateProject.mutationOptions"
    )
    expect(section).not.toContain("const advancedReady")
    expect(section).toContain(
      "Project rebuilds are proposed above only when the confirmed policy requires one."
    )
    expect(section).toContain("orpc.retrieval.reindex.mutationOptions")
    expect(section).toContain("Reindex all Core-stored content")
    expect(section).toContain(
      "This explicit global rebuild can send eligible content stored in Avermate Core to the embedding provider you authorized, including content used by lexical-only projects. Sources stored on a paired Node are not processed by the Core worker."
    )
    expect(section).not.toContain("Reindex the entire corpus")
    expect(section).toContain("orpc.retrieval.evaluate.mutationOptions")
    expect(section).toContain("orpc.retrieval.clearIndex.mutationOptions")
    expect(section).toContain("disable-all-vector-generations")
    expect(section).toContain("Disable vector retrieval")
    expect(section).toContain(
      'result.publicationState === "superseded-by-reenable"'
    )
    expect(section).not.toContain('result.publicationState !== "disabled"')
    expect(section).toContain(
      "This global action disables every published or in-progress vector generation and cancels queued or running vector rebuilds."
    )
    expect(section).toContain(
      "Project retrieval policies and space selections, source files, OCR, transcripts and rendered pages are preserved."
    )
    expect(section).toContain("orpc.projects.key()")
    expect(section).toContain("orpc.projects.key()")
    expect(section).not.toContain("projectId: projectId ?? undefined")
    expect(section).not.toContain(
      "this project's rebuildable vector derivatives"
    )
    expect(section).toContain('id="retrieval"')
    expect(section).toContain("Gemini Embedding 2")
    expect(section).toContain("Local TEI reranker")
    expect(section).toContain("Cohere Rerank")
    expect(section).toContain("embedding.generations")
    expect(section).toContain("generation.effectiveState")
    expect(section).not.toContain(
      '<Badge variant="outline">{generation.state}</Badge>'
    )
    expect(section).toContain("fallbackPolicy")
    expect(section).toContain("queryDigest")
  })

  test("hydrates production model placement and explicit routing policy", async () => {
    const [page, client, section, composer, assistantClient, workspace] =
      await Promise.all([
        source("./page.tsx"),
        source("./integrations-client.tsx"),
        source("./assistant-model-settings-section.tsx"),
        source("../../../../components/assistant/assistant-composer.tsx"),
        source("../../../../components/assistant/assistant-client.tsx"),
        source(
          "../../../../components/assistant/assistant-conversation-header.tsx"
        ),
      ])

    expect(page).toContain("orpc.assistant.models.catalogue.queryOptions")
    expect(page).toContain("orpc.assistant.models.preference.get.queryOptions")
    expect(client).toContain("<AssistantModelSettingsSection />")
    expect(section).toContain("orpc.assistant.models.preference.update")
    expect(section).toContain('id="assistant-models"')
    expect(section).toContain("contentLeavesPlacement")
    expect(section).toContain("maximumEstimatedCostMinor")
    expect(section).toContain("configured-routes")
    // The approval mode left the composer for the conversation header: it is
    // a disclosure about what the assistant may touch, not a per-message
    // choice you make beside the send button.
    expect(workspace).toContain("confirm-writes")
    expect(workspace).toContain("auto-reversible")
    expect(workspace).toContain("setApprovalMode")
    // And it must not drift back: the writing bar is for writing.
    expect(composer).not.toContain("setApprovalMode")
    expect(assistantClient).toContain(
      "orpc.assistant.models.preference.get.queryOptions"
    )
    expect(assistantClient).toContain("approvalMode,")
  })

  test("announces live job state and distinguishes an hourly replay", async () => {
    const section = await source("./moodle-sync-section.tsx")

    expect(section).toContain('aria-live="polite"')
    expect(section).toContain("aria-busy={active}")
    expect(section).toContain('role="alert"')
    expect(section).toContain('result.status === "succeeded"')
    expect(section).toContain(
      "This hour's Moodle synchronization is already complete."
    )
  })
})
