import { describe, expect, test } from "bun:test"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("project retrieval policy controls", () => {
  test("uses the owned project policy as the only source of active and degraded state", async () => {
    const card = await source("./project-retrieval-policy-card.tsx")

    expect(card).toContain("orpc.projects.retrievalPolicy.queryOptions")
    expect(card).toContain('policy.status === "active"')
    expect(card).toContain("policy.effectiveMode")
    expect(card).toContain("policy.reasons")
    expect(card).toContain("OPTIONAL_RERANK_REASONS.has(reason)")
    expect(card).toContain("policy.reindex.required")
    expect(card).toContain("refetchInterval: (query)")
    expect(card).toContain("Date.now() >= reindexPollingUntil")
    expect(card).toContain("window.setTimeout")
    expect(card).toContain("!online")
    expect(card).toContain("Date.now() + 60_000")
    expect(card).toContain("reindexPolling")
    expect(card).toContain('t("Reindexing…")')
    expect(card).toContain('role="status"')
    expect(card).not.toContain("vectorConfigured")
  })

  test("saves with CAS and invalidates only the selected project surfaces", async () => {
    const [card, client] = await Promise.all([
      source("./project-retrieval-policy-card.tsx"),
      source("./projects-client.tsx"),
    ])

    expect(card).toContain("orpc.projects.setRetrievalPolicy.mutationOptions")
    expect(card).toContain("revision: policy.revision")
    expect(card).toContain("orpc.projects.retrievalPolicy.queryKey({ input })")
    expect(card).toContain("orpc.projects.get.queryKey({ input })")
    expect(card).toContain("exact: true")
    expect(card).toContain("isConflictError(error)")
    expect(card).toContain("policyQuery.refetch()")
    expect(card).toContain("latest.isSuccess")
    expect(card).toContain("key={`${policy.projectId}:${policy.revision}`}")
    expect(client).toContain("orpc.projects.retrievalPolicy.queryKey({")
    expect(client).toContain("input: { projectId }")
  })

  test("offers accessible policy, fallback and exact compatible-space controls", async () => {
    const card = await source("./project-retrieval-policy-card.tsx")

    expect(card).toContain('aria-label={t("Project search mode")}')
    expect(card).toContain("aria-describedby={modeDescriptionId}")
    expect(card).toContain('value="lexical-only"')
    expect(card).toContain('value="advanced-auto"')
    expect(card).toContain("compatibleSelection(")
    expect(card).toContain("policy.embedding.compatibleSpaces.map")
    expect(card).toContain("policy.rerank.compatibleSpaces.map")
    expect(card).toContain("htmlFor={embeddingControlId}")
    expect(card).toContain("htmlFor={rerankControlId}")
    expect(card).toContain("htmlFor={fallbackControlId}")
    expect(card).toContain('className="min-h-11 w-full justify-start"')
    expect(card).toContain('value="hybrid-without-rerank"')
    expect(card).toContain("/settings/integrations#retrieval")
    expect(card).not.toContain("<AlertAction")
  })

  test("distinguishes configured availability from the stages actually in use", async () => {
    const card = await source("./project-retrieval-policy-card.tsx")

    expect(card).toContain('type StageStatus = "active"')
    expect(card).toContain('t("Available")')
    expect(card).toContain('t("Needs attention")')
    expect(card).toContain('t("Not in use")')
    expect(card).toContain("policy?.embedding.selectedSpaceCompatible")
    expect(card).toContain("policy?.rerank.selectedSpaceCompatible")
    expect(card).toContain("policy?.denseReady")
    expect(card).toContain("policy?.rerankReady")
    expect(card).toContain("!policy.reindex.required")
    expect(card).toContain("policy.embedding.sendsSourceContentToThirdParties")
    expect(card).toContain('"embedding-source-placement-unsupported"')
    expect(card).toContain("policy.reindex.unsupportedVersionCount")
    expect(card).toContain("!sourcePlacementUnsupported")
    expect(card).toContain("policy.lexical.available &&")
    expect(card).toContain("policy.reindex.generationId === null")
    expect(card).toContain("policy.reindex.canReindex")
    expect(card).toContain("lexicalUnavailable")
    expect(card).toContain("disabled={!advancedSelectable}")
    expect(card).toContain("Advanced RAG cannot be enabled for this project")
    expect(card).toContain(
      "Some sources are stored on a paired Node and cannot be processed by the current Core embedding pipeline."
    )
    expect(card).toContain('t("Lexical search is unavailable")')
    expect(card).toContain(
      "Search requests from this project stay lexical-only and do not call embedding or reranking providers. A separate corpus-wide rebuild that you start explicitly may still send eligible Core-stored content to an authorized embedding provider."
    )
    expect(card).not.toContain(
      "Embedding and reranking providers are not called in lexical-only mode."
    )
  })

  test("allows dense hybrid retrieval while keeping reranking explicitly optional", async () => {
    const card = await source("./project-retrieval-policy-card.tsx")

    expect(card).toContain(
      'const rerankerOptional = fallback === "hybrid-without-rerank"'
    )
    expect(card).toContain(
      "!rerankerOptional && (!rerankItems.length || !rerankProviderReady)"
    )
    expect(card).toContain("(!rerankerOptional && !rerankSpaceId)")
    expect(card).toContain('policy?.effectiveMode === "hybrid"')
    expect(card).toContain('? "not-in-use"')
    expect(card).toContain("OPTIONAL_RERANK_REASONS.has(reason)")
    expect(card).toContain(
      "A compatible reranker is used when available, but is not required."
    )
    expect(card).toContain("or choose hybrid search without reranking.")
    const selectableStart = card.indexOf("const advancedSelectable =")
    const selectableEnd = card.indexOf(
      "const requiredRerankerUnavailable",
      selectableStart
    )
    expect(card.slice(selectableStart, selectableEnd)).not.toContain(
      "rerankItems.length"
    )
  })

  test("keeps confirmed state understandable during refresh and connectivity failures", async () => {
    const card = await source("./project-retrieval-policy-card.tsx")

    expect(card).toContain('t("You are offline")')
    expect(card).toContain('t("Retrieval policy could not be refreshed")')
    expect(card).toContain("online && !policyQuery.isError")
    expect(card).toContain('className="w-full shrink-0 sm:w-auto"')
  })
})
