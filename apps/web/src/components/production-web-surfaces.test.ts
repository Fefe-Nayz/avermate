import { describe, expect, test } from "bun:test"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("production Web surfaces", () => {
  test("keeps the assistant unavailable states safe and accessible", async () => {
    const [workspace, composer, approval, history, interactions, panel] =
      await Promise.all([
        source("./assistant/assistant-workspace.tsx"),
        source("./assistant/assistant-composer.tsx"),
        source("./assistant/actions/action-approval.tsx"),
        source("./assistant/historical-branch-dialog.tsx"),
        source("./assistant/actions/action-interactions.tsx"),
        source("./assistant/assistant-panel.tsx"),
      ])

    expect(workspace).toContain("useOnlineStatus")
    expect(workspace).toContain('useMediaQuery("(min-width: 768px)")')
    expect(workspace).toContain("railPreference ?? wideRailDefault")
    expect(workspace).toContain("state.models.length > 0")
    expect(workspace).toContain("isOnline")
    expect(workspace).toContain('t("You are offline")')
    expect(workspace).toContain("motion-reduce:scroll-auto")
    expect(workspace).toContain('aria-live="polite"')
    expect(composer).toContain("<SelectGroup>")
    expect(composer).toContain('t("Confirm changes")')
    expect(approval).toContain("approveButtonRef.current?.focus()")
    expect(workspace).toContain("modelReadinessAction")
    expect(history).toContain("rpc.assistant.messages.dataChangesReview")
    expect(history).toContain("rpc.actions.undo.execute")
    expect(history).toContain('t("Study-data review")')
    expect(interactions).toContain("rpc.actions.undo.resolveConflict")
    expect(interactions).toContain('resolution: "keep-current"')
    expect(panel).toContain("assistant-unread-indicator")
    expect(panel).toContain(":last-seen-at")
  })

  test("uses a closed specialized result registry and preserves JSON fallback", async () => {
    const [message, renderer, registry] = await Promise.all([
      source("./assistant/assistant-message.tsx"),
      source("./assistant/assistant-specialized-tool-result.tsx"),
      source("./assistant/tool-result-registry.ts"),
    ])

    expect(message).toContain("usesSpecializedToolResult(toolName)")
    expect(message).toContain("<AssistantSpecializedToolResult")
    expect(message).toContain("trimJson(result)")
    expect(renderer).toContain("useExtracted")
    expect(renderer).toContain('href="/learning"')
    expect(renderer).toContain('aria-live={status === "running"')
    expect(renderer).toContain('t("{progress, number, percent}"')
    expect(renderer).toContain("progress: progress / 100")
    expect(registry).toContain('"learning.mastery.explain": "mastery"')
    expect(registry).toContain('"actions.undo_preview": "undo-compensation"')
  })

  test("keeps retrieval policy truth diagnostic-only and supports offline states", async () => {
    const [search, settings] = await Promise.all([
      source("./projects/project-search.tsx"),
      source(
        "../app/(app)/settings/integrations/retrieval-settings-section.tsx"
      ),
    ])

    for (const file of [search, settings]) {
      expect(file).toContain("useExtracted")
      expect(file).toContain("useOnlineStatus")
    }
    expect(search).toContain('process.env.NODE_ENV === "development"')
    expect(search).toContain("enabled: deferredQuery.length > 0 && isOnline")
    expect(search).toContain('t("Pipeline degraded by policy")')
    expect(search).toContain('t("Open exact source")')
    expect(search).toContain('t("Top result")')
    expect(search).toContain('t("Rank {rank}"')
    expect(settings).toContain("disabled={!isOnline}")
    expect(settings).toContain('t("No retrieval trace yet")')
    expect(settings).toContain('aria-label={t("Loading retrieval readiness")}')
    expect(settings).toContain("placement={data.rerank.placement}")
  })

  test("keeps Media Studio localized, recoverable and offline-safe", async () => {
    const [studio, create, output, copy] = await Promise.all([
      source("./media-studio/media-studio-client.tsx"),
      source("./media-studio/create-artifact-dialog.tsx"),
      source("./media-studio/artifact-output-dialog.tsx"),
      source("./media-studio/media-studio-copy.ts"),
    ])

    expect(studio).toContain("useOnlineStatus")
    expect(studio).toContain('t("You are offline")')
    expect(studio).toContain("disabled={!isOnline")
    expect(studio).toContain('aria-live="polite"')
    expect(create).toContain("useExtracted")
    expect(create).toContain('t("New learning artifact")')
    expect(studio).toContain('key={selectedRevision?.id ?? "no-revision"}')
    expect(output).toContain('role="status"')
    expect(output).toContain("URL.revokeObjectURL")
    expect(copy).toContain("useMediaStudioCopy")
    expect(studio).toContain("overflow-x-auto overflow-y-hidden")
    expect(studio).toContain("acceptVideoExtractionNotice")
    expect(studio).toContain("revokeVideoExtractionNotice")
    expect(studio).toContain("videoExtractionConsent.queryOptions")
    expect(studio).toContain('id="video-audio-fallback"')
    expect(studio).toContain('t("Revision comparison")')
    expect(studio).toContain('t("Revise")')
    expect(create).toContain("parentArtifactRevisionIds")
    expect(create).toContain("templateId")
    expect(create).toContain("placementPreference")
    expect(create).toContain('kind === "audio" || kind === "video"')
  })

  test("keeps floating and tabular actions reachable on narrow screens", async () => {
    const [panel, materials] = await Promise.all([
      source("./assistant/assistant-panel.tsx"),
      source("./materials/materials-table.tsx"),
    ])

    expect(panel).toContain("var(--spacing-tabbar)")
    expect(panel).not.toContain("var(--height-tabbar)")
    expect(materials).toContain("size: medium ? 420 : 240")
    expect(materials).toContain(
      'className="flex min-w-0 items-center gap-1.5 overflow-hidden"'
    )
  })
})
