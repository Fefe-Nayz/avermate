/**
 * Shared document-artifact limits kept independent from the storage router.
 * Node adoption providers must be able to load these limits without importing
 * `storage.ts`, which itself composes the paired-node provider.
 */
export const DOCUMENT_ARTIFACT_FILE_CONSTRAINT = {
  maxBytes: 100 * 1024 * 1024,
  mimeTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "image/png",
    "image/webp",
    "text/tab-separated-values",
    "text/html",
  ],
} as const;
