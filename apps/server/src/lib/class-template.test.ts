import { describe, expect, test } from "bun:test";
import {
  classTemplateSummary,
  parseClassTemplate,
  sameAcademicDay,
  serializeClassTemplate,
  type ClassTemplate,
} from "./class-template-model";

const template: ClassTemplate = {
  version: 1,
  year: {
    name: "Terminale",
    startsAt: Date.UTC(2026, 8, 1),
    endsAt: Date.UTC(2027, 6, 1),
    scale: 20,
    defaultOutOf: 20,
    passingRatio: 0.5,
    decimals: 2,
  },
  periods: [],
  configuration: {
    subjects: [
      {
        key: "mathematics",
        name: "Mathematics",
        kind: "subject",
        isMain: true,
        coefficient: 1,
        children: [],
      },
    ],
    averages: [],
  },
  source: { kind: "preset", presetId: "fr-terminal", presetVersion: 3 },
};

describe("class templates", () => {
  test("round-trips a validated immutable snapshot", () => {
    const parsed = parseClassTemplate(serializeClassTemplate(template));
    expect(parsed).toEqual(template);
    expect(classTemplateSummary(parsed!)).toMatchObject({
      yearName: "Terminale",
      source: "preset",
      subjectCount: 1,
    });
  });

  test("treats malformed legacy storage as an unconfigured class", () => {
    expect(parseClassTemplate("not json")).toBeNull();
    expect(parseClassTemplate('{"version":2}')).toBeNull();
  });

  test("allows time-of-day drift but rejects a different academic day", () => {
    const start = Date.UTC(2026, 8, 1, 0);
    expect(sameAcademicDay(start, start + 12 * 60 * 60 * 1_000)).toBe(true);
    expect(sameAcademicDay(start, start + 24 * 60 * 60 * 1_000)).toBe(false);
  });
});
