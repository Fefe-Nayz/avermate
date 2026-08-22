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
    expect(section).toContain("orpc.retrieval.updateProject.mutationOptions")
    expect(section).toContain("orpc.retrieval.reindex.mutationOptions")
    expect(section).toContain("orpc.retrieval.evaluate.mutationOptions")
    expect(section).toContain("orpc.retrieval.clearIndex.mutationOptions")
    expect(section).toContain("delete-rebuildable-index")
    expect(section).toContain('id="retrieval"')
    expect(section).toContain("Gemini Embedding 2")
    expect(section).toContain("Local TEI reranker")
    expect(section).toContain("Cohere Rerank")
    expect(section).toContain("embedding.generations")
    expect(section).toContain("fallbackPolicy")
    expect(section).toContain("queryDigest")
  })

  test("hydrates production model placement and explicit routing policy", async () => {
    const [page, client, section, composer, assistantClient] =
      await Promise.all([
        source("./page.tsx"),
        source("./integrations-client.tsx"),
        source("./assistant-model-settings-section.tsx"),
        source("../../../../components/assistant/assistant-composer.tsx"),
        source("../../../../components/assistant/assistant-client.tsx"),
      ])

    expect(page).toContain("orpc.assistant.models.catalogue.queryOptions")
    expect(page).toContain("orpc.assistant.models.preference.get.queryOptions")
    expect(client).toContain("<AssistantModelSettingsSection />")
    expect(section).toContain("orpc.assistant.models.preference.update")
    expect(section).toContain('id="assistant-models"')
    expect(section).toContain("contentLeavesPlacement")
    expect(section).toContain("maximumEstimatedCostMinor")
    expect(section).toContain("configured-routes")
    expect(composer).toContain("confirm-writes")
    expect(composer).toContain("auto-reversible")
    expect(composer).toContain("setApprovalMode")
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
