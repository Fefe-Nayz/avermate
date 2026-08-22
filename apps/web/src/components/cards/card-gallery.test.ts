import { describe, expect, test } from "bun:test"

const source = await Bun.file(
  new URL("./card-gallery.tsx", import.meta.url)
).text()

describe("card gallery social slots", () => {
  test("does not start either social query for ordinary templates", () => {
    expect(source).toContain("enabled: needsCohorts")
    expect(source).toContain(
      'useFriends({ enabled: requiredSlotKinds.has("friend") })'
    )
  })

  test("derives friend options from each slot's exact sharing requirement", () => {
    expect(source).toContain("friend: []")
    expect(source).toContain("friendChoices(friends, slot.friendRequirement)")
    expect(source).toContain(
      "resolveSlotMapping(slots, slotOptions, picks, optionsForSlot)"
    )
    expect(source).not.toContain("friend: people.map")
  })

  test("derives classmate options from the selected comparison", () => {
    expect(source).toContain(
      "cohortMemberChoices(cohorts, selectedComparisonId)"
    )
    expect(source).toContain(
      "resolveSlotMapping([cohortSlot], slotOptions, picks)"
    )
    expect(source).not.toContain("[...cohorts.values()].flatMap")
  })

  test("keys picks by kind as well as source id", () => {
    expect(source.match(/templateSlotKey\(slot\)/g)).toHaveLength(3)
    expect(source).not.toContain("next.set(slot.placeholderId")
  })

  test("keeps slot controls touch-sized and exposes why a slot cannot be filled", () => {
    expect(source).toContain('className="min-w-0 flex-1"')
    expect(source).not.toContain('className="h-8 flex-1 md:h-8"')
    expect(source).toContain("aria-describedby={empty ? unfillableHintId")
    expect(source).toContain("aria-describedby={unfillableHintId}")
    expect(source).not.toContain('role="group"')
    expect(source).toContain("disabled={empty}")
  })

  test("uses semantic headings for template tiles", () => {
    expect(source).toContain("<h3 id={titleId}>{template.title}</h3>")
  })
})
