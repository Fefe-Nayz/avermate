import { videoAudioExtractWorkerInputSchema } from "@avermate/agent-contracts";
import { parseYoutubeUrl } from "../../lib/youtube";

/** Worker-only fixed argv. No caller-controlled flag or output template enters it. */
export function youtubeDlArgumentVector(value: unknown): readonly string[] {
  const input = videoAudioExtractWorkerInputSchema.parse(value);
  const parsed = parseYoutubeUrl(input.canonicalUrl);
  if (!parsed || input.provider !== "youtube") {
    throw new Error("VIDEO_PROVIDER_NOT_ALLOWED");
  }
  const maximum = `${input.maxDownloadBytes}`;
  return Object.freeze([
    "--no-config",
    "--no-playlist",
    "--no-warnings",
    "--no-call-home",
    "--no-write-info-json",
    "--no-write-thumbnail",
    "--no-write-subs",
    "--no-cookies-from-browser",
    "--max-filesize",
    maximum,
    "--match-filter",
    `duration <= ${input.maxDurationSeconds} & !is_live`,
    "--format",
    "bestaudio[protocol^=https]/bestaudio",
    "--output",
    "/workspace/tmp/source.%(ext)s",
    "--",
    parsed.canonicalUrl,
  ]);
}

/** Second, network-off stage; the discovered input path is validated by the worker. */
export function ffmpegAudioTranscodeArgumentVector(inputPath: string) {
  if (!/^\/workspace\/tmp\/source\.[a-zA-Z0-9]{1,12}$/u.test(inputPath)) {
    throw new Error("VIDEO_INPUT_PATH_INVALID");
  }
  return Object.freeze([
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    "/workspace/output/audio.wav",
  ]);
}
