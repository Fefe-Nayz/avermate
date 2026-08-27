import { describe, expect, test } from "bun:test"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("project workspace recovery and privacy", () => {
  test("retries only the project attachment after a canonical source was saved", async () => {
    const [dialog, client] = await Promise.all([
      source("./project-add-source-dialog.tsx"),
      source("./projects-client.tsx"),
    ])

    expect(dialog).toContain("const [savedDocumentId, setSavedDocumentId]")
    expect(dialog).toContain("let documentId = savedDocumentId")
    expect(dialog).toContain("if (!documentId)")
    expect(dialog).toContain("setSavedDocumentId(documentId)")
    expect(dialog.indexOf("setSavedDocumentId(documentId)")).toBeLessThan(
      dialog.indexOf("await rpc.projects.addItem({")
    )
    expect(
      dialog.indexOf("queryKey: orpc.materials.documents.key()")
    ).toBeLessThan(dialog.indexOf("await rpc.projects.addItem({"))
    expect(dialog).toContain('t("Retry attachment")')
    expect(client).toContain("key={selected.id}")
    expect(client).not.toContain(
      'key={`${selected.id}:${sourceDialogOpen ? "open" : "closed"}`}'
    )
  })

  test("never claims lexical privacy before the server confirms it", async () => {
    const client = await source("./projects-client.tsx")

    expect(client).toContain("embeddingQuery.isPending")
    expect(client).toContain("embeddingQuery.isError")
    expect(client).toContain('t("Checking retrieval privacy")')
    expect(client).toContain('t("Retrieval privacy could not be verified")')
    expect(client).toContain("embeddingQuery.data.vectorConfigured")
    expect(client.indexOf("embeddingQuery.isError")).toBeLessThan(
      client.indexOf("embeddingQuery.data.vectorConfigured")
    )
  })

  test("opens the exact project artifact in Studio", async () => {
    const client = await source("./projects-client.tsx")

    expect(client).toContain("&artifact=${encodeURIComponent(artifact.id)}")
  })
})
