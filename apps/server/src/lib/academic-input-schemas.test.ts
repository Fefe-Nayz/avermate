import { describe, expect, test } from "bun:test";
import {
  gradeCreateInputSchema,
  gradePatchInputSchema,
  gradeTypeCreateInputSchema,
  gradeTypePatchInputSchema,
} from "./academic-input-schemas";

describe("academic create and patch schemas", () => {
  test("defaults new grades without manufacturing omitted patch fields", () => {
    const required = {
      name: "Algebra",
      value: 16,
      outOf: 20,
      passedAt: new Date("2026-03-01T12:00:00.000Z"),
      subjectId: "subject-a",
    };

    expect(gradeCreateInputSchema.parse(required)).toMatchObject({
      coefficient: 1,
      note: null,
      periodId: null,
      typeId: null,
      components: [],
    });
    expect(gradePatchInputSchema.parse({ name: "Renamed" })).toEqual({
      name: "Renamed",
    });
  });

  test("defaults new grade types without resetting partial updates", () => {
    expect(gradeTypeCreateInputSchema.parse({ name: "Written exam" })).toEqual({
      name: "Written exam",
      titlePrefix: "",
      coefficient: 1,
      outOf: 20,
      accent: null,
    });
    expect(gradeTypePatchInputSchema.parse({ name: "Renamed exam" })).toEqual({
      name: "Renamed exam",
    });
  });
});
