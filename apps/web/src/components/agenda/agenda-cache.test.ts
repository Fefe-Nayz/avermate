import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("agenda cache boundary", () => {
  test("keeps the former landing route as a redirect to the hydrated Planning agenda", async () => {
    const [compatibility, page, client] = await Promise.all([
      source("../../app/(app)/agenda/page.tsx"),
      source("../../app/(app)/planning/agenda/page.tsx"),
      source("../planning/planning-agenda-client.tsx"),
    ])

    expect(compatibility).toContain('redirect("/planning/agenda")')
    expect(page).not.toContain('"use client"')
    expect(page).toContain("prepareAuthenticatedShell")
    expect(page).toContain("planningAssignmentsInput")
    expect(page).toContain("planning.assignments.list.queryOptions")
    expect(page).toContain("HydrateClient")
    expect(client).toContain('"use client"')
    expect(client).toContain("planningAssignmentsInput")
    expect(client).toContain("planning.assignments.list.queryOptions")
  })

  test("agenda reads and writes never couple to the year snapshot", async () => {
    const files = await Promise.all([
      source("./agenda-client.tsx"),
      source("./agenda-board.tsx"),
      source("./planner-item-form.tsx"),
      source("./planner-edit.tsx"),
      source("../../app/(app)/agenda/page.tsx"),
      source("../../app/(app)/agenda/new/page.tsx"),
      source("../../app/(app)/agenda/[itemId]/edit/page.tsx"),
    ])
    const combined = files.join("\n")

    expect(combined).not.toContain(["snapshot", "get"].join("."))
    expect(combined).toContain("orpc.planner.agenda.key()")
    expect(combined).toContain("orpc.planner.list.key()")
  })

  test("the board exposes the repository keyboard-drag pattern", async () => {
    const board = await source("./agenda-board.tsx")

    expect(board).toContain("KeyboardSensor")
    expect(board).toContain("sortableKeyboardCoordinates")
    expect(board).toContain("useSortable")
    expect(board).toContain("data-drag-handle")
    expect(board).toContain('aria-label={t("Move {title}"')
    expect(board).toContain("accessibility={{ announcements }}")
  })
})
