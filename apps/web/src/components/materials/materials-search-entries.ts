"use client"

import { useQuery } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingsInput,
  materialsDocumentsInput,
  materialsFoldersInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"
import type { StudyDocument } from "@/components/documents/document-types"
import type { LectureRecordingView } from "@/components/recordings/recording-types"
import {
  materialsLocationHref,
  MATERIALS_OPEN_PARAM,
} from "./materials-location"
import type {
  MaterialDocumentView,
  MaterialFolderView,
} from "./materials-types"

/**
 * Everything in Materials, as things the command palette can jump to.
 *
 * The palette knew about screens, subjects and grades, so the one place in the
 * app that holds hundreds of named things was the one place it could not find
 * anything in. Nothing is fetched until the palette opens, and by then the
 * lists are usually already in the cache from a visit to the screen.
 */

export interface MaterialSearchEntry {
  id: string
  title: string
  /** What it is, in words — a folder, a PDF, a revision sheet. */
  kind: string
  /** Where selecting it goes. */
  href: string
}

export function useMaterialsSearchEntries(
  yearId: string | undefined,
  enabled: boolean
): MaterialSearchEntry[] {
  const t = useExtracted()
  const active = enabled && Boolean(yearId)
  const options = { enabled: active, staleTime: COMMON_QUERY_STALE_TIME }

  const folders = useQuery({
    ...orpc.materials.folders.list.queryOptions({
      input: materialsFoldersInput(yearId ?? ""),
    }),
    ...options,
  })
  const documents = useQuery({
    ...orpc.materials.documents.list.queryOptions({
      input: materialsDocumentsInput(yearId ?? ""),
    }),
    ...options,
  })
  const studyDocuments = useQuery({
    ...orpc.documents.list.queryOptions({
      input: studyDocumentsInput(yearId ?? ""),
    }),
    ...options,
  })
  const recordings = useQuery({
    ...orpc.recordings.list.queryOptions({
      input: lectureRecordingsInput(yearId ?? ""),
    }),
    ...options,
  })

  const entries: MaterialSearchEntry[] = []

  for (const folder of (folders.data ?? []) as MaterialFolderView[]) {
    entries.push({
      id: `folder:${folder.id}`,
      title: folder.name,
      kind: t("Folder"),
      href: materialsLocationHref({ kind: "folder", folderId: folder.id }),
    })
  }

  for (const row of (documents.data ?? []) as MaterialDocumentView[]) {
    const { document } = row
    // A source has no page of its own; it opens in the browser it lives in, so
    // the link is its folder plus the id to open once there.
    const base = materialsLocationHref(
      document.folderId
        ? { kind: "folder", folderId: document.folderId }
        : { kind: "root" }
    )
    entries.push({
      id: `material:${document.id}`,
      title: document.title,
      kind:
        document.sourceType === "link"
          ? t("Link")
          : document.sourceType === "text"
            ? t("Note")
            : t("File"),
      href: `${base}${base.includes("?") ? "&" : "?"}${MATERIALS_OPEN_PARAM}=${encodeURIComponent(document.id)}`,
    })
  }

  for (const document of (studyDocuments.data ?? []) as StudyDocument[]) {
    entries.push({
      id: `study:${document.id}`,
      title: document.title,
      kind:
        document.kind === "fiche"
          ? t("Revision sheet")
          : document.kind === "mindmap"
            ? t("Mind map")
            : document.kind === "slides"
              ? t("Slide deck")
              : t("Study note"),
      href: `/materials/fiches/${document.id}`,
    })
  }

  for (const recording of (recordings.data ?? []) as LectureRecordingView[]) {
    entries.push({
      id: `recording:${recording.id}`,
      title: recording.title,
      kind: t("Recording"),
      href: `/materials/recordings/${recording.id}`,
    })
  }

  return entries
}
