import { describe, expect, test } from "bun:test"
import { isQuizContent, isQuizPromptContent } from "./document-types"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

const corrections = {
  version: 1 as const,
  questions: [
    {
      kind: "mcq" as const,
      prompt: "Pick one",
      choices: ["A", "B"],
      answers: [1],
      why: "B is correct",
    },
    { kind: "open" as const, prompt: "Capital?", expected: "Paris" },
    { kind: "cloze" as const, text: "A …", blanks: ["word"] },
  ],
}

const prompts = {
  version: 1 as const,
  questions: [
    {
      kind: "mcq" as const,
      prompt: "Pick one",
      choices: ["A", "B"],
      answerCount: 1,
    },
    { kind: "open" as const, prompt: "Capital?" },
    { kind: "cloze" as const, text: "A …", blankCount: 1 },
  ],
}

describe("quiz reader boundary", () => {
  test("distinguishes authoring corrections from prompt-only reader data", () => {
    expect(isQuizContent(corrections)).toBe(true)
    expect(isQuizPromptContent(corrections)).toBe(false)
    expect(isQuizPromptContent(prompts)).toBe(true)
    expect(isQuizContent(prompts)).toBe(false)
  })

  test("accepts prompt-only v2 quizzes without exposing corrections", () => {
    const v2Prompts = {
      version: 2,
      questions: [
        {
          kind: "mcq",
          id: "q-v2",
          prompt: "2 + 2 ?",
          choices: ["3", "4"],
          answerCount: 1,
          objectiveIds: ["objective-1"],
          difficulty: 0.3,
        },
      ],
    }

    expect(isQuizPromptContent(v2Prompts)).toBe(true)
    expect(isQuizContent(v2Prompts)).toBe(false)
  })

  test("uses the attempt snapshot and never the document metadata to render questions", async () => {
    const view = await source("./quiz-document-view.tsx")
    expect(view).toContain("setQuestions(attempt.questions)")
    expect(view).toContain("setAnswers(attempt.questions.map(emptyAnswer))")
    expect(view).toContain("questions.map((question, index)")
    expect(view).not.toContain("content.questions.map(emptyAnswer)")
  })

  test("renders the complete study surface inside the Materials pane", async () => {
    const reader = await source("../materials/renderers/study-renderer.tsx")
    expect(reader).toContain("detail.data?.renderedMarkdown")
    expect(reader).toContain("<DocumentArtifactsStrip")
    expect(reader).toContain("<QuizDocumentView")
    expect(reader).toContain("isQuizPromptContent(loaded?.metaJson)")
    expect(reader).toContain("orpc.documents.get.queryOptions")
    expect(reader).not.toContain("orpc.documents.getForEdit")
  })

  test("hydrates corrections only through the owner-scoped editor endpoint", async () => {
    const [page, editor] = await Promise.all([
      source("../../app/(app)/materials/fiches/[documentId]/edit/page.tsx"),
      source("./study-document-editor.tsx"),
    ])
    expect(page).toContain("documents.getForEdit.queryOptions")
    expect(editor).toContain("orpc.documents.getForEdit.queryOptions")
    expect(editor).not.toContain(
      "orpc.documents.get.queryOptions({ input: { documentId } })"
    )
  })
})
