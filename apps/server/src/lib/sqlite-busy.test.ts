import { describe, expect, test } from "bun:test";
import { isSqliteBusyError, retrySqliteBusy } from "./sqlite-busy";

describe("SQLite busy retry", () => {
  test("recognizes libSQL errors through the Drizzle cause chain", () => {
    expect(
      isSqliteBusyError({
        cause: {
          code: "SQLITE_BUSY",
          extendedCode: "SQLITE_BUSY_SNAPSHOT",
        },
      }),
    ).toBe(true);
    expect(isSqliteBusyError({ code: "SQLITE_CONSTRAINT" })).toBe(false);
  });

  test("retries contention with bounded caller-controlled delays", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await retrySqliteBusy(
      async () => {
        attempts += 1;
        if (attempts < 3) throw { code: "SQLITE_BUSY" };
        return "scheduled";
      },
      {
        delaysMs: [10, 20],
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toBe("scheduled");
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  test("does not retry unrelated failures or exceed its retry budget", async () => {
    const unrelated = new Error("invalid job payload");
    let unrelatedAttempts = 0;
    await expect(
      retrySqliteBusy(
        async () => {
          unrelatedAttempts += 1;
          throw unrelated;
        },
        { delaysMs: [0], sleep: async () => undefined },
      ),
    ).rejects.toBe(unrelated);
    expect(unrelatedAttempts).toBe(1);

    const busy = { code: "SQLITE_BUSY" };
    let busyAttempts = 0;
    await expect(
      retrySqliteBusy(
        async () => {
          busyAttempts += 1;
          throw busy;
        },
        { delaysMs: [0, 0], sleep: async () => undefined },
      ),
    ).rejects.toBe(busy);
    expect(busyAttempts).toBe(3);
  });
});
