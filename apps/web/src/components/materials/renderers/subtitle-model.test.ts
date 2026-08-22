import { describe, expect, test } from "bun:test"
import { formatSubtitleTime, parseSubtitles } from "./subtitle-model"

describe("SRT and WebVTT parsing", () => {
  test("parses both timestamp syntaxes and keeps cue text inert", () => {
    const parsed = parseSubtitles(
      "WEBVTT\n\nintro\n00:01.250 --> 00:03.000 align:start\n<b>Hello</b> &amp; goodbye\n\n2\n01:02:03,004 --> 01:02:04,005\n<script>alert(1)</script>Safe"
    )
    expect(parsed.invalidBlocks).toBe(0)
    expect(parsed.cues).toEqual([
      {
        id: "intro",
        startMs: 1_250,
        endMs: 3_000,
        text: "Hello & goodbye",
      },
      {
        id: "2",
        startMs: 3_723_004,
        endMs: 3_724_005,
        text: "alert(1)Safe",
      },
    ])
  })

  test("counts malformed cues and stops at the explicit limit", () => {
    const parsed = parseSubtitles(
      "bad block\n\n1\n00:00:00,000 --> 00:00:01,000\nOne\n\n2\n00:00:02,000 --> 00:00:03,000\nTwo",
      1
    )
    expect(parsed.cues).toHaveLength(1)
    expect(parsed.invalidBlocks).toBe(1)
    expect(parsed.truncated).toBe(true)
  })

  test("formats a stable timeline label", () => {
    expect(formatSubtitleTime(3_723_004)).toBe("01:02:03.004")
    expect(formatSubtitleTime(1_250)).toBe("00:01.250")
  })
})
