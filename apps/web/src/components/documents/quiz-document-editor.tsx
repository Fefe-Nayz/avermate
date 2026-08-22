"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { orpc } from "@/lib/orpc"
import { Spinner } from "@/components/ui/spinner"
import {
  isQuizContent,
  type EditableStudyDocumentResult,
  type QuizQuestion,
} from "./document-types"

function newQuestion(kind: QuizQuestion["kind"]): QuizQuestion {
  if (kind === "mcq") {
    return { kind, prompt: "", choices: ["", ""], answers: [0] }
  }
  if (kind === "cloze") return { kind, text: "", blanks: [""] }
  return { kind, prompt: "", expected: "" }
}

function quizValid(title: string, questions: QuizQuestion[]) {
  if (!title.trim() || questions.length === 0) return false
  return questions.every((question) => {
    if (question.kind === "mcq") {
      return Boolean(
        question.prompt.trim() &&
        question.choices.length >= 2 &&
        question.choices.every((choice) => choice.trim()) &&
        question.answers.length > 0
      )
    }
    if (question.kind === "open") {
      return Boolean(question.prompt.trim() && question.expected.trim())
    }
    return Boolean(
      question.text.trim() && question.blanks.every((blank) => blank.trim())
    )
  })
}

export function QuizDocumentEditor({
  initial,
}: {
  initial: EditableStudyDocumentResult
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(initial.document.title)
  const [revision, setRevision] = useState(initial.document.revision)
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    isQuizContent(initial.document.metaJson)
      ? initial.document.metaJson.questions
      : [newQuestion("open")]
  )
  const update = useMutation({
    ...orpc.documents.update.mutationOptions(),
    onSuccess: async (value) => {
      const result = value as EditableStudyDocumentResult
      setRevision(result.document.revision)
      queryClient.setQueryData(
        orpc.documents.getForEdit.queryKey({
          input: { documentId: initial.document.id },
        }),
        result
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.documents.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.documents.get.queryKey({
            input: { documentId: initial.document.id },
          }),
        }),
      ])
      toast.success(t("Quiz saved."))
    },
    onError: (error: Error) =>
      toast.error(error.message || t("The quiz could not be saved.")),
  })
  const replace = (index: number, question: QuizQuestion) =>
    setQuestions((current) =>
      current.map((value, cursor) => (cursor === index ? question : value))
    )

  return (
    <>
      <PageMeta
        title={title || t("Untitled quiz")}
        subtitle={t("Quiz editor")}
      />
      <PageActions>
        <Button
          size="sm"
          disabled={!quizValid(title, questions) || update.isPending}
          onClick={() =>
            update.mutate({
              documentId: initial.document.id,
              revision,
              title: title.trim(),
              bodyMarkdown: "",
              metaJson: { version: 1, questions },
            })
          }
        >
          {update.isPending ? <Spinner /> : <SaveIcon />}
          {t("Save")}
        </Button>
      </PageActions>
      <main className="mx-auto w-full max-w-4xl space-y-4">
        <Input
          value={title}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
        />
        {questions.map((question, index) => (
          <section
            key={index}
            className="rounded-xl border bg-card p-4 shadow-xs"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <strong>
                {t("Question {number}", { number: String(index + 1) })}
              </strong>
              <div className="flex items-center gap-2">
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={question.kind}
                  onChange={(event) =>
                    replace(
                      index,
                      newQuestion(event.target.value as QuizQuestion["kind"])
                    )
                  }
                >
                  <option value="mcq">{t("Multiple choice")}</option>
                  <option value="open">{t("Open answer")}</option>
                  <option value="cloze">{t("Fill in the blanks")}</option>
                </select>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("Delete question")}
                  disabled={questions.length === 1}
                  onClick={() =>
                    setQuestions((current) =>
                      current.filter((_value, cursor) => cursor !== index)
                    )
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
            {question.kind === "cloze" ? (
              <Textarea
                value={question.text}
                placeholder={t("Sentence containing blanks")}
                onChange={(event) =>
                  replace(index, { ...question, text: event.target.value })
                }
              />
            ) : (
              <Textarea
                value={question.prompt}
                placeholder={t("Question")}
                onChange={(event) =>
                  replace(index, { ...question, prompt: event.target.value })
                }
              />
            )}
            {question.kind === "mcq" ? (
              <div className="mt-3 space-y-2">
                {question.choices.map((choice, choiceIndex) => (
                  <div key={choiceIndex} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={t("Correct answer")}
                      checked={question.answers.includes(choiceIndex)}
                      onChange={(event) =>
                        replace(index, {
                          ...question,
                          answers: event.target.checked
                            ? [...question.answers, choiceIndex]
                            : question.answers.filter(
                                (answer) => answer !== choiceIndex
                              ),
                        })
                      }
                    />
                    <Input
                      value={choice}
                      placeholder={t("Choice {number}", {
                        number: String(choiceIndex + 1),
                      })}
                      onChange={(event) =>
                        replace(index, {
                          ...question,
                          choices: question.choices.map((value, cursor) =>
                            cursor === choiceIndex ? event.target.value : value
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={question.choices.length >= 12}
                  onClick={() =>
                    replace(index, {
                      ...question,
                      choices: [...question.choices, ""],
                    })
                  }
                >
                  <PlusIcon /> {t("Add choice")}
                </Button>
              </div>
            ) : question.kind === "open" ? (
              <Input
                className="mt-3"
                value={question.expected}
                placeholder={t("Expected answer")}
                onChange={(event) =>
                  replace(index, { ...question, expected: event.target.value })
                }
              />
            ) : (
              <Input
                className="mt-3"
                value={question.blanks.join(" | ")}
                placeholder={t("Answers separated by |")}
                onChange={(event) =>
                  replace(index, {
                    ...question,
                    blanks: event.target.value
                      .split("|")
                      .map((value) => value.trim()),
                  })
                }
              />
            )}
          </section>
        ))}
        <div className="flex flex-wrap gap-2">
          {(["mcq", "open", "cloze"] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              disabled={questions.length >= 200}
              onClick={() =>
                setQuestions((current) => [...current, newQuestion(kind)])
              }
            >
              <PlusIcon />
              {kind === "mcq"
                ? t("Multiple choice")
                : kind === "open"
                  ? t("Open answer")
                  : t("Fill in the blanks")}
            </Button>
          ))}
        </div>
      </main>
    </>
  )
}
