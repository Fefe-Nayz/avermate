export function isActiveExportJob(status: string | undefined): boolean {
  return status === "queued" || status === "running"
}

export function exportedPptxFileId(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("fileId" in result)) {
    return null
  }
  const fileId = (result as { fileId?: unknown }).fileId
  return typeof fileId === "string" && fileId.length > 0 ? fileId : null
}
