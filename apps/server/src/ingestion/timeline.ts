import {
  videoTimelineV1Schema,
  type ArtifactCitationReferenceV1,
  type VideoTimelineV1,
} from "@avermate/agent-contracts";
import { canonicalJson, sha256 } from "../search/values";

export interface ResolvedArtifactRevision {
  readonly id: string;
  readonly ownerId: string;
  readonly digest: string;
  readonly kind: string;
}

export interface ResolvedCitationReference {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerKind: "artifact-revision";
  readonly ownerIdWithinKind: string;
  readonly sourceVersionId: string;
  readonly chunkId: string | null;
  readonly referenceKey: string;
}

export interface TimelineReferenceResolver {
  artifactRevision(ownerId: string, id: string): Promise<ResolvedArtifactRevision | null>;
  citation(ownerId: string, id: string): Promise<ResolvedCitationReference | null>;
}

function sameCitation(
  declared: ArtifactCitationReferenceV1,
  stored: ResolvedCitationReference,
) {
  return (
    declared.sourceVersionId === stored.sourceVersionId &&
    (declared.chunkId ?? null) === stored.chunkId &&
    declared.referenceKey === stored.referenceKey
  );
}

/** Resolves every immutable edge; no current artifact/source pointer is accepted. */
export async function validateVideoTimeline(input: {
  ownerId: string;
  ownerArtifactRevisionId: string;
  timeline: VideoTimelineV1;
  resolver: TimelineReferenceResolver;
}) {
  const timeline = videoTimelineV1Schema.parse(input.timeline);
  const referenced = new Map<string, ResolvedArtifactRevision>();
  for (const scene of timeline.scenes) {
    for (const ref of [scene.visual, scene.narration].filter(
      (value): value is NonNullable<typeof value> => value !== undefined,
    )) {
      const existing = referenced.get(ref.artifactRevisionId);
      const resolved =
        existing ??
        (await input.resolver.artifactRevision(input.ownerId, ref.artifactRevisionId));
      if (!resolved || resolved.ownerId !== input.ownerId) {
        throw new Error("Timeline references an unavailable artifact revision");
      }
      if (resolved.digest !== ref.digest) {
        throw new Error("Timeline artifact digest does not match the immutable revision");
      }
      const allowedKinds =
        ref === scene.visual
          ? new Set(["image", "pdf", "pptx", "slides-source", "html"])
          : new Set(["audio"]);
      if (!allowedKinds.has(resolved.kind)) {
        throw new Error("Timeline artifact revision has an incompatible media kind");
      }
      referenced.set(resolved.id, resolved);
    }
    for (const citation of scene.citations) {
      const stored = await input.resolver.citation(
        input.ownerId,
        citation.contentVersionReferenceId,
      );
      if (
        !stored ||
        stored.ownerId !== input.ownerId ||
        stored.ownerKind !== "artifact-revision" ||
        stored.ownerIdWithinKind !== input.ownerArtifactRevisionId ||
        !sameCitation(citation, stored)
      ) {
        throw new Error("Timeline citation is not an exact owned corpus reference");
      }
    }
  }
  const durationMs = timeline.scenes.reduce(
    (duration, scene) => duration + scene.durationMs,
    0,
  );
  return Object.freeze({
    timeline,
    durationMs,
    digest: sha256(canonicalJson(timeline)),
    referencedArtifactRevisionIds: [...referenced.keys()].sort(),
  });
}

function timestamp(ms: number, decimal: "," | ".") {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const milliseconds = ms % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${decimal}${String(milliseconds).padStart(3, "0")}`;
}

export function captionsFromTimeline(
  input: VideoTimelineV1,
  format: "srt" | "vtt",
) {
  const timeline = videoTimelineV1Schema.parse(input);
  const cues = timeline.scenes.flatMap((scene) =>
    scene.captions.map((cue) => ({
      ...cue,
      startMs: scene.startMs + cue.startMs,
      endMs: scene.startMs + cue.endMs,
    })),
  );
  const decimal = format === "srt" ? "," : ".";
  const body = cues
    .map(
      (cue, index) =>
        `${format === "srt" ? `${index + 1}\n` : ""}${timestamp(cue.startMs, decimal)} --> ${timestamp(cue.endMs, decimal)}\n${cue.text.replace(/\r?\n/g, " ")}\n`,
    )
    .join("\n");
  return format === "vtt" ? `WEBVTT\n\n${body}` : body;
}

/**
 * Deterministic structured renderer input. A sandbox worker supplies fixed
 * numbered inputs and executes this vector directly, never through a shell.
 */
export function buildFfmpegTimelineArgv(input: VideoTimelineV1) {
  const timeline = videoTimelineV1Schema.parse(input);
  const argv: string[] = ["-hide_banner", "-nostdin", "-y"];
  for (const [index, scene] of timeline.scenes.entries()) {
    argv.push(
      "-loop",
      "1",
      "-t",
      (scene.durationMs / 1_000).toFixed(3),
      "-i",
      `/workspace/input/visual-${index}.png`,
    );
    if (scene.narration) {
      argv.push("-i", `/workspace/input/narration-${index}.wav`);
    }
  }
  const filters: string[] = [];
  let inputIndex = 0;
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  for (const [sceneIndex, scene] of timeline.scenes.entries()) {
    filters.push(
      `[${inputIndex}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${timeline.fps},trim=duration=${(scene.durationMs / 1_000).toFixed(3)},setpts=PTS-STARTPTS[v${sceneIndex}]`,
    );
    videoLabels.push(`[v${sceneIndex}]`);
    inputIndex += 1;
    if (scene.narration) {
      filters.push(
        `[${inputIndex}:a]atrim=duration=${(scene.durationMs / 1_000).toFixed(3)},asetpts=PTS-STARTPTS[a${sceneIndex}]`,
      );
      audioLabels.push(`[a${sceneIndex}]`);
      inputIndex += 1;
    } else {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${(scene.durationMs / 1_000).toFixed(3)}[a${sceneIndex}]`,
      );
      audioLabels.push(`[a${sceneIndex}]`);
    }
  }
  filters.push(
    `${videoLabels.map((label, index) => `${label}${audioLabels[index]}`).join("")}concat=n=${timeline.scenes.length}:v=1:a=1[outv][outa]`,
  );
  argv.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "/workspace/output/video.mp4",
  );
  return Object.freeze(argv);
}
