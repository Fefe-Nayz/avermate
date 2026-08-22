import { describe, expect, test } from "bun:test";
import type { OpenConnection } from "./provider";
import {
  collectSchoolPlanningSnapshot,
  defaultSchoolSyncWindow,
} from "./school-planning";
import type { SchoolProviderAdapter } from "./school-provider";
import { normalizeSchoolTimezone } from "./school-provider";

const connection: OpenConnection = {
  id: "connection",
  userId: "user",
  yearId: "year",
  baseUrl: "https://school.example",
  credentials: "sealed-open-value",
  caCertPem: null,
};

describe("school planning discovery", () => {
  test("keeps overseas provider time zones instead of forcing Paris", () => {
    expect(normalizeSchoolTimezone("Indian/Reunion")).toBe("Indian/Reunion");
    expect(normalizeSchoolTimezone("America/Guadeloupe")).toBe(
      "America/Guadeloupe",
    );
    expect(
      defaultSchoolSyncWindow(
        new Date("2026-10-25T01:30:00.000Z"),
        "Indian/Reunion",
      ).timezone,
    ).toBe("Indian/Reunion");
    expect(() => normalizeSchoolTimezone("Mars/Olympus_Mons")).toThrow(
      "valid IANA",
    );
  });
  test("aborts and awaits sibling facets before propagating the first failure", async () => {
    let blockingFacetSettled = false;
    const failure = new Error("homework failed");
    const adapter: SchoolProviderAdapter = {
      id: "pronote",
      facets: {
        homework: {
          async list() {
            throw failure;
          },
        },
        timetable: {
          list(_connection, options) {
            return new Promise((resolve) => {
              options.signal?.addEventListener(
                "abort",
                () => {
                  queueMicrotask(() => {
                    blockingFacetSettled = true;
                    resolve([]);
                  });
                },
                { once: true },
              );
            });
          },
        },
      },
    };

    await expect(
      collectSchoolPlanningSnapshot(adapter, connection, {
        window: defaultSchoolSyncWindow(),
      }),
    ).rejects.toBe(failure);
    expect(blockingFacetSettled).toBe(true);
  });

  test("propagates a parent cancellation to every facet", async () => {
    const parent = new AbortController();
    let observedReason: unknown;
    const adapter: SchoolProviderAdapter = {
      id: "skolengo",
      facets: {
        homework: {
          list(_connection, options) {
            return new Promise((resolve) => {
              options.signal?.addEventListener(
                "abort",
                () => {
                  observedReason = options.signal?.reason;
                  resolve([]);
                },
                { once: true },
              );
            });
          },
        },
      },
    };
    const pending = collectSchoolPlanningSnapshot(adapter, connection, {
      signal: parent.signal,
      window: defaultSchoolSyncWindow(),
    });
    const reason = new Error("lease lost");
    parent.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(observedReason).toBe(reason);
  });
});
