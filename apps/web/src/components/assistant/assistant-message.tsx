"use client"

import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  type DataMessagePartProps,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react"
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClipboardIcon,
  FileSearchIcon,
  FileBoxIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  PencilIcon,
  RefreshCcwIcon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { createContext, useContext, useState, type ReactNode } from "react"
import { DocumentMarkdown } from "@/components/documents/document-markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ActionCard } from "./actions/action-card"
import { useAssistantToolAction } from "./actions/action-interactions"
import { AssistantSpecializedToolResult } from "./assistant-specialized-tool-result"
import { usesSpecializedToolResult } from "./tool-result-registry"

export interface AssistantMessageActions {
  openCitation: (citationId: string) => void
  openArtifact: (artifactId: string, revisionId?: string) => void
  answerQuestion: (questionId: string, answer: string) => Promise<void>
}

const MessageActionsContext = createContext<AssistantMessageActions>({
  openCitation: () => undefined,
  openArtifact: () => undefined,
  answerQuestion: async () => undefined,
})

export function AssistantMessageActionsProvider({
  actions,
  children,
}: {
  actions: AssistantMessageActions
  children: ReactNode
}) {
  return (
    <MessageActionsContext.Provider value={actions}>
      {children}
    </MessageActionsContext.Provider>
  )
}

function trimJson(value: unknown): string {
  let output: string
  try {
    output = JSON.stringify(value, null, 2)
  } catch {
    output = "[unserializable]"
  }
  return output.length > 12_000 ? `${output.slice(0, 12_000)}\n…` : output
}

function MarkdownPart({ text }: { text: string }) {
  const t = useExtracted()
  return (
    <DocumentMarkdown
      markdown={text}
      ariaLabel={t("Assistant message")}
      className="min-w-0"
    />
  )
}

function StateIcon({ state }: { state: string }) {
  if (state === "active" || state === "pending" || state === "running") {
    return (
      <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
    )
  }
  if (state === "complete" || state === "ready") {
    return <CheckIcon className="size-3.5 text-success" />
  }
  if (state === "cancelled") return <XIcon className="size-3.5" />
  return <AlertCircleIcon className="size-3.5 text-destructive" />
}

type AssistantDataProps = Pick<DataMessagePartProps, "data" | "name">

function StatusPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const part = data as {
    state?: string
    label?: string
    detail?: string
  }
  const label =
    part.label === "Preparing cited context"
      ? t("Preparing cited context")
      : (part.label ?? t("Working"))
  return (
    <div
      className="my-2 flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
      role="status"
      aria-live="polite"
    >
      <StateIcon state={part.state ?? "pending"} />
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {part.detail ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {part.detail}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PlanPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const part = data as {
    title?: string
    items?: readonly { id: string; label: string; status: string }[]
  }
  return (
    <section className="my-3 rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <ListTodoIcon className="size-4" /> {part.title ?? t("Plan")}
      </div>
      <ol className="flex flex-col gap-1.5">
        {part.items?.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            {item.status === "complete" ? (
              <CheckIcon className="mt-0.5 size-3.5 text-success" />
            ) : item.status === "active" ? (
              <LoaderCircleIcon className="mt-0.5 size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <CircleIcon className="mt-0.5 size-3.5 text-muted-foreground" />
            )}
            <span
              className={cn(
                item.status === "cancelled" &&
                  "text-muted-foreground line-through"
              )}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function CitationPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const actions = useContext(MessageActionsContext)
  const part = data as { citationId?: string; ordinal?: number }
  if (!part.citationId) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="my-1 rounded-full"
      onClick={() => actions.openCitation(part.citationId!)}
    >
      <FileSearchIcon data-icon="inline-start" />
      {typeof part.ordinal === "number"
        ? t("Source {number}", { number: String(part.ordinal + 1) })
        : t("Source")}
    </Button>
  )
}

function QuestionPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const actions = useContext(MessageActionsContext)
  const part = data as {
    questionId?: string
    prompt?: string
    options?: readonly { id: string; label: string; detail?: string }[]
    allowFreeText?: boolean
    state?: string
  }
  const [answer, setAnswer] = useState("")
  const [submitting, setSubmitting] = useState(false)
  if (!part.questionId) return null
  const submit = async (value: string) => {
    if (!value.trim() || submitting || part.state !== "pending") return
    setSubmitting(true)
    try {
      await actions.answerQuestion(part.questionId!, value.trim())
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <section className="my-3 flex flex-col gap-3 rounded-xl border bg-accent/20 p-3">
      <div className="text-sm font-medium">{part.prompt ?? t("Question")}</div>
      {part.options?.length ? (
        <div className="flex flex-wrap gap-2">
          {part.options.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting || part.state !== "pending"}
              title={option.detail}
              onClick={() => void submit(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}
      {part.allowFreeText !== false ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void submit(answer)
          }}
        >
          <Input
            value={answer}
            disabled={submitting || part.state !== "pending"}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={t("Type your answer")}
            aria-label={t("Answer")}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!answer.trim() || submitting}
          >
            {t("Answer")}
          </Button>
        </form>
      ) : null}
    </section>
  )
}

function UsagePart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const part = data as {
    inputTokens?: number | null
    outputTokens?: number | null
    reasoningTokens?: number | null
    cachedReadTokens?: number | null
    estimatedCost?: string | null
    currency?: string | null
  }
  return (
    <div className="my-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
      <Badge variant="outline">
        {part.inputTokens ?? "—"} {t("input")}
      </Badge>
      <Badge variant="outline">
        {part.outputTokens ?? "—"} {t("output")}
      </Badge>
      {part.reasoningTokens ? (
        <Badge variant="outline">
          {part.reasoningTokens} {t("reasoning")}
        </Badge>
      ) : null}
      {part.cachedReadTokens ? (
        <Badge variant="outline">
          {part.cachedReadTokens} {t("cached")}
        </Badge>
      ) : null}
      {part.estimatedCost ? (
        <Badge variant="secondary">
          {part.estimatedCost} {part.currency}
        </Badge>
      ) : null}
    </div>
  )
}

function ArtifactPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const actions = useContext(MessageActionsContext)
  const part = data as {
    artifactId?: string
    artifactRevisionId?: string
    label?: string
    state?: string
  }
  if (!part.artifactId) return null
  return (
    <button
      type="button"
      className="my-2 flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50"
      onClick={() =>
        actions.openArtifact(part.artifactId!, part.artifactRevisionId)
      }
    >
      <FileBoxIcon className="size-5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {part.label ?? t("Artifact")}
        </span>
        <span className="text-xs text-muted-foreground">
          {part.state ?? t("proposed")}
        </span>
      </span>
      <StateIcon state={part.state ?? "proposed"} />
    </button>
  )
}

function SafeErrorPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const part = data as { code?: string; message?: string; retryable?: boolean }
  const message =
    part.message === "Response cancelled."
      ? t("Response cancelled.")
      : part.message === "The response could not be generated."
        ? t("The response could not be generated.")
        : (part.message ?? t("The run failed"))
  return (
    <div
      role="alert"
      className="my-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertCircleIcon className="size-4" /> {message}
      </div>
      <div className="mt-1 text-xs opacity-80">
        {part.code ?? "assistant_error"}
        {part.retryable ? t(" · You can retry this response.") : ""}
      </div>
    </div>
  )
}

function UnknownDataPart({ data, name }: DataMessagePartProps) {
  const type = name.replace(/^assistant-/, "")
  if (type === "status") return <StatusPart data={data} name={name} />
  if (type === "plan") return <PlanPart data={data} name={name} />
  if (type === "citation") return <CitationPart data={data} name={name} />
  if (type === "question") return <QuestionPart data={data} name={name} />
  if (type === "usage") return <UsagePart data={data} name={name} />
  if (type === "artifact") return <ArtifactPart data={data} name={name} />
  if (type === "safe-error") return <SafeErrorPart data={data} name={name} />
  return null
}

function ToolPart({
  toolCallId,
  toolName,
  args,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  const t = useExtracted()
  const ledger = useAssistantToolAction(toolCallId)
  const running = status?.type === "running"
  const specialized = usesSpecializedToolResult(toolName)
  if (ledger.action) {
    return (
      <div className="my-3 flex flex-col gap-3">
        <ActionCard action={ledger.action} operations={ledger.operations} />
        {specialized ? (
          <AssistantSpecializedToolResult
            toolName={toolName}
            result={result}
            status={status?.type ?? "completed"}
            isError={Boolean(isError)}
          />
        ) : null}
      </div>
    )
  }
  if (specialized) {
    return (
      <AssistantSpecializedToolResult
        toolName={toolName}
        result={result}
        status={status?.type ?? "completed"}
        isError={Boolean(isError)}
      />
    )
  }
  return (
    <Collapsible className="my-2 overflow-hidden rounded-xl border bg-muted/20">
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
        render={<button type="button" />}
      >
        {running ? (
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <TerminalSquareIcon className="size-4" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {toolName}
        </span>
        <Badge variant={isError ? "destructive" : "outline"}>
          {isError ? t("failed") : running ? t("running") : t("done")}
        </Badge>
        <ChevronDownIcon className="size-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <div className="grid gap-3 p-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("Safe input")}
            </div>
            <pre className="max-h-52 overflow-auto rounded-lg bg-background p-2 text-xs">
              {trimJson(args)}
            </pre>
          </div>
          {result !== undefined ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {t("Safe result")}
              </div>
              <pre className="max-h-52 overflow-auto rounded-lg bg-background p-2 text-xs">
                {trimJson(result)}
              </pre>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

const partComponents = {
  Text: MarkdownPart,
  data: { Fallback: UnknownDataPart },
  tools: { Fallback: ToolPart },
}

function MessageActions({ editable = false }: { editable?: boolean }) {
  const t = useExtracted()
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="mt-1 flex items-center gap-1"
    >
      <ActionBarPrimitive.Copy
        copiedDuration={1_500}
        aria-label={t("Copy message")}
        render={<Button variant="ghost" size="icon-xs" />}
      >
        <ClipboardIcon />
      </ActionBarPrimitive.Copy>
      {editable ? (
        <ActionBarPrimitive.Edit
          aria-label={t("Edit into a new branch")}
          render={<Button variant="ghost" size="icon-xs" />}
        >
          <PencilIcon />
        </ActionBarPrimitive.Edit>
      ) : (
        <ActionBarPrimitive.Reload
          aria-label={t("Retry response")}
          render={<Button variant="ghost" size="icon-xs" />}
        >
          <RefreshCcwIcon />
        </ActionBarPrimitive.Reload>
      )}
    </ActionBarPrimitive.Root>
  )
}

export function AssistantUserMessage() {
  return (
    <MessagePrimitive.Root className="mx-auto flex w-full max-w-3xl flex-col items-end rounded-xl px-3 py-3 transition-[box-shadow,background-color] data-[citation-target=true]:bg-primary/5 data-[citation-target=true]:ring-2 data-[citation-target=true]:ring-primary/60 md:px-6">
      <div className="mb-1 flex max-w-[min(44rem,88%)] flex-wrap justify-end gap-1">
        <MessagePrimitive.Attachments>
          {({ attachment }) => (
            <Badge variant="outline" className="max-w-56">
              <FileBoxIcon className="size-3" />
              <span className="truncate">{attachment.name}</span>
            </Badge>
          )}
        </MessagePrimitive.Attachments>
      </div>
      <div className="max-w-[min(44rem,88%)] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground shadow-xs [&_a]:text-primary-foreground">
        <MessagePrimitive.Parts components={partComponents} />
      </div>
      <MessageActions editable />
    </MessagePrimitive.Root>
  )
}

export function AssistantModelMessage() {
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-3xl rounded-xl px-3 py-4 transition-[box-shadow,background-color] data-[citation-target=true]:bg-primary/5 data-[citation-target=true]:ring-2 data-[citation-target=true]:ring-primary/60 md:px-6">
      <div className="min-w-0">
        <MessagePrimitive.Parts components={partComponents} />
      </div>
      <MessageActions />
    </MessagePrimitive.Root>
  )
}

export function AssistantSystemMessage() {
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-3xl rounded-xl px-3 py-2 transition-[box-shadow,background-color] data-[citation-target=true]:bg-primary/5 data-[citation-target=true]:ring-2 data-[citation-target=true]:ring-primary/60 md:px-6">
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <MessagePrimitive.Parts components={partComponents} />
      </div>
    </MessagePrimitive.Root>
  )
}

export function AssistantEditComposer() {
  const t = useExtracted()
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-3xl px-3 py-3 md:px-6">
      <ComposerPrimitive.Root className="rounded-2xl border bg-card p-3 shadow-sm">
        <ComposerPrimitive.Input
          autoFocus
          submitMode="ctrlEnter"
          aria-label={t("Edit message")}
          className="min-h-24 w-full resize-none bg-transparent text-sm outline-none"
        />
        <div className="mt-2 flex justify-end gap-2">
          <ComposerPrimitive.Cancel
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            {t("Cancel")}
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button type="submit" size="sm" />}>
            {t("Save as branch")}
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  )
}
