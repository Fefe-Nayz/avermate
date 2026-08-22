import { describe, expect, test } from "bun:test";
import { parseSandboxConformanceArgs } from "./sandbox-conformance";

describe("sandbox conformance CLI", () => {
  test("maps required advanced-media profiles onto live sandbox profiles", () => {
    const parsed = parseSandboxConformanceArgs([
      "--",
      "--require-live",
      "--profile",
      "web-render.v1",
      "--profile",
      "video-audio-extract.v1",
      "--profile",
      "ffmpeg-render.v1",
    ]);

    expect(parsed.requireLive).toBe(true);
    expect(parsed.requestedProfiles).toEqual([
      "web-render.v1",
      "video-audio-extract.v1",
      "ffmpeg-render.v1",
    ]);
    expect(parsed.requiredProfileIds).toEqual(["browser", "media"]);
    expect(
      parseSandboxConformanceArgs(["--profile", "web-render.v1"]).requireLive,
    ).toBe(true);
  });

  test("rejects live mode without profiles and any mock live claim", () => {
    expect(() => parseSandboxConformanceArgs(["--require-live"])).toThrow(
      "SANDBOX_CONFORMANCE_LIVE_PROFILES_REQUIRED",
    );
    expect(() =>
      parseSandboxConformanceArgs(["--mock", "--profile", "web-render.v1"]),
    ).toThrow("SANDBOX_CONFORMANCE_MOCK_CANNOT_SATISFY_LIVE_PROFILES");
  });

  test("rejects missing and unknown profile values", () => {
    expect(() => parseSandboxConformanceArgs(["--profile"])).toThrow(
      "SANDBOX_CONFORMANCE_PROFILE_VALUE_REQUIRED",
    );
    expect(() =>
      parseSandboxConformanceArgs(["--profile", "unreviewed.v1"]),
    ).toThrow("SANDBOX_CONFORMANCE_PROFILE_UNKNOWN:unreviewed.v1");
  });
});
