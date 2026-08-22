import { describe, expect, test } from "bun:test"

async function source(name: string): Promise<string> {
  return Bun.file(new URL(name, import.meta.url)).text()
}

describe("link ingestion materials UI", () => {
  test("polls only visible link transcripts and renders honest card states", async () => {
    const [client, status] = await Promise.all([
      source("./materials-client.tsx"),
      source("./link-ingestion-status.tsx"),
    ])

    expect(client).toContain('document.sourceType === "link"')
    expect(client).toContain("documents.transcript.queryOptions")
    expect(client).toContain('status === "pending" ? 1_500 : false')
    expect(client).toContain("<LinkIngestionBadge")
    expect(client).toContain("<LinkProvenance")
    expect(status).toContain('normalized === "pending"')
    expect(status).toContain('normalized === "ready"')
    expect(status).toContain('normalized === "failed"')
  })

  test("offers reingestion and keeps readable markdown in the existing viewer", async () => {
    const [client, viewer, dialog] = await Promise.all([
      source("./materials-client.tsx"),
      source("./material-viewer.tsx"),
      source("./material-dialogs.tsx"),
    ])

    for (const implementation of [client, viewer]) {
      expect(implementation).toContain(
        "orpc.materials.documents.reingest.mutationOptions()"
      )
      expect(implementation).toContain("documents.transcript.queryKey")
    }
    expect(viewer).toContain("<DocumentMarkdown")
    expect(viewer).toContain("Import again")
    expect(viewer).toContain("Retry import")
    expect(viewer).not.toContain(
      "Link transcription will be available after content import is added."
    )
    expect(dialog).toContain(
      "Avermate will import the readable page as markdown after the link is added."
    )
  })
})
