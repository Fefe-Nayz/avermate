import type { MindmapContentV1 } from "./mindmap-model"

export type StudyDocumentKind =
  | "fiche"
  | "note"
  | "mindmap"
  | "slides"
  /** A .tex source that builds to a PDF; see plan 020 §5. */
  | "latex"
  | "quiz"

export type QuizQuestion =
  | {
      kind: "mcq"
      prompt: string
      choices: string[]
      answers: number[]
      why?: string
    }
  | { kind: "open"; prompt: string; expected: string }
  | { kind: "cloze"; text: string; blanks: string[] }

export interface QuizContent {
  version: 1
  questions: QuizQuestion[]
}

/** Prompt-only quiz payload returned by reader and attempt-start endpoints. */
export type QuizPromptQuestion =
  | {
      kind: "mcq"
      prompt: string
      choices: string[]
      answerCount: number
      id?: string
      objectiveIds?: string[]
      difficulty?: number | null
    }
  | {
      kind: "open"
      prompt: string
      id?: string
      objectiveIds?: string[]
      difficulty?: number | null
    }
  | {
      kind: "cloze"
      text: string
      blankCount: number
      id?: string
      objectiveIds?: string[]
      difficulty?: number | null
    }

export interface QuizPromptContent {
  version: 1 | 2
  questions: QuizPromptQuestion[]
}

export type StudyDocumentSourceKind = "subject" | "materialDocument" | "grade"

export interface StudyDocument {
  id: string
  kind: StudyDocumentKind
  title: string
  bodyMarkdown: string
  revision: number
  metaVersion: number
  metaJson:
    | { emoji?: string; color?: string }
    | MindmapContentV1
    | { version: 1 }
    | QuizPromptContent
    | null
  folderId: string | null
  subjectId: string | null
  yearId: string
  userId: string
  /** Favourites and the recoverable delete the server records; see plan 020 §1. */
  starredAt: Date | null
  deletedAt: Date | null
  deletedFrom: string | null
  /** Who removed it: the reader, or a sync that no longer sees it upstream. */
  deletedBy: "user" | "provider" | null
  /** Groups one bulk delete, so restoring puts the whole batch back together. */
  deletedBatchId: string | null
  /**
   * The tags on this sheet; see plan 020 §2.
   *
   * Only the list projection carries them — reading one document does not join
   * the link table — so this is absent rather than empty on a single read, and
   * the row model reads it as `?? []`.
   */
  tagIds?: readonly string[]
  createdAt: Date
  updatedAt: Date
}

/** Full owner-only authoring shape returned by `documents.getForEdit`. */
export type EditableStudyDocument = Omit<StudyDocument, "metaJson"> & {
  metaJson:
    | { emoji?: string; color?: string }
    | MindmapContentV1
    | { version: 1 }
    | QuizContent
    | null
}

export interface StudyDocumentSource {
  kind: StudyDocumentSourceKind
  referenceId: string
}

export interface StudyDocumentResult {
  document: StudyDocument
  sources: StudyDocumentSource[]
  renderedMarkdown: string
  transclusionDependencies: Array<{ documentId: string; revision: number }>
}

export interface EditableStudyDocumentResult extends Omit<
  StudyDocumentResult,
  "document"
> {
  document: EditableStudyDocument
}

export function isMindmapContent(value: unknown): value is MindmapContentV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    "version" in value &&
    (value.version === 1 || value.version === 2) &&
    "root" in value &&
    value.root !== null &&
    typeof value.root === "object" &&
    "id" in value.root &&
    typeof value.root.id === "string" &&
    "label" in value.root &&
    typeof value.root.label === "string"
  )
}

export function isQuizContent(value: unknown): value is QuizContent {
  return (
    value !== null &&
    typeof value === "object" &&
    "version" in value &&
    value.version === 1 &&
    "questions" in value &&
    Array.isArray(value.questions) &&
    value.questions.every((question) => {
      if (
        question === null ||
        typeof question !== "object" ||
        !("kind" in question)
      ) {
        return false
      }
      if (question.kind === "mcq") {
        return "answers" in question && Array.isArray(question.answers)
      }
      if (question.kind === "open") {
        return "expected" in question && typeof question.expected === "string"
      }
      return (
        question.kind === "cloze" &&
        "blanks" in question &&
        Array.isArray(question.blanks)
      )
    })
  )
}

export function isQuizPromptContent(
  value: unknown
): value is QuizPromptContent {
  return (
    value !== null &&
    typeof value === "object" &&
    "version" in value &&
    (value.version === 1 || value.version === 2) &&
    "questions" in value &&
    Array.isArray(value.questions) &&
    value.questions.length > 0 &&
    value.questions.every((question) => {
      if (
        question === null ||
        typeof question !== "object" ||
        !("kind" in question)
      ) {
        return false
      }
      if (question.kind === "mcq") {
        return (
          "prompt" in question &&
          typeof question.prompt === "string" &&
          "choices" in question &&
          Array.isArray(question.choices) &&
          "answerCount" in question &&
          typeof question.answerCount === "number" &&
          !("answers" in question) &&
          !("why" in question)
        )
      }
      if (question.kind === "open") {
        return (
          "prompt" in question &&
          typeof question.prompt === "string" &&
          !("expected" in question)
        )
      }
      return (
        question.kind === "cloze" &&
        "text" in question &&
        typeof question.text === "string" &&
        "blankCount" in question &&
        typeof question.blankCount === "number" &&
        !("blanks" in question)
      )
    })
  )
}
