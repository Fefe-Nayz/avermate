import { describe, expect, test } from "bun:test";
import { IngestError } from "./ingest";
import {
  createYoutubeFetcher,
  ingestYoutube,
  parseYoutubeChapters,
  parseYoutubeUrl,
} from "./youtube";

describe("YouTube URL parsing", () => {
  test("accepts canonical, short, Shorts and privacy-enhanced URLs", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=test",
      "https://youtu.be/dQw4w9WgXcQ?t=12",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(parseYoutubeUrl(url)).toEqual({
        videoId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
    }
  });

  test("rejects lookalike hosts, credentials and malformed IDs", () => {
    for (const url of [
      "https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ",
      "https://youtube.com@attacker.example/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=too-short",
      "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(parseYoutubeUrl(url)).toBeNull();
    }
  });
});

describe("YouTube chapters", () => {
  test("uses only complete, ordered chapter lists beginning at zero", () => {
    expect(
      parseYoutubeChapters(
        "00:00 Introduction\n02:15 First proof\n1:03:09 Exercises",
        4_000,
      ),
    ).toEqual([
      { at: 0, title: "Introduction" },
      { at: 135, title: "First proof" },
      { at: 3_789, title: "Exercises" },
    ]);
    expect(parseYoutubeChapters("00:00 Intro\n01:00 End")).toEqual([]);
    expect(
      parseYoutubeChapters("01:00 Not the start\n02:00 Next\n03:00 End"),
    ).toEqual([]);
  });
});

describe("caption-only YouTube ingestion", () => {
  test("builds timestamped Markdown and exposes chapter metadata", async () => {
    const result = await ingestYoutube(
      "https://youtu.be/dQw4w9WgXcQ?si=tracking",
      {
        now: new Date("2026-08-21T10:00:00.000Z"),
        getVideoDetails: async () => ({
          title: "Limits course",
          description:
            "00:00 Introduction\n00:30 Definition\n01:00 Worked example",
          subtitles: [
            { start: "0", dur: "3", text: "Welcome to the course." },
            { start: "31", dur: "4", text: "A limit is a finite value." },
            { start: "62", dur: "3", text: "Let us solve an example." },
          ],
        }),
        getOEmbed: async () => ({
          title: "Limits course",
          author_name: "Maths channel",
        }),
      },
    );
    expect(result).toMatchObject({
      title: "Limits course",
      channel: "Maths channel",
      videoId: "dQw4w9WgXcQ",
      durationSec: 65,
      finalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(result.chapters).toHaveLength(3);
    expect(result.markdown).toContain('site: "YouTube"');
    expect(result.markdown).toContain("[TOC]");
    expect(result.markdown).toContain("## 0:00 — Introduction");
    expect(result.markdown).toContain("## 0:30 — Definition");
    expect(result.markdown).toContain("A limit is a finite value.");
  });

  test("fails honestly when the publisher exposes no captions", async () => {
    await expect(
      ingestYoutube("https://youtube.com/watch?v=dQw4w9WgXcQ", {
        getVideoDetails: async () => ({
          title: "Silent video",
          description: "",
          subtitles: [],
        }),
      }),
    ).rejects.toMatchObject({
      message: "This YouTube video has no available captions",
      retryable: false,
    });
  });

  test("keeps a swallowed transient caption fetch failure retryable", async () => {
    await expect(
      ingestYoutube("https://youtube.com/watch?v=dQw4w9WgXcQ", {
        fetch: (async () =>
          new Response(null, { status: 503 })) as unknown as typeof fetch,
        getVideoDetails: async ({ fetch: safeFetch }) => {
          // The upstream package currently swallows errors from this request
          // and returns an empty subtitle array. Our guarded fetch records the
          // status so the durable job can retry instead of marking it terminal.
          await safeFetch!(
            "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&fmt=json3",
          );
          return {
            title: "Temporarily unavailable captions",
            description: "",
            subtitles: [],
          };
        },
      }),
    ).rejects.toMatchObject({
      message: "YouTube captions could not be fetched",
      retryable: true,
    });
  });

  test("never follows a caption URL outside the YouTube allowlist", async () => {
    const unreachableFetch = (async () => {
      throw new Error("network must not be reached");
    }) as unknown as typeof fetch;
    const safeFetch = createYoutubeFetcher(unreachableFetch);
    await expect(
      safeFetch("https://attacker.example/captions"),
    ).rejects.toBeInstanceOf(IngestError);
  });
});
