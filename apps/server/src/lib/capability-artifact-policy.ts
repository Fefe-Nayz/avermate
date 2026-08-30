import { DOCUMENT_ARTIFACT_FILE_CONSTRAINT } from "./document-artifact-policy";

export type CapabilityArtifactPurpose = "document-artifact" | "course-media" | "grade-copy";

/** Private artifact broker limits, isolated from storage service composition. */
export const CAPABILITY_ARTIFACT_FILE_CONSTRAINTS: Record<CapabilityArtifactPurpose, { maxBytes: number; mimeTypes: readonly string[] }> = {
  "document-artifact": DOCUMENT_ARTIFACT_FILE_CONSTRAINT,
  "course-media": {
    maxBytes: 500 * 1024 * 1024,
    mimeTypes: ["audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/ogg", "audio/webm", "video/mp4", "video/webm", "video/quicktime"],
  },
  "grade-copy": { maxBytes: 25 * 1024 * 1024, mimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"] },
};

export const CAPABILITY_ARTIFACT_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/m4a": ".m4a-audio",
  "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/flac": ".flac", "audio/aac": ".aac",
  "audio/webm": ".weba", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/heic": ".heic",
  "application/json": ".json", "text/plain": ".txt", "text/tab-separated-values": ".tsv", "text/html": ".html",
};

export function capabilityArtifactPurpose(value: string): CapabilityArtifactPurpose {
  if (!Object.hasOwn(CAPABILITY_ARTIFACT_FILE_CONSTRAINTS, value)) throw new Error("ADOPTION_OBJECT_PURPOSE_DENIED");
  return value as CapabilityArtifactPurpose;
}

export function adoptedArtifactMimeFromKey(key: string) {
  return Object.entries(CAPABILITY_ARTIFACT_EXTENSION_BY_MIME).find(([, extension]) => key.endsWith(extension))?.[0] ?? null;
}
