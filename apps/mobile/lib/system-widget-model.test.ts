import { describe, expect, test } from "bun:test";
import {
  buildSystemWidgetPayload,
  parseSystemWidgetPreference,
  serializeSystemWidgetPayload,
} from "./system-widget-model";

describe("system widget privacy boundary", () => {
  test("is opt-in and emits no academic value while disabled", () => {
    const payload = buildSystemWidgetPayload(
      { enabled: false, mode: "balanced" },
      {
        averageRatio: 0.775,
        scale: 20,
        decimals: 2,
        gradeCount: 18,
        activityStreak: 4,
        updatedAt: new Date("2026-08-11T12:00:00Z"),
      },
      "en",
    );

    expect(payload.state).toBe("disabled");
    expect(payload.containsAcademicData).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("15.50");
    expect(JSON.stringify(payload)).not.toContain("18");
  });

  test("only exposes aggregate values after device consent", () => {
    const payload = buildSystemWidgetPayload(
      { enabled: true, mode: "balanced" },
      {
        averageRatio: 0.775,
        scale: 20,
        decimals: 2,
        gradeCount: 18,
        activityStreak: 4,
        updatedAt: new Date("2026-08-11T12:00:00Z"),
      },
      "fr",
    );

    expect(payload.state).toBe("ready");
    expect(payload.primary).toContain("15,50/20");
    expect(payload.secondary).toBe("4");
    expect(payload.containsAcademicData).toBe(true);
  });

  test("final serialization is an allow-list and cannot leak social data", () => {
    const unsafe = {
      ...buildSystemWidgetPayload(
        { enabled: true, mode: "average" },
        {
          averageRatio: 0.8,
          scale: 20,
          decimals: 1,
          gradeCount: 3,
          activityStreak: 1,
          updatedAt: new Date("2026-08-11T12:00:00Z"),
        },
        "en",
      ),
      friendName: "Private Friend",
      className: "Secret Class",
      gradeRows: [{ subject: "Maths", ratio: 0.8 }],
    };

    const serialized = serializeSystemWidgetPayload(unsafe);
    expect(serialized).not.toHaveProperty("friendName");
    expect(serialized).not.toHaveProperty("className");
    expect(serialized).not.toHaveProperty("gradeRows");
  });

  test("rejects malformed stored settings with a fail-closed default", () => {
    expect(parseSystemWidgetPreference("not-json")).toEqual({
      enabled: false,
      mode: "balanced",
    });
    expect(parseSystemWidgetPreference('{"enabled":true,"mode":"weird"}')).toEqual({
      enabled: true,
      mode: "balanced",
    });
  });
});
