import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("classes social flow", () => {
  test("class creation is a full-page flow with an existing-year and editable-builder path", async () => {
    const [list, creation] = await Promise.all([
      source("./(active)/groups/groups-client.tsx"),
      source("./(form)/groups/new/class-creation-form.tsx"),
    ])

    expect(list).toContain('href="/social/groups/new"')
    expect(list).toContain(
      "Create a class from an existing year or a new model"
    )
    expect(list).not.toContain("<Dialog")
    expect(list).not.toContain("mutationOptions")

    expect(creation).toContain("<FormFlow")
    expect(creation).toContain('t("Use one of my years")')
    expect(creation).toContain('t("Build the class model")')
    expect(creation).toContain('{ mode: "year", yearId: selectedYearId }')
    expect(creation).toContain('mode: "builder"')
    expect(creation).toContain('mode: "custom"')
    expect(creation).toContain('mode: "template"')
    expect(creation).toContain('value: "custom"')
    expect(creation).toContain("<PeriodDraftEditor")
    expect(creation).toContain("periodDraftProblems")
    expect(creation).toContain("<PresetVisualEditor")
    expect(creation).toContain("showStableKeys={false}")
    expect(creation).toContain(
      "passingRatio: numericPassingGrade / numericScale"
    )
    expect(creation).toContain("sm:grid-cols-[repeat(2,minmax(0,1fr))]")
    expect(creation).not.toContain("periodTemplateId")
    expect(creation).not.toContain("new-group-kind")
    expect(creation).not.toContain("Friends group")
    expect(creation).not.toContain("Study group")
  })

  test("preset choices stay inside responsive grid tracks without truncating names", async () => {
    const presetUi = await source("../../../components/presets/preset-ui.tsx")

    expect(presetUi).toContain("flex h-full w-full min-w-0 flex-col")
    expect(presetUi).toContain(
      "min-w-0 flex-1 font-medium break-words whitespace-normal"
    )
    expect(presetUi).toContain(
      "text-sm leading-relaxed break-words whitespace-normal"
    )
  })

  test("an invitation connects a compatible year or creates a fresh copy", async () => {
    const screen = await source(
      "./(invitation)/invitations/[token]/group-invitation-client.tsx"
    )

    expect(screen).toContain('mode: "existing", yearId: selectedYearId')
    expect(screen).toContain('mode: "copy", name: resolvedCopyName.trim()')
    expect(screen).toContain('t("Sharing stays off")')
    expect(screen).not.toContain('mode: "later"')
    expect(screen).not.toContain('t("Join the group")')
  })

  test("class details lead with the fixed model and explicit linked year", async () => {
    const screen = await source(
      "./(active)/groups/[groupId]/group-detail-client.tsx"
    )

    expect(screen).toContain('title={t("Class model")}')
    expect(screen).toContain('title={t("Your year in this class")}')
    expect(screen).toContain("orpc.social.groups.selectYear")
    expect(screen).toContain("orpc.social.groups.adoptSetup")
    expect(screen).toContain('group.viewer.yearStatus !== "connected"')
    expect(screen).toContain("group.availableSubjectOptions.map")
    expect(screen).toContain("subjectKey:")
    expect(screen).not.toContain("PresetVisualEditor")
    expect(screen).not.toContain("sharedSetupConfig")
    expect(screen).not.toContain('label: t("Goals achieved")')
  })

  test("only owners can create class invitation links", async () => {
    const screen = await source(
      "./(active)/groups/[groupId]/group-detail-client.tsx"
    )

    expect(screen).toContain("{isOwner && template && !frozen ? (")
    expect(screen).toContain("orpc.social.groups.invitations.create")
    expect(screen).toContain('title={t("Invite classmates")}')
  })
})
