import type {
  AdvancedMediaCapability,
  AdvancedMediaProfile,
  SandboxProfileId,
} from "@avermate/agent-contracts";

export interface AdvancedMediaExecutionProfile {
  readonly id: AdvancedMediaProfile;
  readonly capability: AdvancedMediaCapability;
  readonly sandboxProfileId: SandboxProfileId;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly outputPaths: readonly string[];
}

export const ADVANCED_MEDIA_EXECUTION_PROFILES = Object.freeze({
  "web-render.v1": Object.freeze({
    id: "web-render.v1",
    capability: "dynamicWebRendering",
    sandboxProfileId: "browser",
    executable: "/opt/avermate/bin/browser-capture",
    argv: Object.freeze([
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/render.json",
    ]),
    outputPaths: Object.freeze(["output/render.json"]),
  }),
  "video-audio-extract.v1": Object.freeze({
    id: "video-audio-extract.v1",
    capability: "videoAudioExtraction",
    sandboxProfileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: Object.freeze([
      "extract-video-audio",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/audio.wav",
      "--manifest",
      "/workspace/output/extraction.json",
    ]),
    outputPaths: Object.freeze([
      "output/audio.wav",
      "output/extraction.json",
    ]),
  }),
  "ffmpeg-render.v1": Object.freeze({
    id: "ffmpeg-render.v1",
    capability: "mediaTimelineRendering",
    sandboxProfileId: "media",
    executable: "/opt/avermate/bin/media-build",
    argv: Object.freeze([
      "render-timeline",
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/video.mp4",
      "--manifest",
      "/workspace/output/render.json",
    ]),
    outputPaths: Object.freeze([
      "output/video.mp4",
      "output/render.json",
      "output/captions.vtt",
      "output/poster.png",
    ]),
  }),
  "manim.v1": Object.freeze({
    id: "manim.v1",
    capability: "manimRendering",
    sandboxProfileId: "manim",
    executable: "/opt/avermate/bin/manim-build",
    argv: Object.freeze([
      "--input",
      "/workspace/input/request.json",
      "--output",
      "/workspace/output/scene.mp4",
      "--manifest",
      "/workspace/output/render.json",
    ]),
    outputPaths: Object.freeze([
      "output/scene.mp4",
      "output/render.json",
    ]),
  }),
} satisfies Readonly<Record<AdvancedMediaProfile, AdvancedMediaExecutionProfile>>);
