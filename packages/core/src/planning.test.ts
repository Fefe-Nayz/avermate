import { describe, expect, test } from "bun:test";
import {
  expandTimetableRecurrence,
  isoDateInTimeZone,
  lockedPlanningFields,
  planningManagement,
  zonedDateTimeToDate,
  zonedDayRange,
} from "./planning";

describe("planning management", () => {
  test("keeps imported assignment content locked but local state editable", () => {
    const management = planningManagement("assignment", {
      sourceConnectionId: "connection-1",
      externalId: "homework-1",
      syncState: "managed",
    });
    expect(management).toMatchObject({
      mode: "provider",
      editableFields: ["localNote", "startsAt", "completed"],
    });
    expect(management.lockedFields).toContain("title");
    expect(
      lockedPlanningFields("assignment", management, ["title", "localNote"]),
    ).toEqual(["title"]);
  });

  test("makes detached resources wholly user-managed", () => {
    const management = planningManagement("event", {
      sourceConnectionId: null,
      externalId: null,
      syncState: "detached",
    });
    expect(management.mode).toBe("user");
    expect(management.lockedFields).toEqual([]);
    expect(management.editableFields).toContain("startsAt");
  });
});

describe("timetable recurrence", () => {
  test("expands alternate teaching weeks without drifting weekdays", () => {
    expect(
      expandTimetableRecurrence(
        {
          frequency: "weekly",
          interval: 2,
          weekdays: [1, 3],
          startsOn: "2027-01-04",
          endsOn: "2027-01-31",
        },
        "2027-01-01",
        "2027-01-31",
      ),
    ).toEqual(["2027-01-04", "2027-01-06", "2027-01-18", "2027-01-20"]);
  });

  test("respects a bounded daily recurrence", () => {
    expect(
      expandTimetableRecurrence(
        {
          frequency: "daily",
          interval: 2,
          weekdays: [],
          startsOn: "2027-02-01",
          endsOn: "2027-02-06",
        },
        "2027-02-02",
        "2027-02-28",
      ),
    ).toEqual(["2027-02-03", "2027-02-05"]);
  });
});

describe("planning timezone helpers", () => {
  test("keeps the intended wall time across a DST offset", () => {
    const instant = zonedDateTimeToDate(
      "2027-03-29",
      8 * 60 + 30,
      "Europe/Paris",
    );
    expect(instant.toISOString()).toBe("2027-03-29T06:30:00.000Z");
    expect(isoDateInTimeZone(instant, "Europe/Paris")).toBe("2027-03-29");
  });

  test("builds a 23-hour spring-forward day", () => {
    const range = zonedDayRange("2027-03-28", "Europe/Paris");
    expect(range.to.getTime() - range.from.getTime() + 1).toBe(
      23 * 60 * 60 * 1_000,
    );
  });
});
