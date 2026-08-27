import { describe, expect, test } from "bun:test"
import {
  outputPreviewKind,
  selectedArtifactFromResults,
  selectedProjectSourceVersions,
  stageCanApprove,
  stageCanRetry,
  stageProgress,
  workflowStatusVariant,
} from "./media-studio-model"

describe("media studio presentation", () => {
  test("keeps status actions exact", () => {
    expect(stageCanApprove("awaiting_approval")).toBe(true)
    expect(stageCanApprove("running")).toBe(false)
    expect(stageCanRetry("failed")).toBe(true)
    expect(stageCanRetry("cancelled")).toBe(true)
    expect(stageCanRetry("completed")).toBe(false)
    expect(workflowStatusVariant("failed")).toBe("destructive")
  })

  test("bounds progress", () => {
    expect(stageProgress(4, 8)).toBe(50)
    expect(stageProgress(12, 8)).toBe(100)
    expect(stageProgress(-1, 0)).toBe(0)
  })

  test("chooses only safe, known preview surfaces", () => {
    expect(outputPreviewKind("application/pdf")).toBe("pdf")
    expect(outputPreviewKind("image/png")).toBe("image")
    expect(outputPreviewKind("text/html")).toBe("html")
    expect(outputPreviewKind("application/zip")).toBe("unknown")
  })

  test("selects a deep-linked artifact only from the project-filtered results", () => {
    const artifacts = [{ id: "first" }, { id: "requested" }]

    expect(selectedArtifactFromResults(artifacts, "requested")).toBe(
      artifacts[1]
    )
    expect(selectedArtifactFromResults(artifacts, "another-project")).toBe(
      artifacts[0]
    )
    expect(selectedArtifactFromResults([], "requested")).toBeNull()
    expect(selectedArtifactFromResults(undefined, "requested")).toBeNull()
  })

  test("carries the artifact locator from the route into the Studio client", async () => {
    const [page, client] = await Promise.all([
      Bun.file(
        new URL("../../app/(app)/materials/studio/page.tsx", import.meta.url)
      ).text(),
      Bun.file(new URL("./media-studio-client.tsx", import.meta.url)).text(),
    ])

    expect(page).toContain("artifact?: string | string[]")
    expect(page).toContain("initialArtifactId={artifactId}")
    expect(client).toContain("initialArtifactId = null")
    expect(client).toContain('initialArtifactId ? "artifacts" : "workflows"')
    expect(client).toContain("selectedArtifactFromResults(")
  })

  test("freezes the exact pinned or followed project source versions", () => {
    expect(
      selectedProjectSourceVersions([
        {
          contextMode: "include",
          missing: false,
          selectorReviewRequired: false,
          trackingMode: "pinned",
          sourceVersionId: "version-pinned",
          currentVersionId: "version-newer",
        },
        {
          contextMode: "include",
          missing: false,
          selectorReviewRequired: false,
          trackingMode: "follow-head",
          sourceVersionId: "version-old",
          currentVersionId: "version-current",
        },
        {
          contextMode: "exclude",
          missing: false,
          selectorReviewRequired: false,
          trackingMode: "follow-head",
          sourceVersionId: null,
          currentVersionId: "version-excluded",
        },
        {
          contextMode: "include",
          missing: false,
          selectorReviewRequired: true,
          trackingMode: "follow-head",
          sourceVersionId: null,
          currentVersionId: "version-needs-review",
        },
        {
          contextMode: "include",
          missing: false,
          selectorReviewRequired: false,
          trackingMode: "pinned",
          sourceVersionId: null,
          currentVersionId: "must-not-replace-pin",
        },
      ])
    ).toEqual({
      versionIds: ["version-pinned", "version-current"],
      pendingCount: 1,
    })
  })
})
