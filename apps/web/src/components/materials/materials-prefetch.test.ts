import { describe, expect, test } from "bun:test"
import {
  materialsDocumentsInput,
  materialsFoldersInput,
} from "@/lib/route-query-inputs"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("materials scoped read model", () => {
  test("hydrates the exact year-scoped folder and document queries", async () => {
    const [page, client] = await Promise.all([
      source("../../app/(app)/materials/page.tsx"),
      source("./materials-client.tsx"),
    ])

    expect(page).not.toContain('"use client"')
    expect(page).toContain("prepareAuthenticatedShell")
    expect(page).toContain("Promise.all")
    expect(page).toContain("materialsFoldersInput(activeYearId)")
    expect(page).toContain("materialsDocumentsInput(activeYearId)")
    expect(page).toContain("HydrateClient")
    expect(page).toContain("queryClient.prefetchQuery")
    expect(page).not.toContain("queryClient.fetchQuery")
    expect(page).not.toContain("snapshot.get")

    expect(client).toContain('"use client"')
    expect(client).toContain("materialsFoldersInput(yearId")
    expect(client).toContain("materialsDocumentsInput(yearId")
    expect(client).not.toContain("snapshot.get")
    expect(materialsFoldersInput("year-1")).toEqual({
      yearId: "year-1",
      include: "live",
    })
    expect(materialsDocumentsInput("year-1")).toEqual({
      yearId: "year-1",
      include: "live",
    })
  })

  test("refreshes only feature-scoped material keys", async () => {
    const client = await source("./materials-client.tsx")
    expect(client).toContain("orpc.materials.folders.key()")
    expect(client).toContain("orpc.materials.documents.key()")
    expect(client).not.toContain("orpc.snapshot")
  })

  test("keeps inline note bodies out of the year list and loads detail on open", async () => {
    const [types, viewer] = await Promise.all([
      source("./materials-types.ts"),
      source("./material-viewer.tsx"),
    ])

    expect(types).not.toContain("textContent: string | null")
    expect(viewer).toContain("orpc.materials.documents.get.queryOptions")
    expect(viewer).toContain('enabled: row.document.sourceType === "text"')
    expect(viewer).toContain("detail.data?.document.textContent")
    expect(viewer).not.toContain("row.document.textContent")
  })

  test("previews owned PDF files inside the material viewer", async () => {
    const viewer = await source("./material-viewer.tsx")

    expect(viewer).toContain('row.file?.mimeType === "application/pdf"')
    expect(viewer).toContain("download.mutate({ documentId })")
    expect(viewer).toContain("<iframe")
    expect(viewer).toContain("src={pdfPreviewUrl}")
    expect(viewer).toContain('target="_blank"')
  })

  test("requires durable consent and a media placement before audio fallback", async () => {
    const [viewer, studio, studioPage] = await Promise.all([
      source("./material-viewer.tsx"),
      source("../media-studio/media-studio-client.tsx"),
      source("../../app/(app)/materials/studio/page.tsx"),
    ])

    expect(viewer).toContain("videoExtractionConsent.queryOptions")
    expect(viewer).toContain("retryVideoAudio.mutationOptions")
    expect(viewer).toContain('advancedReason === "captions_unavailable"')
    expect(viewer).toContain("videoAudioExtraction")
    expect(studio).toContain("videoExtractionConsent.queryOptions")
    expect(studio).toContain("videoConsentQuery.data?.notice")
    expect(studioPage).toContain("videoExtractionConsent.queryOptions")
  })

  test("runs a durable transcribe-all batch with SSE progress and polling fallback", async () => {
    const [client, progress] = await Promise.all([
      source("./materials-client.tsx"),
      source("./material-transcription-progress.tsx"),
    ])

    expect(client).toContain("transcribeAll.mutationOptions")
    expect(client).toContain("activeTranscriptionBatch.queryOptions")
    expect(client).toContain("new EventSource")
    expect(client).toContain("withCredentials: true")
    expect(client).toContain('addEventListener("progress"')
    expect(client).toContain("refetchInterval")
    expect(progress).toContain("(progress.processed / progress.total) * 100")
    expect(progress).toContain("<Progress value={percentage}")
    expect(progress).toContain('t("Retry failed files")')
  })

  test("keeps creation and file upload reachable on mobile and desktop", async () => {
    const client = await source("./materials-client.tsx")

    // Once into the phone header's action slot, once in the toolbar the wide
    // layout shows. The same menu both times, so the two cannot drift apart.
    expect(client.match(/\{addMenu\}/g)).toHaveLength(2)
    expect(client).toContain("<PageActions>")
    expect(client).toContain('href="/materials/studio"')
    expect(client).toContain('t("Studio")')
    expect(client).toContain('t("Upload a file")')
  })

  test("keeps the folder you are in in the address", async () => {
    const client = await source("./materials-client.tsx")

    // Not component state: a folder has to be linkable, the back button has to
    // go back a folder, and the header breadcrumb is built from the URL.
    expect(client).toContain("useSearchParams()")
    expect(client).toContain("window.history.pushState")
    // A router navigation would re-render the whole route on the server for a
    // move between two folders that are already in the browser.
    expect(client).not.toContain("router.push")
  })

  test("browses with the project's own tree and data grid", async () => {
    const client = await source("./materials-client.tsx")

    expect(client).toContain("<MaterialsFolderTree")
    expect(client).toContain("<MaterialsTable")
    // The screen is the browser, not a card sitting on a page.
    expect(client).not.toContain("<Card")
  })

  test("accepts multiple files and a direct drop into the current folder", async () => {
    const source = await Bun.file(
      new URL("./materials-client.tsx", import.meta.url)
    ).text()

    expect(source).toContain("multiple")
    expect(source).toContain("onDrop={onDrop}")
    expect(source).toContain("event.dataTransfer.files")
    expect(source).toContain('t("Drop files in this folder")')
    expect(source).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    expect(source).toContain("application/vnd.oasis.opendocument.text")
    expect(source).toContain("text/plain")
    expect(source).toContain("MAX_FILES_PER_UPLOAD_BATCH = 10")
    expect(source).toContain("for (const file of picked)")
    expect(source).not.toContain("picked.slice(0, MAX_FILES_PER_UPLOAD_BATCH)")
    expect(source).toMatch(
      /if \(picked\.length > MAX_FILES_PER_UPLOAD_BATCH\)[\s\S]*?toast\.error\([\s\S]*?\n\s*return\n/
    )
  })
})
