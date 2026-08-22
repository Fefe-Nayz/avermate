import { describe, expect, test } from "bun:test";
import {
  extractAudioSegments,
  isTranscribableMediaMimeType,
  mergeMediaTranscriptionResults,
  transcriptTimestamp,
} from "./transcribe-material-media";

describe("material media transcription", () => {
  test("fails closed instead of invoking ffmpeg in the API process", async () => {
    await expect(
      extractAudioSegments({ source: "untrusted.mp4", directory: "." }),
    ).rejects.toMatchObject({
      name: "NonRetryableJobError",
      message: expect.stringContaining("SANDBOX_EXECUTION_REQUIRED:media"),
    });
  });

  test("recognizes audio and video without accepting arbitrary documents", () => {
    expect(isTranscribableMediaMimeType("audio/mpeg")).toBe(true);
    expect(isTranscribableMediaMimeType("video/mp4")).toBe(true);
    expect(isTranscribableMediaMimeType("application/pdf")).toBe(false);
  });

  test("merges twenty-minute provider chunks into timestamped markdown", () => {
    const result = mergeMediaTranscriptionResults([
      {
        text: "Introduction",
        language: "fr",
        segments: [{ startMs: 2_000, endMs: 6_000, text: "Introduction" }],
      },
      {
        text: "Suite du cours",
        language: "fr",
        segments: [{ startMs: 1_500, endMs: 5_000, text: "Suite du cours" }],
      },
    ]);

    expect(result.language).toBe("fr");
    expect(result.segments[1]?.startMs).toBe(1_201_500);
    expect(result.content).toContain("## 00:00:02\n\nIntroduction");
    expect(result.content).toContain("## 00:20:01\n\nSuite du cours");
  });

  test("formats long recordings with an unbounded hour field", () => {
    expect(transcriptTimestamp(37 * 60 * 60_000 + 62_000)).toBe("37:01:02");
  });
});
