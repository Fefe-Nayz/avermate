import { describe, expect, test } from "bun:test";
import { suggestSchoolYear } from "./year-setup";

describe("suggestSchoolYear", () => {
  test("suggests the current school year when the account is empty", () => {
    expect(suggestSchoolYear("2026-03-12T10:00:00Z")).toEqual({
      name: "2025–2026",
      startDay: "2025-09-01",
      endDay: "2026-07-15",
      scale: 20,
    });
  });

  test("starts the upcoming school year from August onward", () => {
    expect(suggestSchoolYear("2026-08-01T00:00:00Z")).toMatchObject({
      name: "2026–2027",
      startDay: "2026-09-01",
      endDay: "2027-07-15",
    });
  });

  test("follows the newest existing year regardless of picker order", () => {
    expect(
      suggestSchoolYear("2026-03-12T10:00:00Z", [
        {
          startsAt: "2025-09-01T00:00:00Z",
          endsAt: "2026-07-05T23:59:59Z",
          scale: 100,
        },
        {
          startsAt: "2023-08-20T00:00:00Z",
          endsAt: "2024-06-30T23:59:59Z",
          scale: 20,
        },
      ]),
    ).toEqual({
      name: "2026–2027",
      startDay: "2026-09-01",
      endDay: "2027-07-05",
      scale: 100,
    });
  });

  test("preserves custom boundaries and clamps leap days", () => {
    expect(
      suggestSchoolYear("2024-01-01T00:00:00Z", [
        {
          startsAt: "2024-02-29T00:00:00Z",
          endsAt: "2025-01-31T23:59:59Z",
          scale: 20,
        },
      ]),
    ).toMatchObject({
      name: "2025–2026",
      startDay: "2025-02-28",
      endDay: "2026-01-31",
    });
  });

  test("ignores invalid existing ranges and invalid scales", () => {
    expect(
      suggestSchoolYear("2026-09-02T00:00:00Z", [
        { startsAt: "invalid", endsAt: "invalid", scale: 40 },
        {
          startsAt: "2025-09-01T00:00:00Z",
          endsAt: "2026-07-15T00:00:00Z",
          scale: -4,
        },
      ]),
    ).toEqual({
      name: "2026–2027",
      startDay: "2026-09-01",
      endDay: "2027-07-15",
      scale: 20,
    });
  });
});
