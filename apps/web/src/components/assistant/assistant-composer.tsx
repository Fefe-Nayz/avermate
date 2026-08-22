"use client"

import { ComposerPrimitive, ThreadPrimitive, useAui } from "@assistant-ui/react"
import {
  AtSignIcon,
  CheckIcon,
  FileAudioIcon,
  FileIcon,
  MicIcon,
  PaperclipIcon,
  SendIcon,
  ShieldCheckIcon,
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
              size="xs"
              variant="outline"
              onClick={() => audioInputRef.current?.click()}
            >
              <UploadIcon data-icon="inline-start" /> {t("Attach audio")}
            </Button>
            <Button
              type="button"
              size="xs"
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

export function AssistantComposer({
  models,
  skills,
  referenceOptions,
  selectedModelKey,
  selectedSkillId,
  planMode,
  approvalMode,
  references,
  placementLabel,
  actions,
  onAddReference,
  onRemoveReference,
}: {
  models: readonly ModelCapability[]
  skills: readonly AssistantSkillOption[]
  referenceOptions: readonly AssistantReferenceOption[]
  selectedModelKey: string
  selectedSkillId: string | null
  planMode: boolean
  approvalMode: "read-only" | "confirm-writes" | "auto-reversible"
  references: readonly AssistantPendingReference[]
  placementLabel: string
  actions: AssistantWorkspaceActions
  onAddReference: (reference: AssistantPendingReference) => void
  onRemoveReference: (clientId: string) => void
}) {
  const t = useExtracted()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const approvalModeOptions = [
    {
      value: "read-only" as const,
      label: t("Read only"),
    },
    {
      value: "confirm-writes" as const,
      label: t("Confirm changes"),
    },
    {
      value: "auto-reversible" as const,
      label: t("Automatic when reversible"),
    },
  ]

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
      <ComposerPrimitive.Root className="relative rounded-2xl border bg-card shadow-lg ring-foreground/5 focus-within:ring-2 focus-within:ring-ring/30">
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
        <div className="flex flex-wrap items-center gap-1 border-t px-2 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={uploading}
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
          <Select
            value={selectedModelKey}
            onValueChange={(value) => actions.setModel(String(value))}
          >
            <SelectTrigger
              size="sm"
              className="max-w-40 border-0 bg-transparent shadow-none"
            >
              <SelectValue placeholder={t("Model")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {models.map((model) => (
                  <SelectItem key={model.modelKey} value={model.modelKey}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={selectedSkillId ?? "none"}
            onValueChange={(value) =>
              actions.setSkill(value === "none" ? null : String(value))
            }
          >
            <SelectTrigger
              size="sm"
              className="max-w-36 border-0 bg-transparent shadow-none"
            >
              <SelectValue placeholder={t("Skill")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="none">{t("No skill")}</SelectItem>
                {skills
                  .filter((skill) => skill.enabled)
                  .map((skill) => (
                    <SelectItem key={skill.id} value={skill.id}>
                      {skill.label}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={planMode ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={planMode}
            onClick={() => actions.setPlanMode(!planMode)}
          >
            {t("Plan")}
          </Button>
          <Select
            items={approvalModeOptions}
            value={approvalMode}
            onValueChange={(value) => {
              if (value) actions.setApprovalMode(value)
            }}
          >
            <SelectTrigger
              size="sm"
              className="max-w-48 border-0 bg-transparent shadow-none"
              aria-label={t("Tool approval mode")}
            >
              <ShieldCheckIcon />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {approvalModeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <ShieldCheckIcon className="size-3.5" /> {placementLabel}
          </span>
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
              render={<Button type="submit" size="icon-sm" />}
            >
              <SendIcon />
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
        </div>
      </ComposerPrimitive.Root>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground sm:hidden">
        {placementLabel}
      </p>
    </div>
  )
}
