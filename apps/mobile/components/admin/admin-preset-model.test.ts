import { describe, expect, test } from "bun:test";
import {
  addPresetSubject,
  EMPTY_PRESET_CONFIGURATION,
  flattenPresetSubjects,
  presetConfigurationProblems,
  removePresetSubject,
} from "./admin-preset-model";

describe("native managed preset editor model", () => {
  test("keeps stable keys while nesting new subjects", () => {
    const next = addPresetSubject(
      EMPTY_PRESET_CONFIGURATION.subjects,
      "first-subject",
      {
        key: "child",
        name: "Child",
        kind: "subject",
        isMain: false,
        coefficient: 1,
        children: [],
      },
    );
    expect(
      flattenPresetSubjects(next).map(({ subject }) => subject.key),
    ).toEqual(["first-subject", "child"]);
    expect(next[0]?.kind).toBe("category");
  });

  test("removes dangling average entries with a deleted subtree", () => {
    const configuration = {
      subjects: EMPTY_PRESET_CONFIGURATION.subjects,
      averages: [
        {
          key: "headline",
          name: "Headline",
          isMain: true,
          entries: [
            {
              subjectKey: "first-subject",
              coefficient: null,
              includeChildren: false,
            },
          ],
        },
      ],
    };
    const next = removePresetSubject(configuration, "first-subject");
    expect(next.subjects).toEqual([]);
    expect(next.averages).toEqual([]);
  });

  test("finds duplicate keys and invalid average references before publish", () => {
    const problems = presetConfigurationProblems({
      subjects: [
        ...EMPTY_PRESET_CONFIGURATION.subjects,
        ...EMPTY_PRESET_CONFIGURATION.subjects,
      ],
      averages: [
        {
          key: "invalid",
          name: "Invalid",
          isMain: false,
          entries: [
            {
              subjectKey: "missing",
              coefficient: null,
              includeChildren: false,
            },
          ],
        },
      ],
    });
    expect(problems.some((problem) => problem.includes("Duplicate"))).toBe(
      true,
    );
    expect(problems.some((problem) => problem.includes("missing"))).toBe(true);
  });

  test("matches server coefficient and average-entry constraints", () => {
    const problems = presetConfigurationProblems({
      subjects: [
        {
          ...EMPTY_PRESET_CONFIGURATION.subjects[0]!,
          coefficient: 1001,
        },
      ],
      averages: [
        {
          key: "headline",
          name: "Headline",
          isMain: true,
          entries: [
            {
              subjectKey: "first-subject",
              coefficient: null,
              includeChildren: false,
            },
            {
              subjectKey: "first-subject",
              coefficient: null,
              includeChildren: false,
            },
          ],
        },
      ],
    });
    expect(problems.some((problem) => problem.includes("coefficient"))).toBe(
      true,
    );
    expect(problems.some((problem) => problem.includes("repeats"))).toBe(true);
  });

  test("rejects an empty scratch configuration", () => {
    expect(
      presetConfigurationProblems({ subjects: [], averages: [] }),
    ).toContain("At least one subject is required");
  });
});
