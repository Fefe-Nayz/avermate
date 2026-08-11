import { describe, expect, mock, test } from "bun:test";

mock.module("expo-localization", () => ({
  getLocales: () => [{ languageCode: "en" }],
}));

const { isValidYearSetup, nativeSchoolYearSuggestion, periodNamesForTemplate } =
  await import("./year-setup");

describe("native year setup", () => {
  test("uses the same cumulative period meaning as the web wizard", () => {
    expect(periodNamesForTemplate("semesters-cumulative")).toEqual([
      "Semester 1",
      "Whole year",
    ]);
  });

  test("rejects invalid ranges and grading scales before calling the API", () => {
    const start = new Date("2026-09-01T12:00:00");
    const end = new Date("2027-07-15T12:00:00");

    expect(isValidYearSetup("2026–2027", start, end, "20")).toBe(true);
    expect(isValidYearSetup("", start, end, "20")).toBe(false);
    expect(isValidYearSetup("2026–2027", end, start, "20")).toBe(false);
    expect(isValidYearSetup("2026–2027", start, end, "-20")).toBe(false);
    expect(isValidYearSetup("2026–2027", start, end, "1001")).toBe(false);
  });

  test("turns the shared calendar-day suggestion into stable native dates", () => {
    const result = nativeSchoolYearSuggestion(
      new Date("2026-02-01T00:00:00Z"),
      [
        {
          startsAt: "2025-09-01T00:00:00Z",
          endsAt: "2026-07-15T00:00:00Z",
          scale: 20,
        },
      ],
    );

    expect(result).toMatchObject({
      name: "2026–2027",
      startDay: "2026-09-01",
      endDay: "2027-07-15",
      scale: 20,
    });
    expect(result.startsAt.getHours()).toBe(12);
    expect(result.endsAt.getHours()).toBe(12);
  });
});
