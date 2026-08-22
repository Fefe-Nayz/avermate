import { describe, expect, test } from "bun:test"
import {
  gradeFieldIsLocked,
  gradeFieldNeedsValidation,
  gradeUpdateInput,
  type GradeEditPatch,
  type GradeManagement,
} from "./grade-management-model"

const patch: GradeEditPatch = {
  name: "Provider title",
  subjectId: "sub_remote",
  value: 14,
  outOf: 20,
  coefficient: 2,
  bonus: 1,
  passedAt: new Date("2026-03-14T12:00:00.000Z"),
  typeId: "type_oral",
  note: "Revise chapter 4",
  excludedFromAverage: true,
  components: [{ name: "Written", value: 10, outOf: 15, coefficient: 1 }],
}

const provider: GradeManagement = {
  mode: "provider",
  syncState: "managed",
  externalId: "remote-1",
  provider: "pronote",
  providerLabel: "Pronote",
  connectionStatus: "active",
  gradesAuthority: true,
  sourceValue: 14,
  sourceOutOf: 20,
  significant: true,
  lockedFields: [
    "name",
    "value",
    "outOf",
    "coefficient",
    "passedAt",
    "subjectId",
    "components",
  ],
  editableFields: ["bonus", "note", "typeId", "excludedFromAverage"],
}

describe("provider-managed grade edits", () => {
  test("sends only local overlays for a provider grade", () => {
    expect(gradeUpdateInput("grade-1", provider, patch)).toEqual({
      gradeId: "grade-1",
      bonus: 1,
      note: "Revise chapter 4",
      typeId: "type_oral",
      excludedFromAverage: true,
    })
  })

  test("keeps the complete patch for a personal grade", () => {
    expect(
      gradeUpdateInput("grade-1", { ...provider, mode: "user" }, patch)
    ).toEqual({ gradeId: "grade-1", ...patch })
  })

  test("uses the field-level lock contract", () => {
    expect(gradeFieldIsLocked(provider, "passedAt")).toBe(true)
    expect(gradeFieldIsLocked(provider, "note")).toBe(false)
    expect(gradeFieldIsLocked(undefined, "passedAt")).toBe(false)
    expect(gradeFieldNeedsValidation(provider, "value")).toBe(false)
    expect(gradeFieldNeedsValidation(provider, "outOf")).toBe(false)
    expect(gradeFieldNeedsValidation(provider, "bonus")).toBe(true)
  })
})

describe("provider-managed grade screens", () => {
  test("loads management metadata before rendering the edit form", async () => {
    const [layout, editPage] = await Promise.all([
      Bun.file(
        new URL("../../app/(app)/grades/[gradeId]/layout.tsx", import.meta.url)
      ).text(),
      Bun.file(
        new URL(
          "../../app/(app)/grades/[gradeId]/edit/page.tsx",
          import.meta.url
        )
      ).text(),
    ])

    expect(layout).toContain("orpc.grades.get.queryOptions")
    expect(editPage).toContain("orpc.grades.get.queryOptions")
    expect(editPage).toContain("management={grade.management}")
    expect(editPage).toContain("excludedFromAverage")
  })

  test("surfaces provider provenance and explicit managed actions", async () => {
    const [form, detailPage] = await Promise.all([
      Bun.file(new URL("./grade-form.tsx", import.meta.url)).text(),
      Bun.file(
        new URL("../../app/(app)/grades/[gradeId]/page.tsx", import.meta.url)
      ).text(),
    ])

    for (const mutation of [
      "dismissManaged",
      "restoreManaged",
      "detachManaged",
    ]) {
      expect(form).toContain(`orpc.grades.${mutation}.mutationOptions`)
    }
    expect(form).toContain("gradeUpdateInput")
    expect(form).toContain("!providerManaged")
    expect(form).toContain("Exclude from averages")
    expect(detailPage).toContain("orpc.grades.get.queryOptions")
    expect(detailPage).toContain("Read-only source fields")
    expect(detailPage).toContain("Primary grade source")
  })
})
