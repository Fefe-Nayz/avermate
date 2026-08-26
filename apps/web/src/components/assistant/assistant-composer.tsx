"use client"

import { ComposerPrimitive, ThreadPrimitive, useAui } from "@assistant-ui/react"
import {
  AtSignIcon,
  CheckIcon,
  FileAudioIcon,
  FileIcon,
  ListTodoIcon,
  MicIcon,
  PaperclipIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { useRef, useState, type ClipboardEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useExtracted } from "next-intl"
import type {
  AssistantPendingReference,
  AssistantReferenceOption,
  AssistantSkillOption,
  AssistantWorkspaceActions,
  ModelCapability,
} from "./assistant-types"
import { useAssistantDictation } from "./use-assistant-dictation"

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function DictationControls({
  transcribe,
}: {
  transcribe: (file: File) => Promise<string>
}) {
  const t = useExtracted()
  const aui = useAui()
  const audioInputRef = useRef<HTMLInputElement>(null)
  const dictation = useAssistantDictation({
    transcribe,
    onTranscript: (text) => {
      const current = aui.composer.getState().text.trim()
      aui.composer.setText(current ? `${current}\n\n${text}` : text)
    },
  })
  const { state } = dictation

  return (
    <>
      <input
        ref={audioInputRef}
        className="sr-only"
        type="file"
        accept="audio/*"
        aria-label={t("Attach audio for dictation")}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.currentTarget.value = ""
          if (file) void dictation.useAudioFile(file)
        }}
      />
      {state.phase === "recording" ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => void dictation.stop()}
          aria-label={t("Stop dictation recording")}
        >
          <SquareIcon data-icon="inline-start" />
          {formatDuration(state.elapsedMs)}
          <span
            className="ml-1 h-1.5 w-8 overflow-hidden rounded-full bg-current/20"
            aria-hidden="true"
          >
            <span
              className="block h-full bg-current transition-[width] motion-reduce:transition-none"
              style={{ width: `${Math.round(state.level * 100)}%` }}
            />
          </span>
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={
            state.phase === "requesting" || state.phase === "transcribing"
          }
          aria-label={t("Dictate message")}
          onClick={() => void dictation.start()}
        >
          <MicIcon />
        </Button>
      )}

      {state.phase === "review" && state.recording ? (
        <div className="absolute inset-x-3 bottom-full mb-2 rounded-xl border bg-popover p-3 shadow-lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <FileAudioIcon className="size-5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t("Review dictation")}</div>
              <div className="text-xs text-muted-foreground">
                {formatDuration(state.recording.durationMs)} ·{" "}
                {t("Nothing will be sent automatically.")}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={dictation.cancel}
            >
              <Trash2Icon />
              <span className="sr-only">{t("Discard dictation")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void dictation.transcribe()}
            >
              <CheckIcon data-icon="inline-start" />
              {t("Insert transcript")}
            </Button>
          </div>
          {state.previewUrl ? (
            <audio
              className="mt-3 w-full"
              controls
              src={state.previewUrl}
              aria-label={t("Dictation preview")}
            />
          ) : null}
        </div>
      ) : null}

      {state.phase === "error" && state.error ? (
        <div
          role="alert"
          className="absolute inset-x-3 bottom-full mb-2 rounded-xl border border-destructive/30 bg-popover p-3 text-sm shadow-lg"
        >
          <div className="font-medium text-destructive">
            {state.error.message}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {state.error.action}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => audioInputRef.current?.click()}
            >
              <UploadIcon data-icon="inline-start" /> {t("Attach audio")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={dictation.cancel}
            >
              {t("Dismiss")}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function ReferencePicker({
  options,
  selected,
  onAdd,
}: {
  options: readonly AssistantReferenceOption[]
  selected: readonly AssistantPendingReference[]
  onAdd: (reference: AssistantPendingReference) => void
}) {
  const t = useExtracted()
  const [open, setOpen] = useState(false)
  const selectedIds = new Set(selected.map((item) => item.clientId))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" />}
        aria-label={t("Reference an Avermate item")}
      >
        <AtSignIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t("Search grades, courses and files…")} />
          <CommandList>
            <CommandEmpty>{t("No matching Avermate item.")}</CommandEmpty>
            <CommandGroup heading={t("Reference")}>
              {options.map((option) => (
                <CommandItem
                  key={option.clientId}
                  value={`${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`}
                  disabled={selectedIds.has(option.clientId)}
                  onSelect={() => {
                    onAdd(option)
                    setOpen(false)
                  }}
                >
                  <FileIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Where you write.
 *
 * It had seven controls in the bar under the text field — attach, references,
 * dictation, model, skill, plan, and a tool-approval dropdown — plus a caption
 * reading things like "BYOK · anthropic receives selected context". On a phone
 * that wrapped into three rows of chrome above the one thing anybody came here
 * to use, and the caption named an internal deployment model at somebody
 * trying to ask about their maths homework.
 *
 * So this bar holds only what you touch while writing a message: attach,
 * reference, dictate, send. Two settings that genuinely change what a message
 * *is* — which model answers, and whether it plans first — stay, the first
 * folded behind one control instead of two selects.
 *
 * What left: the approval mode and the placement caption. Neither is a
 * per-message choice. Both are disclosures about what the assistant may do and
 * where it runs, they belong to the conversation rather than to the sentence
 * you are typing, and they now sit in its header — in words a reader can
 * actually parse.
 */
export function AssistantComposer({
  models,
  skills,
  referenceOptions,
  selectedModelKey,
  selectedSkillId,
  planMode,
  references,
  actions,
  onAddReference,
  onRemoveReference,
  blockedReason = null,
}: {
  models: readonly ModelCapability[]
  skills: readonly AssistantSkillOption[]
  referenceOptions: readonly AssistantReferenceOption[]
  selectedModelKey: string
  selectedSkillId: string | null
  planMode: boolean
  references: readonly AssistantPendingReference[]
  actions: AssistantWorkspaceActions
  onAddReference: (reference: AssistantPendingReference) => void
  onRemoveReference: (clientId: string) => void
  /**
   * Why this message cannot be sent yet, or null when it can.
   *
   * The pane used to unmount the whole composer when the reader went offline
   * or no model was ready. Losing your network mid-sentence lost the sentence
   * with it, and the box you were typing in vanished from under the cursor.
   * The composer stays, keeps the draft, and says what is in the way.
   */
  blockedReason?: string | null
}) {
  const t = useExtracted()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const blocked = blockedReason !== null

  const uploadFiles = async (files: readonly File[]) => {
    if (!files.length || uploading) return
    setUploading(true)
    try {
      for (const file of files)
        onAddReference(await actions.uploadAttachment(file))
    } finally {
      setUploading(false)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    void uploadFiles(files)
  }

  return (
    <div className="relative mx-auto w-full max-w-3xl px-3 pb-3 md:px-6 md:pb-5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label={t("Attach files")}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.currentTarget.value = ""
          void uploadFiles(files)
        }}
      />
      <ComposerPrimitive.Root className="relative rounded-2xl border bg-card shadow-lg ring-foreground/5 focus-within:ring-2 focus-within:ring-ring/50">
        {references.length ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {references.map((reference) => (
              <Badge
                key={reference.clientId}
                variant="secondary"
                className="max-w-full gap-1"
              >
                <span className="truncate">{reference.label}</span>
                <button
                  type="button"
                  className="rounded-full hover:bg-foreground/10"
                  onClick={() => onRemoveReference(reference.clientId)}
                  aria-label={t("Remove {name}", { name: reference.label })}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        <ComposerPrimitive.Input
          submitMode="enter"
          addAttachmentOnPaste={false}
          onPaste={onPaste}
          placeholder={t("Ask about your courses, grades or documents…")}
          className="max-h-52 min-h-20 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        {blockedReason ? (
          <p
            role="status"
            className="border-t px-4 py-2 text-xs text-muted-foreground"
          >
            {blockedReason}
          </p>
        ) : null}
        {/* One row, and it must stay one row: `flex-nowrap` with the labels
            hidden on narrow screens, rather than wrapping into a second and
            third band of chrome above the field. */}
        <div className="flex flex-nowrap items-center gap-0.5 border-t px-2 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={uploading || blocked}
            aria-label={t("Attach a file")}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <ReferencePicker
            options={referenceOptions}
            selected={references}
            onAdd={onAddReference}
          />
          <DictationControls transcribe={actions.transcribeDictation} />

          <ModelPicker
            models={models}
            skills={skills}
            selectedModelKey={selectedModelKey}
            selectedSkillId={selectedSkillId}
            onSelectModel={(key) => actions.setModel(key)}
            onSelectSkill={(id) => actions.setSkill(id)}
          />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={planMode ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-pressed={planMode}
                  aria-label={t("Plan before answering")}
                  onClick={() => actions.setPlanMode(!planMode)}
                />
              }
            >
              <ListTodoIcon />
            </TooltipTrigger>
            <TooltipContent>{t("Plan before answering")}</TooltipContent>
          </Tooltip>

          <div className="ms-auto flex items-center">
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel
                aria-label={t("Stop generation")}
                render={
                  <Button type="button" variant="destructive" size="icon-sm" />
                }
              >
                <SquareIcon />
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send
                aria-label={t("Send message")}
                disabled={blocked}
                render={<Button type="submit" size="icon-sm" />}
              >
                <SendIcon />
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  )
}

/**
 * Which model answers, and with which skill — one control, not two selects.
 *
 * They were two dropdowns side by side, each with its own placeholder, taking
 * a third of the bar to express a choice most people make once. Folded into a
 * single button that says what is currently answering, which is the only part
 * worth reading at a glance.
 */
function ModelPicker({
  models,
  skills,
  selectedModelKey,
  selectedSkillId,
  onSelectModel,
  onSelectSkill,
}: {
  models: readonly ModelCapability[]
  skills: readonly AssistantSkillOption[]
  selectedModelKey: string
  selectedSkillId: string | null
  onSelectModel: (modelKey: string) => void
  onSelectSkill: (skillId: string | null) => void
}) {
  const t = useExtracted()
  const [open, setOpen] = useState(false)
  const model = models.find((entry) => entry.modelKey === selectedModelKey)
  const enabledSkills = skills.filter((skill) => skill.enabled)
  const skill = enabledSkills.find((entry) => entry.id === selectedSkillId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-0 gap-1.5 px-2 font-normal"
          />
        }
        aria-label={t("Model and skill")}
      >
        <SlidersHorizontalIcon className="shrink-0" />
        <span className="hidden max-w-28 truncate sm:inline">
          {model?.label ?? t("Model")}
        </span>
        {skill ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t("Search…")} />
          <CommandList>
            <CommandEmpty>{t("Nothing matches.")}</CommandEmpty>
            <CommandGroup heading={t("Model")}>
              {models.map((entry) => (
                <CommandItem
                  key={entry.modelKey}
                  value={`model ${entry.label}`}
                  onSelect={() => {
                    onSelectModel(entry.modelKey)
                    setOpen(false)
                  }}
                >
                  <CheckIcon
                    className={
                      entry.modelKey === selectedModelKey
                        ? "opacity-100"
                        : "opacity-0"
                    }
                  />
                  <span className="truncate">{entry.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {enabledSkills.length ? (
              <CommandGroup heading={t("Skill")}>
                <CommandItem
                  value="skill none"
                  onSelect={() => {
                    onSelectSkill(null)
                    setOpen(false)
                  }}
                >
                  <CheckIcon
                    className={selectedSkillId ? "opacity-0" : "opacity-100"}
                  />
                  <span>{t("No skill")}</span>
                </CommandItem>
                {enabledSkills.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={`skill ${entry.label}`}
                    onSelect={() => {
                      onSelectSkill(entry.id)
                      setOpen(false)
                    }}
                  >
                    <CheckIcon
                      className={
                        entry.id === selectedSkillId
                          ? "opacity-100"
                          : "opacity-0"
                      }
                    />
                    <span className="truncate">{entry.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
