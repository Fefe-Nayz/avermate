"use client"

import {
  BookOpenIcon,
  FileSearchIcon,
  ListTodoIcon,
  RotateCcwIcon,
  SparklesIcon,
  TargetIcon,
} from "lucide-react"
import Link from "next/link"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import {
  specializedToolResultKind,
  type SpecializedToolResultKind,
} from "./tool-result-registry"

type JsonRecord = Record<string, unknown>

interface ResultRow {
  id: string
  label: string
  detail: string | null
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function scalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  return null
}

function firstScalar(record: JsonRecord, keys: readonly string[]) {
  for (const key of keys) {
    const value = scalar(record[key])
    if (value !== null) return value
  }
  return null
}

function resultRecord(result: unknown): JsonRecord | null {
  const root = asRecord(result)
  if (!root) return null
  for (const key of ["output", "data", "result"]) {
    const nested = asRecord(root[key])
    if (nested) return nested
  }
  return root
}

function resultRows(result: unknown): ResultRow[] {
  const record = resultRecord(result)
  const direct = Array.isArray(result) ? result : null
  const nested = record
    ? [
        "items",
        "evidence",
        "projections",
        "contributions",
        "objectives",
        "regions",
        "stages",
        "artifacts",
        "actions",
        "reverseOrder",
      ]
        .map((key) => record[key])
        .find(Array.isArray)
    : null
  const rows = direct ?? nested
  if (!rows) return []
  return rows.slice(0, 6).flatMap((value, index) => {
    const row = asRecord(value)
    if (!row) {
      const label = scalar(value)
      return label ? [{ id: `${index}:${label}`, label, detail: null }] : []
    }
    const label = firstScalar(row, [
      "title",
      "name",
      "label",
      "objectiveName",
      "explanation",
      "kind",
      "id",
    ])
    if (!label) return []
    return [
      {
        id: `${index}:${firstScalar(row, ["id"]) ?? label}`,
        label,
        detail: firstScalar(row, [
          "summary",
          "reason",
          "state",
          "status",
          "outcome",
        ]),
      },
    ]
  })
}

function progressValue(result: unknown): number | null {
  const record = resultRecord(result)
  if (!record) return null
  const explicit = record.progress ?? record.progressPercent ?? record.percent
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.max(0, Math.min(100, explicit <= 1 ? explicit * 100 : explicit))
  }
  const completed = record.completed ?? record.completedCount
  const total = record.total ?? record.totalCount
  if (typeof completed === "number" && typeof total === "number" && total > 0) {
    return Math.max(0, Math.min(100, (completed / total) * 100))
  }
  const stages = Array.isArray(record.stages) ? record.stages : null
  if (!stages?.length) return null
  const finished = stages.filter((stage) => {
    const state = asRecord(stage)?.status ?? asRecord(stage)?.state
    return state === "completed" || state === "ready" || state === "done"
  }).length
  return (finished / stages.length) * 100
}

function resultState(result: unknown, fallback: string): string {
  const record = resultRecord(result)
  return (
    (record && firstScalar(record, ["status", "state", "undoState"])) ??
    fallback
  )
}

function KindIcon({ kind }: { kind: SpecializedToolResultKind }) {
  switch (kind) {
    case "copy-analysis":
    case "copy-review":
      return <FileSearchIcon className="size-4" aria-hidden />
    case "evidence":
    case "mastery":
    case "concept":
      return <TargetIcon className="size-4" aria-hidden />
    case "plan":
      return <ListTodoIcon className="size-4" aria-hidden />
    case "quiz-progress":
      return <BookOpenIcon className="size-4" aria-hidden />
    case "artifact-progress":
      return <SparklesIcon className="size-4" aria-hidden />
    case "undo-compensation":
      return <RotateCcwIcon className="size-4" aria-hidden />
  }
}

export function AssistantSpecializedToolResult({
  toolName,
  result,
  status,
  isError,
}: {
  toolName: string
  result: unknown
  status: string
  isError: boolean
}) {
  const t = useExtracted()
  const kind = specializedToolResultKind(toolName)
  if (!kind) return null

  /**
   * One line of reassurance, not a statement of the rule.
   *
   * Each of these used to be a paragraph of specification prose — "reviewed
   * regions become evidence only after an explicit confirmation" — printed
   * under the title on every single occurrence of the tool. It answers a
   * question nobody asked mid-conversation, and it answered it again every
   * time. What is left is the part a student actually needs before deciding
   * whether to act, and it only shows while the result can still change.
   */
  const copy = {
    "copy-analysis": {
      title: t("Copy analysis"),
      note: t("Nothing here changes your grade on its own."),
    },
    "copy-review": {
      title: t("Copy review"),
      note: t("Nothing counts until you confirm it."),
    },
    concept: {
      title: t("Learning concept"),
      note: t("A concept of yours, with its objectives."),
    },
    evidence: {
      title: t("Learning evidence"),
      note: t("What was observed. Nothing here is rewritten."),
    },
    mastery: {
      title: t("Mastery explanation"),
      note: t("An estimate, with what it was based on."),
    },
    plan: {
      title: t("Learning plan"),
      note: t("Suggestions only. Nothing is added to your planning yet."),
    },
    "quiz-progress": {
      title: t("Quiz progress"),
      note: t("Trying a quiz never counts against you."),
    },
    "artifact-progress": {
      title: t("Artifact workflow"),
      note: t("Each stage keeps its sources, so you can check them."),
    },
    "undo-compensation": {
      title: t("Undo preview"),
      note: t("A preview. Nothing is undone yet."),
    },
  } satisfies Record<SpecializedToolResultKind, { title: string; note: string }>
  const rows = resultRows(result)
  const progress = progressValue(result)
  const progressText =
    progress === null
      ? null
      : t("{progress, number, percent}", {
          progress: progress / 100,
        })
  const state = resultState(result, status)
  const localizedState =
    state === "running"
      ? t("Running")
      : state === "completed" || state === "complete" || state === "done"
        ? t("Completed")
        : state === "failed" || isError
          ? t("Failed")
          : state === "pending" || state === "queued"
            ? t("Pending")
            : state === "ready"
              ? t("Ready")
              : state

  const settled = !(
    state === "running" ||
    state === "pending" ||
    state === "queued"
  )

  /**
   * A result inside a conversation, not a panel about itself.
   *
   * This was a `Card` with a header, a description, an action, a content
   * region and a footer — five framed regions — and every row inside it was
   * another bordered box. Three levels of border for one answer, which is how
   * a chat ends up reading like an admin console. One frame now: a title line
   * and the result under it.
   */
  return (
    <section
      className="my-3 overflow-hidden rounded-xl border"
      data-specialized-tool-result={kind}
      aria-busy={status === "running"}
    >
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <KindIcon kind={kind} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {copy[kind].title}
        </h3>
        <Badge
          variant={isError ? "destructive" : "outline"}
          className="shrink-0"
        >
          {localizedState}
        </Badge>
      </div>
      <div
        className="flex flex-col gap-3 px-3 py-3"
        aria-live={status === "running" ? "polite" : undefined}
      >
        {settled ? null : (
          <p className="text-xs text-muted-foreground">{copy[kind].note}</p>
        )}
        {progress !== null ? (
          <Progress value={progress} aria-valuetext={progressText ?? undefined}>
            <ProgressLabel>{t("Progress")}</ProgressLabel>
            <ProgressValue>{() => progressText}</ProgressValue>
          </Progress>
        ) : null}
        {rows.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {rows.map((row) => (
              <li key={row.id} className="px-3 py-2">
                <p className="line-clamp-2 text-sm font-medium">{row.label}</p>
                {row.detail && row.detail !== row.label ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {row.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {status === "running"
              ? t("Waiting for the first result…")
              : isError
                ? t("The tool did not return a usable result.")
                : t("The result is ready in the Learning workspace.")}
          </p>
        )}
        <Link
          href="/learning"
          className={buttonVariants({
            size: "sm",
            variant: "ghost",
            className: "-mx-2 self-start",
          })}
        >
          {t("Open Learning")}
        </Link>
      </div>
    </section>
  )
}
