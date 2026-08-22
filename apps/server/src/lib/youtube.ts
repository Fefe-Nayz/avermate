import {
  getVideoDetails as getYoutubeVideoDetails,
  type Subtitle,
  type VideoDetails,
} from "youtube-caption-extractor";
import {
  buildMarkdownDocument,
  IngestError,
  RESPONSE_MAX_BYTES,
} from "./ingest";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_TIMEOUT_MS = 20_000;
const CHAPTER_LINE = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+?)\s*$/;

export interface YoutubeChapter {
  at: number;
  title: string;
}

export interface YoutubeIngestion {
  markdown: string;
  title: string;
  channel: string | null;
  finalUrl: string;
  videoId: string;
  durationSec: number | null;
  chapters: YoutubeChapter[];
  wordCount: number;
  truncated: boolean;
}

interface YoutubeOEmbed {
  title?: string;
  author_name?: string;
}

interface YoutubeCaptionFailure {
  retryable: boolean;
  cause: Error;
}

interface YoutubeFetchDiagnostics {
  captionFailure?: YoutubeCaptionFailure;
}

function youtubeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function parseYoutubeUrl(value: string | URL) {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const hostname = youtubeHostname(url.hostname);
  let candidate: string | null = null;
  if (hostname === "youtu.be") {
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    hostname === "youtube.com" ||
    hostname === "m.youtube.com" ||
    hostname === "music.youtube.com" ||
    hostname === "youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (kind === "shorts" || kind === "embed" || kind === "live") {
        candidate = id ?? null;
      }
    }
  }
  if (!candidate || !VIDEO_ID.test(candidate)) return null;
  return {
    videoId: candidate,
    canonicalUrl: `https://www.youtube.com/watch?v=${candidate}`,
  };
}

function normalizeText(value: string, maxLength = 2_000) {
  return Array.from(
    value
      .replace(/\u0000/g, "")
      .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, maxLength)
    .join("");
}

export function parseYoutubeChapters(
  description: string,
  durationSec?: number | null,
) {
  const candidates: YoutubeChapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const match = line.match(CHAPTER_LINE);
    if (!match) continue;
    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (minutes > 59 || seconds > 59) continue;
    const at = hours * 3_600 + minutes * 60 + seconds;
    const title = normalizeText(match[4] ?? "", 160);
    if (!title || candidates.some((chapter) => chapter.at === at)) continue;
    if (durationSec != null && at > durationSec + 1) continue;
    candidates.push({ at, title });
  }
  candidates.sort((left, right) => left.at - right.at);
  // Match YouTube's own chapter contract: the list begins at 00:00 and has at
  // least three entries. Partial timestamp lists remain ordinary description.
  return candidates.length >= 3 && candidates[0]?.at === 0 ? candidates : [];
}

function secondsFromSubtitle(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function durationFromSubtitles(subtitles: readonly Subtitle[]) {
  if (subtitles.length === 0) return null;
  return Math.ceil(
    subtitles.reduce(
      (maximum, subtitle) =>
        Math.max(
          maximum,
          secondsFromSubtitle(subtitle.start) +
            secondsFromSubtitle(subtitle.dur),
        ),
      0,
    ),
  );
}

function formatTimestamp(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  const remainder = value % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function transcriptMarkdown(
  subtitles: readonly Subtitle[],
  chapters: readonly YoutubeChapter[],
) {
  const groups = new Map<number, string[]>();
  let previousText = "";
  for (const subtitle of subtitles.slice(0, 100_000)) {
    const text = normalizeText(subtitle.text, 8_000);
    if (!text || text === previousText) continue;
    previousText = text;
    const start = secondsFromSubtitle(subtitle.start);
    let groupAt: number;
    if (chapters.length > 0) {
      groupAt = chapters[0]!.at;
      for (const chapter of chapters) {
        if (chapter.at > start) break;
        groupAt = chapter.at;
      }
    } else {
      groupAt = Math.floor(start / 300) * 300;
    }
    const group = groups.get(groupAt) ?? [];
    group.push(text);
    groups.set(groupAt, group);
  }

  const sections = [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([at, lines]) => {
      const chapterTitle = chapters.find((chapter) => chapter.at === at)?.title;
      const heading = chapterTitle
        ? `## ${formatTimestamp(at)} — ${chapterTitle}`
        : `## ${formatTimestamp(at)}`;
      return `${heading}\n\n${lines.join(" ")}`;
    })
    .join("\n\n");
  return chapters.length > 0 ? `[TOC]\n\n${sections}` : sections;
}

function isAllowedYoutubeRequest(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (hostname === "youtubei.googleapis.com" ||
      hostname === "www.youtube.com" ||
      hostname === "youtube.com" ||
      hostname.endsWith(".googlevideo.com"))
  );
}

function isCaptionRequest(url: URL) {
  return (
    url.pathname.includes("/api/timedtext") ||
    url.hostname.toLowerCase().endsWith(".googlevideo.com")
  );
}

function isRetryableYoutubeStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function boundedYoutubeResponse(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RESPONSE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new IngestError("The YouTube response is larger than 5 MiB", false);
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new IngestError("The YouTube response is larger than 5 MiB", false);
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createYoutubeFetcher(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  diagnostics?: YoutubeFetchDiagnostics,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input
          : input,
    );
    if (!isAllowedYoutubeRequest(url)) {
      throw new IngestError("YouTube returned an unsafe external URL", false);
    }
    const captionRequest = isCaptionRequest(url);
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (captionRequest && diagnostics) {
        diagnostics.captionFailure = {
          retryable: true,
          cause:
            error instanceof Error
              ? error
              : new Error("The caption request failed"),
        };
      }
      throw error;
    }
    const bounded = await boundedYoutubeResponse(response);
    if (captionRequest && diagnostics) {
      if (!bounded.ok) {
        diagnostics.captionFailure = {
          retryable: isRetryableYoutubeStatus(bounded.status),
          cause: new Error(`Caption fetch returned HTTP ${bounded.status}`),
        };
      } else {
        const text = await bounded.clone().text();
        if (!text.trim()) {
          diagnostics.captionFailure = {
            retryable: true,
            cause: new Error("Caption fetch returned an empty response"),
          };
        } else {
          try {
            JSON.parse(text);
          } catch (error) {
            diagnostics.captionFailure = {
              retryable: true,
              cause:
                error instanceof Error
                  ? error
                  : new Error("Caption fetch returned invalid JSON"),
            };
          }
        }
      }
    }
    return bounded;
  }) as typeof fetch;
}

async function defaultOEmbed(
  canonicalUrl: string,
  fetcher: typeof fetch,
): Promise<YoutubeOEmbed | null> {
  const url = new URL("https://www.youtube.com/oembed");
  url.searchParams.set("url", canonicalUrl);
  url.searchParams.set("format", "json");
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as YoutubeOEmbed;
  } catch {
    return null;
  }
}

export async function ingestYoutube(
  value: string,
  options: {
    lang?: string;
    now?: Date;
    signal?: AbortSignal;
    fetch?: typeof fetch;
    getVideoDetails?: (options: {
      videoID: string;
      lang?: string;
      fetch?: typeof fetch;
    }) => Promise<VideoDetails>;
    getOEmbed?: (
      canonicalUrl: string,
      fetcher: typeof fetch,
    ) => Promise<YoutubeOEmbed | null>;
  } = {},
): Promise<YoutubeIngestion> {
  const parsed = parseYoutubeUrl(value);
  if (!parsed) throw new IngestError("The YouTube URL is invalid", false);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("YouTube ingestion timed out"),
    YOUTUBE_TIMEOUT_MS,
  );
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();
  try {
    const diagnostics: YoutubeFetchDiagnostics = {};
    const safeFetch = createYoutubeFetcher(
      options.fetch ?? fetch,
      controller.signal,
      diagnostics,
    );
    let details: VideoDetails;
    try {
      details = await (options.getVideoDetails ?? getYoutubeVideoDetails)({
        videoID: parsed.videoId,
        lang: options.lang ?? "fr",
        fetch: safeFetch,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        controller.signal.aborted ||
        /(?:429|408|5\d\d|timed?\s*out|network|fetch)/i.test(message);
      throw new IngestError("The YouTube video could not be read", retryable, {
        cause: error,
      });
    }
    if (details.subtitles.length === 0) {
      if (diagnostics.captionFailure) {
        throw new IngestError(
          "YouTube captions could not be fetched",
          diagnostics.captionFailure.retryable,
          { cause: diagnostics.captionFailure.cause },
        );
      }
      throw new IngestError(
        "This YouTube video has no available captions",
        false,
      );
    }

    const oEmbed = await (options.getOEmbed ?? defaultOEmbed)(
      parsed.canonicalUrl,
      safeFetch,
    );
    const title = normalizeText(
      oEmbed?.title || details.title || "YouTube video",
      160,
    );
    const channel = normalizeText(oEmbed?.author_name ?? "", 160) || null;
    const durationSec = durationFromSubtitles(details.subtitles);
    const chapters = parseYoutubeChapters(details.description, durationSec);
    const transcript = transcriptMarkdown(details.subtitles, chapters);
    const built = buildMarkdownDocument(transcript, {
      title,
      source: parsed.canonicalUrl,
      fetchedAt: options.now ?? new Date(),
      site: "YouTube",
      author: channel,
    });
    return {
      ...built,
      title,
      channel,
      finalUrl: parsed.canonicalUrl,
      videoId: parsed.videoId,
      durationSec,
      chapters,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
