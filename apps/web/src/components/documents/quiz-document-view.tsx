"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  Clock3Icon,
  GraduationCapIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import type { QuizPromptContent, QuizPromptQuestion } from "./document-types"

type QuizAnswer = number[] | string | string[]

function emptyAnswer(question: QuizPromptQuestion): QuizAnswer {
  if (question.kind === "mcq") return []
  if (question.kind === "cloze") {
    return Array.from({ length: question.blankCount }, () => "")
  }
  return ""
}

export function QuizDocumentView({
  documentId,
  content,
}: {
  documentId: string
  content: QuizPromptContent
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizPromptQuestion[] | null>(null)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [mode, setMode] = useState<"practice" | "progress">("practice")
  const [result, setResult] = useState<{
    score: number | null
    outOf: number | null
    feedback: Array<{
      correct: boolean | null
      reviewRequired: boolean
      reviewKind: "human" | "model" | null
      expected: unknown
      why: string | null
    }>
    evidenceCreated?: boolean
    pendingReviewCount?: number
  } | null>(null)
  const history = useQuery({
    ...orpc.documents.quiz.list.queryOptions({ input: { documentId } }),
  })
  const start = useMutation({
    ...orpc.documents.quiz.start.mutationOptions(),
    onSuccess: (attempt) => {
      setAttemptId(attempt.id)
      setQuestions(attempt.questions)
      setAnswers(attempt.questions.map(emptyAnswer))
      setResult(null)
    },
  })
  const complete = useMutation({
    ...orpc.documents.quiz.complete.mutationOptions(),
    onSuccess: async (completed) => {
      setResult(completed)
      await queryClient.invalidateQueries({
        queryKey: orpc.documents.quiz.list.queryKey({ input: { documentId } }),
      })
    },
  })

  if (!attemptId || !questions) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("{count} questions. Answers are scored when you submit.", {
              count: String(content.questions.length),
            })}
          </p>
          {content.version === 2 ? (
            <fieldset className="mx-auto mt-4 grid max-w-xl gap-2 text-left sm:grid-cols-2">
              <legend className="sr-only">{t("Quiz mode")}</legend>
              <Button
                type="button"
                variant={mode === "practice" ? "default" : "outline"}
                className="h-auto justify-start py-3"
                onClick={() => setMode("practice")}
              >
                <PlayIcon />
                <span>
                  <span className="block">{t("Practice")}</span>
                  <span className="block text-xs font-normal opacity-80">
                    {t("Feedback only; mastery stays unchanged.")}
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant={mode === "progress" ? "default" : "outline"}
                className="h-auto justify-start py-3"
                onClick={() => setMode("progress")}
              >
                <GraduationCapIcon />
                <span>
                  <span className="block">{t("Measure progress")}</span>
                  <span className="block text-xs font-normal opacity-80">
                    {t("Reviewed, sourced questions may create evidence.")}
                  </span>
                </span>
              </Button>
            </fieldset>
          ) : null}
          <Button
            className="mt-4"
            disabled={start.isPending}
            onClick={() =>
              start.mutate({ documentId, mode, latencyConsent: false })
            }
          >
            {start.isPending ? <Spinner /> : <PlayIcon />}
            {t("Start quiz")}
          </Button>
          {start.isError ? (
            <p className="mt-3 text-sm text-destructive">
              {start.error.message}
            </p>
          ) : null}
        </div>
        {history.data?.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              {t("Recent attempts")}
            </h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {history.data.slice(0, 5).map((attempt) => (
                <li
                  key={attempt.id}
                  className="flex justify-between rounded-lg border px-3 py-2"
                >
                  <span>{new Date(attempt.startedAt).toLocaleString()}</span>
                  <span className="numeric font-medium text-foreground">
                    {attempt.score === null
                      ? t("In progress")
                      : attempt.outOf === 0 && attempt.pendingReviewCount > 0
                        ? t("Pending review")
                        : `${attempt.score}/${attempt.outOf}`}
                  </span>
                  {attempt.mode ? (
                    <span className="text-xs">
                      {attempt.mode === "progress"
                        ? t("Progress")
                        : t("Practice")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    )
  }

  const setAnswer = (index: number, answer: QuizAnswer) =>
    setAnswers((current) =>
      current.map((value, cursor) => (cursor === index ? answer : value))
    )

  return (
    <div className="space-y-6">
      {questions.map((question, index) => {
        const feedback = result?.feedback[index]
        return (
          <fieldset
            key={index}
            disabled={Boolean(result)}
            className="rounded-xl border p-4"
          >
            <legend className="px-2 text-sm font-semibold">
              {t("Question {number}", { number: String(index + 1) })}
            </legend>
            <p className="mb-3 leading-relaxed">
              {question.kind === "cloze" ? question.text : question.prompt}
            </p>
            {question.kind === "mcq" ? (
              <div className="space-y-2">
                {question.choices.map((choice, choiceIndex) => {
                  const selected =
                    Array.isArray(answers[index]) &&
                    (answers[index] as number[]).includes(choiceIndex)
                  return (
                    <label
                      key={choiceIndex}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border p-3"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          const current = Array.isArray(answers[index])
                            ? (answers[index] as number[])
                            : []
                          setAnswer(
                            index,
                            event.target.checked
                              ? [...current, choiceIndex]
                              : current.filter((value) => value !== choiceIndex)
                          )
                        }}
                      />
                      <span>{choice}</span>
                    </label>
                  )
                })}
              </div>
            ) : question.kind === "open" ? (
              <Input
                value={typeof answers[index] === "string" ? answers[index] : ""}
                onChange={(event) => setAnswer(index, event.target.value)}
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from(
                  { length: question.blankCount },
                  (_, blankIndex) => (
                    <Input
                      key={blankIndex}
                      aria-label={t("Blank {number}", {
                        number: String(blankIndex + 1),
                      })}
                      value={
                        Array.isArray(answers[index])
                          ? String(answers[index]?.[blankIndex] ?? "")
                          : ""
                      }
                      onChange={(event) => {
                        const values = Array.isArray(answers[index])
                          ? [...(answers[index] as string[])]
                          : Array.from(
                              { length: question.blankCount },
                              () => ""
                            )
                        values[blankIndex] = event.target.value
                        setAnswer(index, values)
                      }}
                    />
                  )
                )}
              </div>
            )}
            {feedback ? (
              <div
                className={
                  feedback.reviewRequired
                    ? "mt-3 text-sm text-muted-foreground"
                    : feedback.correct
                      ? "mt-3 text-sm text-positive"
                      : "mt-3 text-sm text-destructive"
                }
              >
                <p className="flex items-center gap-1.5 font-medium">
                  {feedback.reviewRequired ? (
                    <Clock3Icon className="size-4" />
                  ) : (
                    <CheckCircle2Icon className="size-4" />
                  )}
                  {feedback.reviewRequired
                    ? feedback.reviewKind === "model"
                      ? t("Awaiting configured model review")
                      : t("Awaiting human review")
                    : feedback.correct
                      ? t("Correct")
                      : t("Review this answer")}
                </p>
                {!feedback.reviewRequired && !feedback.correct ? (
                  <p className="mt-1 text-foreground">
                    {t("Expected: {answer}", {
                      answer: Array.isArray(feedback.expected)
                        ? feedback.expected.join(", ")
                        : String(feedback.expected ?? ""),
                    })}
                  </p>
                ) : null}
                {feedback.why ? (
                  <p className="mt-1 text-foreground">{feedback.why}</p>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        )
      })}

      {result ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4">
          <div>
            <strong className="numeric text-lg">
              {result.outOf === 0 && (result.pendingReviewCount ?? 0) > 0
                ? t("Pending review")
                : `${result.score}/${result.outOf}`}
            </strong>
            {(result.pendingReviewCount ?? 0) > 0 ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3Icon className="size-3.5" />
                {t("{count} answer(s) still require explicit review.", {
                  count: String(result.pendingReviewCount),
                })}
              </p>
            ) : null}
            {result.evidenceCreated ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheckIcon className="size-3.5" />
                {t("Reviewed question evidence was added to mastery.")}
              </p>
            ) : mode === "progress" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  "No evidence was created: questions must be reviewed and sourced."
                )}
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setAttemptId(null)
              setQuestions(null)
              setAnswers([])
              setResult(null)
            }}
          >
            <RotateCcwIcon /> {t("Try again")}
          </Button>
        </div>
      ) : (
        <Button
          disabled={complete.isPending || answers.length !== questions.length}
          onClick={() => complete.mutate({ attemptId, answers })}
        >
          {complete.isPending ? <Spinner /> : null}
          {t("Submit answers")}
        </Button>
      )}
      {complete.isError ? (
        <p className="text-sm text-destructive">{complete.error.message}</p>
      ) : null}
    </div>
  )
}
