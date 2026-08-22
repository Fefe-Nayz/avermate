"use client"

import { uploadFile } from "better-upload/client"
import { env } from "./env"

export type BrowserUploadRoute =
  | "avatar"
  | "feedbackAttachment"
  | "courseMaterial"
  | "courseMedia"
  | "lectureAudioSegment"
  | "gradeCopy"

type UploadStatus = {
  enabled: boolean
  mode: "local" | "s3"
}

let statusRequest: Promise<UploadStatus> | null = null

async function uploadStatus() {
  statusRequest ??= fetch(`${env.apiUrl}/api/upload/status`, {
    credentials: "include",
  }).then(async (response) => {
    if (!response.ok) throw new Error("The upload service is unavailable")
    return (await response.json()) as UploadStatus
  })
  return statusRequest
}

async function localUpload(route: BrowserUploadRoute, file: File) {
  const body = new FormData()
  body.set("route", route)
  body.set("file", file)
  const response = await fetch(`${env.apiUrl}/api/upload/local`, {
    method: "POST",
    body,
    credentials: "include",
  })
  const result = (await response.json().catch(() => null)) as {
    fileId?: unknown
    error?: unknown
  } | null
  if (!response.ok || typeof result?.fileId !== "string") {
    throw new Error(
      typeof result?.error === "string" ? result.error : "The upload failed"
    )
  }
  return { fileId: result.fileId }
}

/**
 * One client boundary for both environments: local multipart in development,
 * Better Upload's direct-to-Garage PUT in production.
 */
export async function uploadBrowserFile(
  route: BrowserUploadRoute,
  file: File,
  options: { signal?: AbortSignal } = {}
) {
  const status = await uploadStatus()
  if (!status.enabled) throw new Error("File uploads are not configured")
  if (status.mode === "local") return localUpload(route, file)

  const result = await uploadFile({
    api: `${env.apiUrl}/api/upload`,
    route,
    file,
    credentials: "include",
    retry: 1,
    retryDelay: 300,
    signal: options.signal,
  })
  const fileId = result.metadata.fileId
  if (typeof fileId !== "string") {
    throw new Error("The upload reservation was not returned by the server")
  }
  return { fileId }
}

export function resetUploadStatusCache() {
  statusRequest = null
}
