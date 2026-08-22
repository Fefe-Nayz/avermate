import { describe, expect, test } from "bun:test"
import {
  linkedSubjectMappings,
  localSubjectSelectOptions,
  subjectMappingReviewCounts,
  subjectMappingsNeedingReview,
} from "./school-subject-mapping-model"

describe("school subject mapping review", () => {
  const mappings = [
    {
      providerSubjectExternalId: "math",
      matchStatus: "mapped" as const,
      subjectId: "local-math",
    },
    {
      providerSubjectExternalId: "physics",
      matchStatus: "unmatched" as const,
      subjectId: null,
    },
    {
      providerSubjectExternalId: "history-a",
      matchStatus: "ambiguous" as const,
      subjectId: null,
    },
    {
      providerSubjectExternalId: "history-b",
      matchStatus: "ambiguous" as const,
      subjectId: null,
    },
    {
      providerSubjectExternalId: "deleted-local",
      matchStatus: "mapped" as const,
      subjectId: null,
    },
  ]

  test("reviews unresolved rows, including mappings whose local subject was deleted", () => {
    expect(
      subjectMappingsNeedingReview(mappings).map(
        (mapping) => mapping.providerSubjectExternalId
      )
    ).toEqual(["physics", "history-a", "history-b", "deleted-local"])
    expect(
      linkedSubjectMappings(mappings).map(
        (mapping) => mapping.providerSubjectExternalId
      )
    ).toEqual(["math"])
    expect(subjectMappingReviewCounts(mappings)).toEqual({
      unmatched: 2,
      ambiguous: 2,
    })
  })

  test("disambiguates same-name local subjects in the select", () => {
    const options = localSubjectSelectOptions([
      {
        id: "science-category",
        name: "Sciences",
        shortName: null,
        parentId: null,
        kind: "category",
      },
      {
        id: "physics-general",
        name: "Physique",
        shortName: "PHY",
        parentId: null,
        kind: "subject",
      },
      {
        id: "physics-specialty",
        name: "Physique",
        shortName: "SPC",
        parentId: "science-category",
        kind: "subject",
      },
      {
        id: "mathematics",
        name: "Mathématiques",
        shortName: null,
        parentId: null,
        kind: "subject",
      },
    ])

    expect(options.map((option) => option.value)).toEqual([
      "physics-general",
      "physics-specialty",
      "mathematics",
    ])
    expect(options[0]?.label).not.toBe(options[1]?.label)
    expect(options[1]?.label).toContain("Sciences")
    expect(options[2]?.label).toBe("Mathématiques")
  })

  test("uses the full stable id only when contextual labels still collide", () => {
    const options = localSubjectSelectOptions([
      {
        id: "subject-aaaa-one",
        name: "Physique",
        shortName: "PHY",
        parentId: null,
        kind: "subject",
      },
      {
        id: "subject-aaaa-two",
        name: "Physique",
        shortName: "PHY",
        parentId: null,
        kind: "subject",
      },
    ])

    expect(options[0]?.label).toContain("subject-aaaa-one")
    expect(options[1]?.label).toContain("subject-aaaa-two")
    expect(options[0]?.label).not.toBe(options[1]?.label)
  })
})
