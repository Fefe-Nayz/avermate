import { describe, expect, mock, test } from "bun:test";

mock.module("expo-localization", () => ({
  getLocales: () => [{ languageCode: "en" }],
}));

const {
  initialYearSetupPlan,
  isValidYearSetup,
  nativeSchoolYearSuggestion,
  periodDraftsForTemplate,
  periodNamesForTemplate,
  validPeriodDrafts,
  yearSetupHref,
} = await import("./year-setup");

describe("native year setup", () => {
  test("a preset completes onboarding without inventing periods while scratch opens detailed setup", () => {
    expect(initialYearSetupPlan("preset-id")).toEqual({
      completeAfterCreation: true,
      periodTemplate: "none",
    });
    expect(initialYearSetupPlan(null)).toEqual({
      completeAfterCreation: false,
      periodTemplate: "none",
    });
  });

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

  test("builds exact, contiguous and editable period boundaries", () => {
    const periods = periodDraftsForTemplate(
      "trimesters",
      new Date("2026-09-01T12:00:00.000Z"),
      new Date("2027-07-01T12:00:00.000Z"),
    );

    expect(periods).toHaveLength(3);
    expect(periods[0]?.startsAt).toBe("2026-09-01T12:00:00.000Z");
    expect(periods[0]?.endsAt).toBe(periods[1]?.startsAt);
    expect(periods[1]?.endsAt).toBe(periods[2]?.startsAt);
    expect(periods[2]?.endsAt).toBe("2027-07-01T12:00:00.000Z");
    expect(validPeriodDrafts(periods)).toBe(true);
  });

  test("marks only the cumulative semester and validates manual edits", () => {
    const range = {
      startsAt: new Date("2026-09-01T12:00:00.000Z"),
      endsAt: new Date("2027-07-01T12:00:00.000Z"),
    };
    const periods = periodDraftsForTemplate(
      "semesters-cumulative",
      range.startsAt,
      range.endsAt,
    );

    expect(periods.map((period) => period.isCumulative)).toEqual([false, true]);
    expect(validPeriodDrafts([{ ...periods[0]!, name: "" }, periods[1]!])).toBe(
      false,
    );
    expect(validPeriodDrafts([periods[1]!, periods[0]!])).toBe(false);
    expect(
      validPeriodDrafts([
        {
          ...periods[0]!,
          endsAt: periods[0]!.startsAt,
        },
      ]),
    ).toBe(false);
    expect(
      validPeriodDrafts(
        [
          periods[0]!,
          {
            ...periods[1]!,
            startsAt: new Date(
              new Date(periods[0]!.endsAt).getTime() - 86_400_000,
            ).toISOString(),
          },
        ],
        range,
      ),
    ).toBe(false);
    expect(
      validPeriodDrafts(
        [
          {
            ...periods[0]!,
            startsAt: new Date(
              range.startsAt.getTime() - 86_400_000,
            ).toISOString(),
          },
          periods[1]!,
        ],
        range,
      ),
    ).toBe(false);
    expect(
      validPeriodDrafts(
        [
          periods[0]!,
          {
            ...periods[1]!,
            endsAt: new Date(range.endsAt.getTime() + 86_400_000).toISOString(),
          },
        ],
        range,
      ),
    ).toBe(false);
    expect(validPeriodDrafts([], range)).toBe(true);
  });

  test("builds the same targeted resume route for every setup entry point", () => {
    expect(String(yearSetupHref("y_2026/test"))).toBe(
      "/year/y_2026%2Ftest/setup",
    );
  });
});
