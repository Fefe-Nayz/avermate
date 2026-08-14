import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("widget editor route ownership", () => {
  test("the dashboard editor rejects cards from another surface", () => {
    const route = readFileSync(
      new URL(
        "../../app/(app)/dashboard/cards/[cardId]/page.tsx",
        import.meta.url
      ),
      "utf8"
    )

    expect(route).toContain('item.surface === "overview"')
    expect(route).toContain("notFound()")
  })
})
