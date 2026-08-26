import { describe, expect, test } from "bun:test"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("production Web surfaces", () => {
  test("keeps the assistant unavailable states safe and accessible", async () => {
    const [
      workspace,
      pane,
      header,
      composer,
      approval,
      history,
      interactions,
      panel,
    ] = await Promise.all([
      source("./assistant/assistant-workspace.tsx"),
      source("./assistant/assistant-conversation-pane.tsx"),
      source("./assistant/assistant-conversation-header.tsx"),
      source("./assistant/assistant-composer.tsx"),
      source("./assistant/actions/action-approval.tsx"),
      source("./assistant/historical-branch-dialog.tsx"),
      source("./assistant/actions/action-interactions.tsx"),
      source("./assistant/assistant-panel.tsx"),
    ])

    // The shell keeps only the shell: which of the three right-hand states to
    // show, and whether the rail is open.
    // The rail reads this element's width, not the window's. The assistant
    // also runs as a ~500px side panel, where every viewport test answered
    // "desktop": the rail planted itself at a static 288px and left the
    // conversation 212px, one word per line. Same 768px threshold, container
    // side — measured 500px container, viewport untouched at 1100.
    expect(workspace).toContain("useContainerWidth(rootRef)")
    expect(workspace).toContain("containerWidth >= 768")
    expect(workspace).toContain("@3xl:static")
    expect(workspace).not.toContain("md:static")
    expect(workspace).toContain("railPreference ?? wideRailDefault")

    // Everything about one conversation moved to the pane. Online state, the
    // three blocking conditions and the reduced-motion scroll came with it.
    expect(pane).toContain("useOnlineStatus")
    expect(pane).toContain("paneStatus({")
    expect(pane).toContain("modelCount: state.models.length")
    expect(pane).toContain("motion-reduce:scroll-auto")

    // The pane used to stack an error strip, an offline alert and a
    // no-model alert; `paneStatus` now picks exactly one and is tested on its
    // own. What matters here is that the pane renders that one and no more.
    expect(pane).toContain("status.notice ? (")
    expect(pane.match(/<ConversationNotice/g)).toHaveLength(1)

    // And the composer is mounted unconditionally. It used to disappear when
    // the reader went offline, taking the draft with it; it is disabled with a
    // reason instead, which is what `blockedReason` carries.
    expect(pane).toContain("blockedReason={blockedReason}")
    expect(composer).toContain("blockedReason")
    expect(header).toContain('aria-live="polite"')
    // The model choice stayed in the composer but stopped being a bare
    // <Select>; the approval mode left it entirely for the conversation
    // header, where a disclosure about what the assistant may do belongs.
    expect(composer).toContain("<ModelPicker")
    expect(header).toContain("<SafetyDisclosure")
    expect(header).toContain('t("Ask before changing")')
    expect(approval).toContain("approveButtonRef.current?.focus()")
    // Routing a reader whose models are all unavailable moved out of the
    // pane and is now ranked and unit-tested in `assistant-pane-status`.
    expect(pane).toContain("readinessDestination(notice.reasons)")
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
    const [studio, create, output, copy, detail, activity] = await Promise.all([
      source("./media-studio/media-studio-client.tsx"),
      source("./media-studio/create-artifact-dialog.tsx"),
      source("./media-studio/artifact-output-dialog.tsx"),
      source("./media-studio/media-studio-copy.ts"),
      source("./media-studio/artifact-detail-panel.tsx"),
      source("./media-studio/workflow-activity-panel.tsx"),
    ])

    expect(studio).toContain("useOnlineStatus")
    expect(studio).toContain('t("You are offline")')
    expect(studio).toContain("disabled={!isOnline")
    expect(activity).toContain('aria-live="polite"')
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
    // The artifact pane moved out of the studio screen into its own file; it
    // was three hundred and fifty lines twenty-five levels deep in there.
    expect(detail).toContain('t("Comparing two versions")')
    expect(detail).toContain('t("Revise")')
    expect(create).toContain("parentArtifactRevisionIds")
    expect(create).toContain("templateId")
    expect(create).toContain("placementPreference")
    expect(create).toContain('kind === "audio" || kind === "video"')
  })

  test("keeps floating and tabular actions reachable on narrow screens", async () => {
    const [panel, materials, header] = await Promise.all([
      source("./assistant/assistant-panel.tsx"),
      source("./materials/materials-table.tsx"),
      source("./shell/site-header.tsx"),
    ])

    // The tab-bar offset used to keep a floating pill clear of the mobile tab
    // bar. There is no floating pill: the trigger is a header button at every
    // width, which is both what was asked for and why nothing needs to dodge
    // the tab bar any more. What must hold is that the trigger is not inside
    // the cluster that folds away below 1001px, or a phone cannot open the
    // assistant at all.
    expect(panel).toContain("export function AssistantPanelTrigger")
    expect(panel).not.toContain("var(--spacing-tabbar)")
    // Rendered before the cluster opens, so it survives the fold.
    const trigger = header.indexOf("<AssistantPanelTrigger />")
    const foldingCluster = header.indexOf('className="hidden items-center')
    expect(trigger).toBeGreaterThan(-1)
    expect(trigger).toBeLessThan(foldingCluster)
    expect(materials).toContain("size: medium ? 420 : 240")
    // `flex-wrap` is the load-bearing word here. Without it the file name was
    // the only shrinkable item on the row, so a long status badge squeezed it
    // to zero width — measured at 390px — and the row showed a badge and no
    // file name.
    expect(materials).toContain(
      'className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden"'
    )
  })
})
