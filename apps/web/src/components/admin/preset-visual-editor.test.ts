import { describe, expect, test } from "bun:test"
import {
  PRESET_EDITOR_LIMITS,
  PRESET_GRADE_TYPE_LIMITS,
  presetConfigurationIsValid,
  presetGradeTypeIsValid,
  withoutSubject,
  type PresetEditorConfiguration,
} from "./preset-visual-editor"

/**
 * Removing a subject removes a subject.
 *
 * The editor rebuilt the configuration field by field here — `{subjects, averages}` —
 * so anything else it held was dropped on the way out. Assessment types were the first
 * field to find out: deleting one subject silently emptied the list, and publishing the
 * version afterwards recorded that emptying as the admin's intent, withdrawing the types
 * from every year linked to the preset.
 */
const configuration: PresetEditorConfiguration = {
  subjects: [
    {
      key: "science",
      name: "Science",
      kind: "category",
      isMain: true,
      coefficient: 1,
      children: [
        {
          key: "physics",
          name: "Physics",
          kind: "subject",
          isMain: false,
          coefficient: 3,
          children: [],
        },
      ],
    },
  ],
  averages: [
    {
      key: "science-average",
      name: "Science average",
      isMain: false,
      entries: [
        { subjectKey: "physics", coefficient: null, includeChildren: false },
        { subjectKey: "science", coefficient: null, includeChildren: true },
      ],
    },
  ],
  gradeTypes: [
    {
      key: "type-written",
      name: "DS",
      titlePrefix: "DS ",
      coefficient: 2,
      outOf: 20,
      accent: null,
    },
  ],
}

describe("removing a subject from a preset", () => {
  test("keeps everything the removal was not about", () => {
    const next = withoutSubject(configuration, "physics")

    expect(next?.gradeTypes).toEqual(configuration.gradeTypes)
  })

  test("takes the subject and the entries that named it", () => {
    const next = withoutSubject(configuration, "physics")

    expect(next?.subjects[0]?.children).toEqual([])
    expect(next?.averages[0]?.entries.map((entry) => entry.subjectKey)).toEqual(
      ["science"]
    )
  })

  test("takes a category's children with it", () => {
    const next = withoutSubject(configuration, "science")

    expect(next?.subjects).toEqual([])
    expect(next?.averages[0]?.entries).toEqual([])
    expect(next?.gradeTypes).toEqual(configuration.gradeTypes)
  })

  test("answers nothing for a key it does not hold", () => {
    expect(withoutSubject(configuration, "nowhere")).toBeNull()
  })
})

describe("assessment type validation", () => {
  const type = configuration.gradeTypes?.[0]

  test("accepts the server boundary values", () => {
    expect(type).toBeDefined()
    expect(
      presetGradeTypeIsValid({
        ...type!,
        name: "n".repeat(PRESET_GRADE_TYPE_LIMITS.name),
        titlePrefix: "p".repeat(PRESET_GRADE_TYPE_LIMITS.titlePrefix),
        coefficient: PRESET_GRADE_TYPE_LIMITS.coefficient,
        outOf: PRESET_GRADE_TYPE_LIMITS.outOf,
      })
    ).toBe(true)
  })

  test.each([
    { name: "blank name", patch: { name: "   " } },
    {
      name: "long name",
      patch: { name: "n".repeat(PRESET_GRADE_TYPE_LIMITS.name + 1) },
    },
    {
      name: "long prefix",
      patch: {
        titlePrefix: "p".repeat(PRESET_GRADE_TYPE_LIMITS.titlePrefix + 1),
      },
    },
    {
      name: "large coefficient",
      patch: { coefficient: PRESET_GRADE_TYPE_LIMITS.coefficient + 1 },
    },
    { name: "negative coefficient", patch: { coefficient: -1 } },
    { name: "zero denominator", patch: { outOf: 0 } },
    {
      name: "large denominator",
      patch: { outOf: PRESET_GRADE_TYPE_LIMITS.outOf + 1 },
    },
    { name: "non-finite number", patch: { coefficient: Number.NaN } },
  ])("rejects $name", ({ patch }) => {
    expect(type).toBeDefined()
    expect(presetGradeTypeIsValid({ ...type!, ...patch })).toBe(false)
  })
})

describe("class builder configuration validation", () => {
  test("accepts a complete configuration", () => {
    expect(presetConfigurationIsValid(configuration)).toBe(true)
  })

  test("accepts text and numeric values at the server boundaries", () => {
    const next = structuredClone(configuration)
    const subject = next.subjects[0]
    const average = next.averages[0]
    const type = next.gradeTypes?.[0]
    expect(subject).toBeDefined()
    expect(average).toBeDefined()
    expect(type).toBeDefined()

    subject!.name = "s".repeat(PRESET_EDITOR_LIMITS.subjectName)
    subject!.shortName = "s".repeat(PRESET_EDITOR_LIMITS.subjectShortName)
    subject!.coefficient = PRESET_EDITOR_LIMITS.coefficient
    average!.name = "a".repeat(PRESET_EDITOR_LIMITS.averageName)
    average!.entries[0]!.coefficient = PRESET_EDITOR_LIMITS.coefficient
    type!.accent = "a".repeat(PRESET_EDITOR_LIMITS.accent)

    expect(presetConfigurationIsValid(next)).toBe(true)
  })

  test.each([
    {
      name: "an overlong subject name",
      mutate: (next: PresetEditorConfiguration) => {
        next.subjects[0]!.name = "s".repeat(
          PRESET_EDITOR_LIMITS.subjectName + 1
        )
      },
    },
    {
      name: "an overlong short name",
      mutate: (next: PresetEditorConfiguration) => {
        next.subjects[0]!.shortName = "s".repeat(
          PRESET_EDITOR_LIMITS.subjectShortName + 1
        )
      },
    },
    {
      name: "an oversized subject coefficient",
      mutate: (next: PresetEditorConfiguration) => {
        next.subjects[0]!.coefficient = PRESET_EDITOR_LIMITS.coefficient + 1
      },
    },
    {
      name: "children on a plain subject",
      mutate: (next: PresetEditorConfiguration) => {
        next.subjects[0]!.kind = "subject"
      },
    },
    {
      name: "an overlong average name",
      mutate: (next: PresetEditorConfiguration) => {
        next.averages[0]!.name = "a".repeat(
          PRESET_EDITOR_LIMITS.averageName + 1
        )
      },
    },
    {
      name: "a repeated average entry",
      mutate: (next: PresetEditorConfiguration) => {
        next.averages[0]!.entries[1]!.subjectKey =
          next.averages[0]!.entries[0]!.subjectKey
      },
    },
    {
      name: "an unknown average entry",
      mutate: (next: PresetEditorConfiguration) => {
        next.averages[0]!.entries[0]!.subjectKey = "unknown"
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const next = structuredClone(configuration)
    mutate(next)
    expect(presetConfigurationIsValid(next)).toBe(false)
  })

  test("rejects collections one item beyond each server maximum", () => {
    const subjects = Array.from(
      { length: PRESET_EDITOR_LIMITS.rootSubjects + 1 },
      (_, index) => ({
        key: `subject-${index}`,
        name: `Subject ${index}`,
        kind: "subject" as const,
        isMain: false,
        coefficient: 1,
        children: [],
      })
    )
    expect(
      presetConfigurationIsValid({ subjects, averages: [], gradeTypes: [] })
    ).toBe(false)

    const averages = Array.from(
      { length: PRESET_EDITOR_LIMITS.averages + 1 },
      (_, index) => ({
        key: `average-${index}`,
        name: `Average ${index}`,
        isMain: false,
        entries: [
          {
            subjectKey: "science",
            coefficient: null,
            includeChildren: false,
          },
        ],
      })
    )
    expect(presetConfigurationIsValid({ ...configuration, averages })).toBe(
      false
    )

    const baseType = configuration.gradeTypes?.[0]
    expect(baseType).toBeDefined()
    const gradeTypes = Array.from(
      { length: PRESET_EDITOR_LIMITS.gradeTypes + 1 },
      (_, index) => ({ ...baseType!, key: `type-${index}` })
    )
    expect(presetConfigurationIsValid({ ...configuration, gradeTypes })).toBe(
      false
    )
  })
})
