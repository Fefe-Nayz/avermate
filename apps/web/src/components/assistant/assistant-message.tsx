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
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import {
  createContext,
  useContext,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
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
import { errorPresentation } from "./assistant-error-messages"
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

/**
 * The small round mark beside a step.
 *
 * Anything unrecognised used to fall through to a red alert circle, so a state
 * this build had simply never heard of was drawn as a failure. Not knowing and
 * having gone wrong are different things, and only the second one is red.
 */
function StateIcon({ state }: { state: string }) {
  if (["active", "pending", "running"].includes(state)) {
    return (
      <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
    )
  }
  if (["complete", "ready"].includes(state)) {
    return <CheckIcon className="size-3.5 text-success" />
  }
  if (["failed", "error"].includes(state)) {
    return <AlertCircleIcon className="size-3.5 text-destructive" />
  }
  if (state === "cancelled") return <XIcon className="size-3.5" />
  return <CircleIcon className="size-3.5 text-muted-foreground" />
}

type AssistantDataProps = Pick<DataMessagePartProps, "data" | "name">

function StatusPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const part = data as { state?: string; label?: string; detail?: string }
  /**
   * Status labels arrive as prose on the wire, so they are matched by text.
   *
   * Unlike errors, which carry a stable `code` and are translated on it in
   * `assistant-error-messages`, a status has only its label. Every label this
   * system emits is named here; anything new falls through as written rather
   * than vanishing.
   */
  const labels: Record<string, string> = {
    "Preparing cited context": t("Preparing cited context"),
    "Waiting for your reply": t("Waiting for your reply"),
    Responding: t("Responding"),
  }
  const label = part.label ? (labels[part.label] ?? part.label) : t("Working")
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
            <span className="mt-0.5">
              <StateIcon state={item.status} />
            </span>
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
  const citationId = part.citationId
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="my-1 rounded-full"
      onClick={() => actions.openCitation(citationId)}
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

  const questionId = part.questionId
  const answered = part.state !== "pending"
  const submit = async (value: string) => {
    if (!value.trim() || submitting || answered) return
    setSubmitting(true)
    try {
      await actions.answerQuestion(questionId, value.trim())
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
              disabled={submitting || answered}
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
            disabled={submitting || answered}
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

/**
 * What the run cost.
 *
 * Each figure used to be a number and a bare word glued together — `{n}` then
 * `t("input")` — which is not a sentence in any language and gives a
 * translator a lone adjective with no way to change the order. Each one is a
 * whole message now.
 */
/**
 * Metering, folded away.
 *
 * Every message carried a row of outlined pills — "— tokens in", "— tokens
 * out" — and the em dash is what `count()` returned when there was no figure
 * at all, which is most of the time. So the common case was two empty badges
 * under every single reply, in the vocabulary of a billing dashboard, in a
 * conversation a student is trying to read.
 *
 * It is still here because it is true and somebody wants it. It renders
 * nothing when there is nothing to say, and otherwise sits on one quiet line.
 */
function UsagePart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const format = useFormatter()
  const part = data as {
    inputTokens?: number | null
    outputTokens?: number | null
    reasoningTokens?: number | null
    cachedReadTokens?: number | null
    estimatedCost?: string | null
    currency?: string | null
  }

  const pieces: string[] = []
  const total = (part.inputTokens ?? 0) + (part.outputTokens ?? 0)
  if (total > 0)
    pieces.push(t("{count} tokens", { count: format.number(total) }))
  if (part.reasoningTokens)
    pieces.push(
      t("{count} thinking", { count: format.number(part.reasoningTokens) })
    )
  if (part.cachedReadTokens)
    pieces.push(
      t("{count} reused", { count: format.number(part.cachedReadTokens) })
    )
  if (part.estimatedCost)
    pieces.push(`${part.estimatedCost} ${part.currency ?? ""}`.trim())

  if (pieces.length === 0) return null

  return (
    <p className="mt-1 text-xs text-muted-foreground">{pieces.join(" · ")}</p>
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

  const artifactId = part.artifactId
  const state = part.state ?? "proposed"
  /**
   * The card used to print `part.state` straight out — so it read "proposed"
   * or "ready" in English under a French label, because that is the enum on
   * the wire, not a word chosen for a reader.
   */
  const stateLabels: Record<string, string> = {
    proposed: t("Suggested"),
    ready: t("Ready to open"),
    failed: t("Could not be built"),
  }

  return (
    <button
      type="button"
      className="my-2 flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50"
      onClick={() => actions.openArtifact(artifactId, part.artifactRevisionId)}
    >
      <FileBoxIcon className="size-5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {part.label ?? t("Artifact")}
        </span>
        <span className="text-xs text-muted-foreground">
          {stateLabels[state] ?? state}
        </span>
      </span>
      <StateIcon state={state} />
    </button>
  )
}

function SafeErrorPart({ data }: AssistantDataProps) {
  const t = useExtracted()
  const part = data as { code?: string; message?: string; retryable?: boolean }
  /**
   * The sentences live here, not in `assistant-error-messages`, because the
   * extractor only sees `t("…")` where `t` came from `useExtracted()`. A helper
   * handed a `t` compiles and reads fine and ships untranslated English.
   */
  const sentences: Record<string, string> = {
    cancelled: t("You stopped this response."),
    assistant_run_failed: t("The response could not be generated."),
    assistant_restart_interrupted: t(
      "A restart interrupted this request. Send it again — Avermate never resends it to the provider on its own."
    ),
    provider_dispatch_unknown: t(
      "The provider may have received the request before it stopped. Check before trying again."
    ),
  }
  const presentation = errorPresentation(part)
  const sentence =
    presentation.kind === "known"
      ? sentences[presentation.code]!
      : presentation.kind === "raw"
        ? presentation.message
        : t("The response could not be generated.")
  const footnote = [
    presentation.kind === "raw" ? presentation.code : null,
    part.retryable ? t("You can try this again.") : null,
  ].filter(Boolean)

  return (
    <div
      role="alert"
      className="my-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertCircleIcon className="size-4" /> {sentence}
      </div>
      {footnote.length ? (
        <div className="mt-1 text-xs opacity-80">{footnote.join(" · ")}</div>
      ) : null}
    </div>
  )
}

/**
 * Which component draws which part of a message.
 *
 * This was a seven-branch `if` chain inside a component called
 * `UnknownDataPart` — which handled every *known* type and returned null for
 * the unknown one. A table says the same thing without the misnomer, and the
 * same shape as `tool-result-registry` next door.
 */
const DATA_PARTS: Record<string, ComponentType<AssistantDataProps>> = {
  status: StatusPart,
  plan: PlanPart,
  citation: CitationPart,
  question: QuestionPart,
  usage: UsagePart,
  artifact: ArtifactPart,
  "safe-error": SafeErrorPart,
}

function DataPart({ data, name }: DataMessagePartProps) {
  const Part = DATA_PARTS[name.replace(/^assistant-/, "")]
  return Part ? <Part data={data} name={name} /> : null
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

  const specializedResult = specialized ? (
    <AssistantSpecializedToolResult
      toolName={toolName}
      result={result}
      status={status?.type ?? "completed"}
      isError={Boolean(isError)}
    />
  ) : null

  if (ledger.action) {
    return (
      <div className="my-3 flex flex-col gap-3">
        <ActionCard action={ledger.action} operations={ledger.operations} />
        {specializedResult}
      </div>
    )
  }
  if (specializedResult) return specializedResult

  /**
   * The area it touched, not the function it called.
   *
   * This row read `materials.search` in a monospace face beside a terminal
   * icon, with a lowercase `done` badge — a developer console dropped into a
   * student's conversation. The exact name is not lost: it moved inside, next
   * to the JSON, which is where somebody who wants it will look.
   */
  const areaLabels: Record<string, string> = {
    materials: t("Your documents"),
    learning: t("Learning"),
    artifact: t("Generated document"),
    actions: t("Action"),
    planning: t("Planning"),
    grades: t("Grades"),
  }
  const areaLabel = areaLabels[toolName.split(".")[0] ?? ""] ?? t("Tool")

  return (
    <Collapsible className="my-2 overflow-hidden rounded-xl border bg-muted/20">
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
        render={<button type="button" />}
      >
        {running ? (
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <WrenchIcon className="size-4" />
        )}
        <span className="min-w-0 flex-1 truncate">{areaLabel}</span>
        <Badge variant={isError ? "destructive" : "outline"}>
          {isError ? t("Failed") : running ? t("Running") : t("Done")}
        </Badge>
        <ChevronDownIcon className="size-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <p className="px-3 pt-3 font-mono text-xs text-muted-foreground">
          {toolName}
        </p>
        <div className="grid gap-3 p-3 md:grid-cols-2">
          <div>
            {/* "Safe input" and "Safe result" meant redacted-and-safe-to-show,
                which is a promise the code makes to itself. A reader opening
                this wants to know which half is which. */}
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("What it was given")}
            </div>
            <pre className="max-h-52 overflow-auto rounded-lg bg-background p-2 text-xs">
              {trimJson(args)}
            </pre>
          </div>
          {result !== undefined ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {t("What it sent back")}
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
  data: { Fallback: DataPart },
  tools: { Fallback: ToolPart },
}

function MessageActions({ editable = false }: { editable?: boolean }) {
  const t = useExtracted()
  return (
    /*
     * Always there, not on hover.
     *
     * `autohide="not-last"` showed Copy and Retry only on the last message,
     * and only while the pointer was over it — so on a touch screen, where
     * there is no hover at all, they were unreachable, and on a mouse you had
     * to discover them by accident.
     *
     * `icon-sm`, like every other control in the assistant. These were the
     * only `icon-xs` left: 28px where everything around them was 36px on a
     * touch device, and there is no hover on a phone to make them any easier
     * to hit. Under a mouse they go 24px to 28px, which is the size the rail
     * and the composer already used.
     */
    <ActionBarPrimitive.Root
      hideWhenRunning
      className="mt-1 flex items-center gap-1"
    >
      <ActionBarPrimitive.Copy
        copiedDuration={1_500}
        aria-label={t("Copy message")}
        render={<Button variant="ghost" size="icon-sm" />}
      >
        <ClipboardIcon />
      </ActionBarPrimitive.Copy>
      {editable ? (
        <ActionBarPrimitive.Edit
          aria-label={t("Edit into a new branch")}
          render={<Button variant="ghost" size="icon-sm" />}
        >
          <PencilIcon />
        </ActionBarPrimitive.Edit>
      ) : (
        <ActionBarPrimitive.Reload
          aria-label={t("Retry response")}
          render={<Button variant="ghost" size="icon-sm" />}
        >
          <RefreshCcwIcon />
        </ActionBarPrimitive.Reload>
      )}
    </ActionBarPrimitive.Root>
  )
}

/**
 * The ring a message wears when a citation jumps to it.
 *
 * `assistant-client` sets `dataset.citationTarget` for three seconds after it
 * scrolls here. The rule was written out in all three message shells, so a
 * change to the highlight meant remembering three places — and a shell added
 * later would simply not light up.
 */
const CITATION_TARGET =
  "transition-[box-shadow,background-color] data-[citation-target=true]:bg-primary/5 data-[citation-target=true]:ring-2 data-[citation-target=true]:ring-primary/60"

/** What one person said: a bubble, right-aligned, with a tail. */
export function AssistantUserMessage() {
  return (
    <MessagePrimitive.Root
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col items-end rounded-xl px-3 py-3 md:px-6",
        CITATION_TARGET
      )}
    >
      {/* `empty:hidden` because the wrapper still carried its bottom margin
          when the message had no attachments, adding four dead pixels above
          every single user message. */}
      <div className="mb-1 flex max-w-[min(44rem,88%)] flex-wrap justify-end gap-1 empty:hidden">
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

/** What the assistant said: full width, no bubble — it is the page, not a reply. */
export function AssistantModelMessage() {
  return (
    <MessagePrimitive.Root
      className={cn(
        "mx-auto w-full max-w-3xl rounded-xl px-3 py-4 md:px-6",
        CITATION_TARGET
      )}
    >
      <div className="min-w-0">
        <MessagePrimitive.Parts components={partComponents} />
      </div>
      <MessageActions />
    </MessagePrimitive.Root>
  )
}

/** Something the system noted: quiet, and not addressed to anyone. */
export function AssistantSystemMessage() {
  return (
    <MessagePrimitive.Root
      className={cn(
        "mx-auto w-full max-w-3xl rounded-xl px-3 py-2 md:px-6",
        CITATION_TARGET
      )}
    >
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
          /* Ctrl+Enter, not Enter as in the main composer: editing an existing
             message is where you add a line, and losing a paragraph to a
             stray Return is worse than one extra key. */
          submitMode="ctrlEnter"
          aria-label={t("Edit message")}
          className="min-h-24 w-full resize-none bg-transparent text-sm outline-none"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="me-auto text-xs text-muted-foreground">
            {t("Ctrl + Enter to save")}
          </span>
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
