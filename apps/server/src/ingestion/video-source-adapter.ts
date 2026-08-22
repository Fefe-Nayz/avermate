import type {
  VideoSourceResult,
  VideoTranscriptSegment,
} from "@avermate/agent-contracts";
import { videoSourceResultSchema } from "@avermate/agent-contracts";
import {
  ingestYoutube,
  parseYoutubeUrl,
  type YoutubeChapter,
} from "../lib/youtube";
import { AdvancedIngestionError, asAdvancedIngestionError } from "./errors";

export interface VideoCaptionTrack {
  readonly language: string;
  readonly segments: readonly VideoTranscriptSegment[];
  readonly source: "publisher" | "automatic" | "unknown";
}

export interface VideoCaptionMetadata {
  readonly canonicalUrl: string;
  readonly mediaId: string;
  readonly title: string;
  readonly channel: string | null;
  readonly durationMs: number | null;
  readonly chapters: readonly YoutubeChapter[];
  readonly markdown: string;
  readonly wordCount: number;
  readonly truncated: boolean;
  readonly tracks: readonly VideoCaptionTrack[];
}

export interface PlatformCaptionProvider {
  readonly id: string;
  readonly version: string;
  load(input: {
    canonicalUrl: string;
    preferredLanguage: string;
    signal?: AbortSignal;
  }): Promise<VideoCaptionMetadata>;
}

export interface VideoAudioFallbackDispatcher {
  enqueue(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    sourceVersionId: string;
    canonicalUrl: string;
    requestedLanguage: string;
    consentRevision: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<{ jobId: string; placement: "node" | "self-host" }>;
}

export type VideoSourceResolution =
  | {
      readonly status: "ready";
      readonly source: VideoSourceResult;
      readonly markdown: string;
      readonly chapters: readonly YoutubeChapter[];
      readonly wordCount: number;
      readonly truncated: boolean;
    }
  | {
      readonly status: "queued";
      readonly jobId: string;
      readonly placement: "node" | "self-host";
      readonly strategy: "extracted-audio";
    };

function normalizedLanguage(value: string) {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function chooseTrack(
  tracks: readonly VideoCaptionTrack[],
  preferredLanguage: string,
): VideoCaptionTrack | null {
  const preferred = normalizedLanguage(preferredLanguage);
  return (
    tracks.find((track) => normalizedLanguage(track.language) === preferred) ??
    tracks.find(
      (track) =>
        normalizedLanguage(track.language).split("-", 1)[0] ===
        preferred.split("-", 1)[0],
    ) ??
    tracks[0] ??
    null
  );
}

/** Caption-first selection. Audio extraction exists only as an explicit branch. */
export class VideoSourceAdapter {
  constructor(
    private readonly captions: PlatformCaptionProvider,
    private readonly audioFallback?: VideoAudioFallbackDispatcher,
  ) {}

  async ingest(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    sourceVersionId: string;
    url: string;
    preferredLanguage: string;
    requestAudioFallback: boolean;
    consentRevision?: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<VideoSourceResolution> {
    const parsed = parseYoutubeUrl(input.url);
    if (!parsed) {
      throw new AdvancedIngestionError(
        "unsupported_content",
        "Only one public YouTube video is supported by this adapter",
        false,
      );
    }
    let captionFailure: AdvancedIngestionError | null = null;
    try {
      const metadata = await this.captions.load({
        canonicalUrl: parsed.canonicalUrl,
        preferredLanguage: input.preferredLanguage,
        signal: input.signal,
      });
      const selected = chooseTrack(metadata.tracks, input.preferredLanguage);
      if (selected) {
        const source = videoSourceResultSchema.parse({
          strategy: "platform-captions",
          canonicalUrl: metadata.canonicalUrl,
          mediaId: metadata.mediaId,
          title: metadata.title,
          channel: metadata.channel,
          requestedLanguage: normalizedLanguage(input.preferredLanguage),
          selectedLanguage: normalizedLanguage(selected.language),
          languageMismatch:
            normalizedLanguage(selected.language) !==
            normalizedLanguage(input.preferredLanguage),
          durationMs: metadata.durationMs,
          adapterId: this.captions.id,
          adapterVersion: this.captions.version,
          transcriptProvider: null,
          transcriptModel: null,
          segments: selected.segments,
        });
        return {
          status: "ready",
          source,
          markdown: metadata.markdown,
          chapters: metadata.chapters,
          wordCount: metadata.wordCount,
          truncated: metadata.truncated,
        };
      }
      captionFailure = new AdvancedIngestionError(
        "captions_unavailable",
        "This video has no available captions",
        false,
      );
    } catch (error) {
      captionFailure = asAdvancedIngestionError(error, {
        reasonCode: "captions_unavailable",
        retryable: false,
      });
      if (captionFailure.reasonCode !== "captions_unavailable") {
        throw captionFailure;
      }
    }

    if (!input.requestAudioFallback) throw captionFailure;
    if (!input.consentRevision?.trim()) {
      throw new AdvancedIngestionError(
        "permission_required",
        "Audio extraction requires acceptance of the authorized-use notice",
        false,
      );
    }
    if (!this.audioFallback) {
      throw new AdvancedIngestionError(
        "transcription_unavailable",
        "No authorized audio-extraction placement is available",
        false,
      );
    }
    const queued = await this.audioFallback.enqueue({
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      sourceVersionId: input.sourceVersionId,
      canonicalUrl: parsed.canonicalUrl,
      requestedLanguage: input.preferredLanguage,
      consentRevision: input.consentRevision,
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
    });
    return {
      status: "queued",
      jobId: queued.jobId,
      placement: queued.placement,
      strategy: "extracted-audio",
    };
  }
}

/** Compatibility provider: keeps today's caption-only YouTube implementation. */
export class ExistingYoutubeCaptionProvider implements PlatformCaptionProvider {
  readonly id = "youtube-caption-extractor";
  readonly version = "1";

  constructor(
    private readonly dependencies: {
      ingestYoutube?: typeof ingestYoutube;
      now?: () => Date;
      /** The legacy library does not expose the selected track language. */
      selectedLanguage?: (preferredLanguage: string) => string;
    } = {},
  ) {}

  async load(input: {
    canonicalUrl: string;
    preferredLanguage: string;
    signal?: AbortSignal;
  }): Promise<VideoCaptionMetadata> {
    const result = await (this.dependencies.ingestYoutube ?? ingestYoutube)(
      input.canonicalUrl,
      {
        lang: input.preferredLanguage,
        now: this.dependencies.now?.(),
        signal: input.signal,
      },
    );
    return Object.freeze({
      canonicalUrl: result.finalUrl,
      mediaId: result.videoId,
      title: result.title,
      channel: result.channel,
      durationMs:
        result.durationSec === null ? null : Math.round(result.durationSec * 1_000),
      chapters: result.chapters,
      markdown: result.markdown,
      wordCount: result.wordCount,
      truncated: result.truncated,
      tracks: Object.freeze([
        Object.freeze({
          // `und` is intentionally honest: the current dependency does not
          // return which fallback track it selected.
          language:
            this.dependencies.selectedLanguage?.(input.preferredLanguage) ??
            "und",
          source: "unknown" as const,
          segments: result.segments,
        }),
      ]),
    });
  }
}
