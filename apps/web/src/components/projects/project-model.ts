import type { SourceLocatorV1 } from "@avermate/agent-contracts"
import {
  materialsOpenHref,
  ROOT_MATERIALS,
} from "@/components/materials/materials-location"

export type ProjectSourceKind =
  "material" | "study-document" | "recording" | "grade" | "subject" | "artifact"

export interface ProjectSourceOption {
  kind: ProjectSourceKind
  id: string
  title: string
  subtitle: string | null
}

export interface SourceCatalogueInput {
  materials: readonly {
    document: { id: string; title: string; sourceType: string }
    file: { mimeType: string } | null
  }[]
  studyDocuments: readonly { id: string; title: string; kind: string }[]
  recordings: readonly { id: string; title: string; status: string }[]
  subjects: readonly {
    id: string
    name: string
    kind: string
    grades: readonly { id: string; name: string }[]
  }[]
}

export function buildSourceCatalogue(
  input: SourceCatalogueInput
): ProjectSourceOption[] {
  const sources: ProjectSourceOption[] = [
    ...input.materials.map(({ document, file }) => ({
      kind: "material" as const,
      id: document.id,
      title: document.title,
      subtitle: file?.mimeType ?? document.sourceType,
    })),
    ...input.studyDocuments.map((document) => ({
      kind: "study-document" as const,
      id: document.id,
      title: document.title,
      subtitle: document.kind,
    })),
    ...input.recordings.map((recording) => ({
      kind: "recording" as const,
      id: recording.id,
      title: recording.title,
      subtitle: recording.status,
    })),
    ...input.subjects.flatMap((subject) => [
      {
        kind: "subject" as const,
        id: subject.id,
        title: subject.name,
        subtitle: subject.kind,
      },
      ...subject.grades.map((grade) => ({
        kind: "grade" as const,
        id: grade.id,
        title: grade.name,
        subtitle: subject.name,
      })),
    ]),
  ]
  return sources.sort(
    (left, right) =>
      left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      }) || left.id.localeCompare(right.id)
  )
}

export function locatorLabel(locator: SourceLocatorV1): string {
  switch (locator.kind) {
    case "pdf":
      return locator.bbox
        ? `PDF · page ${locator.page} · zone exacte`
        : `PDF · page ${locator.page}`
    case "markdown": {
      const heading = locator.headingPath.at(-1)
      const lines =
        locator.startLine === undefined
          ? ""
          : locator.endLine === undefined ||
              locator.endLine === locator.startLine
            ? ` · ligne ${locator.startLine}`
            : ` · lignes ${locator.startLine}–${locator.endLine}`
      return `${heading ? `Section « ${heading} »` : "Markdown"}${lines}`
    }
    case "text":
      return `Texte · caractères ${locator.startOffset}–${locator.endOffset}`
    case "audio":
    case "video":
      return `${locator.kind === "audio" ? "Audio" : "Vidéo"} · ${formatTime(locator.startMs)}–${formatTime(locator.endMs)}`
    case "slides":
      return `Diapositive ${locator.slide}`
    case "spreadsheet":
      return `${locator.sheet} · ${locator.range}`
    case "grade":
      return locator.field ? `Note · ${locator.field}` : "Note"
    case "conversation":
      return locator.startOffset === undefined
        ? "Message de conversation"
        : `Message · caractères ${locator.startOffset}–${locator.endOffset}`
  }
}

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

export function citationOpenHref(target: {
  kind:
    | "material"
    | "study-document"
    | "recording"
    | "grade"
    | "subject"
    | "conversation"
    | "artifact"
  resourceId: string
  locator: SourceLocatorV1
}): string {
  const locator = encodeURIComponent(JSON.stringify(target.locator))
  switch (target.kind) {
    case "material": {
      const href = materialsOpenHref(ROOT_MATERIALS, target.resourceId)
      return `${href}&locator=${locator}`
    }
    case "study-document":
      return `/materials/fiches/${encodeURIComponent(target.resourceId)}?locator=${locator}`
    case "recording":
      return `/materials/recordings/${encodeURIComponent(target.resourceId)}?locator=${locator}`
    case "grade":
      return `/grades?grade=${encodeURIComponent(target.resourceId)}&locator=${locator}`
    case "subject":
      return `/subjects/${encodeURIComponent(target.resourceId)}?locator=${locator}`
    case "artifact":
      return `/materials?artifact=${encodeURIComponent(target.resourceId)}&locator=${locator}`
    case "conversation":
      return `/assistant?thread=${encodeURIComponent(target.resourceId)}&locator=${locator}`
  }
}

export function coverageLabel(coverage: string | null) {
  switch (coverage) {
    case "searchable-native-text":
      return "Texte natif indexé"
    case "searchable-ocr":
      return "OCR indexé"
    case "metadata-and-locators-only":
      return "OCR requis pour chercher le texte"
    case "unsupported":
      return "Non indexable"
    default:
      return "Index en attente"
  }
}

export function nextItemOrder(
  itemIds: readonly string[],
  itemId: string,
  direction: -1 | 1
) {
  const index = itemIds.indexOf(itemId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= itemIds.length) return [...itemIds]
  const next = [...itemIds]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}
