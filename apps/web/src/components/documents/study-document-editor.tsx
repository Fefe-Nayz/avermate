"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  BoldIcon,
  CheckIcon,
  CloudIcon,
  CloudOffIcon,
  Code2Icon,
  EyeIcon,
  Heading2Icon,
  ListIcon,
  PenLineIcon,
  PresentationIcon,
  SigmaIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { cn } from "@/lib/utils"
import { DocumentMarkdown } from "./document-markdown"
import { DocumentPptxExport } from "./document-pptx-export"
import {
  DOCUMENT_AUTOSAVE_DELAY_MS,
  DOCUMENT_BODY_MAX_BYTES,
  DOCUMENT_CALLOUT_KINDS,
  DOCUMENT_CALLOUT_SNIPPETS,
  documentBodyByteLength,
  documentDraftIsDirty,
  documentDraftIsValid,
  isDocumentConflictError,
  type DocumentCalloutKind,
  type DocumentDraftSnapshot,
} from "./document-model"
import type { MarkdownInsertRequest } from "./markdown-editor"
import { MindmapDocumentEditor } from "./mindmap-document-editor"
import { QuizDocumentEditor } from "./quiz-document-editor"
import { slideDeckIssue, SLIDE_SEPARATOR } from "./slide-deck-model"
import { SlideDeckView } from "./slide-deck-view"
import type { EditableStudyDocumentResult } from "./document-types"

const MarkdownEditor = dynamic(
  () => import("./markdown-editor").then((module) => module.MarkdownEditor),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[30rem] place-items-center">
        <Spinner className="size-5" />
      </div>
    ),
  }
)

type SaveBlock = { kind: "conflict" | "error"; message: string } | null
type MobilePane = "write" | "preview"

export function StudyDocumentEditor({ documentId }: { documentId: string }) {
  const t = useExtracted()
  const query = useQuery({
    ...orpc.documents.getForEdit.queryOptions({ input: { documentId } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  if (query.isPending) {
    return <div className="h-[70vh] animate-pulse rounded-xl bg-muted/50" />
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>{t("The document could not be loaded.")}</AlertTitle>
        <AlertDescription>
          {query.error.message || t("This document could not be loaded.")}
        </AlertDescription>
      </Alert>
    )
  }

  const initial = query.data as EditableStudyDocumentResult
  if (initial.document.kind === "mindmap") {
    return <MindmapDocumentEditor key={documentId} initial={initial} />
  }
  if (initial.document.kind === "quiz") {
    return <QuizDocumentEditor key={documentId} initial={initial} />
  }

  return <LoadedStudyDocumentEditor key={documentId} initial={initial} />
}

function LoadedStudyDocumentEditor({
  initial,
}: {
  initial: EditableStudyDocumentResult
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const documentId = initial.document.id
  const [title, setTitle] = useState(initial.document.title)
  const [bodyMarkdown, setBodyMarkdown] = useState(
    initial.document.bodyMarkdown
  )
  const [revision, setRevision] = useState(initial.document.revision)
  const [saved, setSaved] = useState<DocumentDraftSnapshot>({
    title: initial.document.title,
    bodyMarkdown: initial.document.bodyMarkdown,
  })
  const [saveBlock, setSaveBlock] = useState<SaveBlock>(null)
  const [reloading, setReloading] = useState(false)
  const [mobilePane, setMobilePane] = useState<MobilePane>("write")
  const [insertRequest, setInsertRequest] =
    useState<MarkdownInsertRequest | null>(null)
  const [insertionId, setInsertionId] = useState(0)

  const draft = useMemo(() => ({ title, bodyMarkdown }), [bodyMarkdown, title])
  const dirty = documentDraftIsDirty(draft, saved)
  const isSlideDeck = initial.document.kind === "slides"
  const slidesIssue = isSlideDeck ? slideDeckIssue(bodyMarkdown) : null
  const valid = documentDraftIsValid(draft) && !slidesIssue
  const bodyBytes = documentBodyByteLength(bodyMarkdown)
  const exactQueryKey = orpc.documents.getForEdit.queryKey({
    input: { documentId },
  })

  const update = useMutation({
    ...orpc.documents.update.mutationOptions(),
    onSuccess: async (result, variables) => {
      const updated = result as EditableStudyDocumentResult
      setRevision(updated.document.revision)
      setSaved({
        title: variables.title ?? updated.document.title,
        bodyMarkdown: variables.bodyMarkdown ?? updated.document.bodyMarkdown,
      })
      setSaveBlock(null)
      queryClient.setQueryData(exactQueryKey, updated)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.documents.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.documents.get.queryKey({ input: { documentId } }),
        }),
      ])
    },
    onError: (error: Error) => {
      haptic("error")
      setSaveBlock({
        kind: isDocumentConflictError(error) ? "conflict" : "error",
        message: error.message || t("The document could not be saved."),
      })
    },
  })

  const mutateUpdate = update.mutate

  const saveNow = () => {
    if (!dirty || !valid || update.isPending || saveBlock) return
    update.mutate({
      documentId,
      revision,
      title,
      bodyMarkdown,
    })
  }

  useEffect(() => {
    if (!dirty || !valid || update.isPending || saveBlock) return
    const timer = window.setTimeout(() => {
      mutateUpdate({
        documentId,
        revision,
        title,
        bodyMarkdown,
      })
    }, DOCUMENT_AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [
    bodyMarkdown,
    dirty,
    documentId,
    revision,
    saveBlock,
    title,
    mutateUpdate,
    update.isPending,
    valid,
  ])

  useEffect(() => {
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [dirty])

  const noteLocalEdit = () => {
    setSaveBlock((current) => (current?.kind === "conflict" ? current : null))
  }

  const reloadServerVersion = async () => {
    setReloading(true)
    try {
      const latest = (await queryClient.fetchQuery({
        ...orpc.documents.getForEdit.queryOptions({ input: { documentId } }),
        staleTime: 0,
      })) as EditableStudyDocumentResult
      const next = {
        title: latest.document.title,
        bodyMarkdown: latest.document.bodyMarkdown,
      }
      setTitle(next.title)
      setBodyMarkdown(next.bodyMarkdown)
      setSaved(next)
      setRevision(latest.document.revision)
      setSaveBlock(null)
      toast.success(t("Server version reloaded."))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("The document could not be reloaded.")
      )
    } finally {
      setReloading(false)
    }
  }

  const copyLocalDraft = async () => {
    try {
      await navigator.clipboard.writeText(`# ${title}\n\n${bodyMarkdown}`)
      toast.success(t("Local draft copied."))
    } catch {
      toast.error(t("The local draft could not be copied."))
    }
  }

  const queueInsertion = (text: string) => {
    const id = insertionId + 1
    setInsertionId(id)
    setInsertRequest({ id, text })
    setMobilePane("write")
  }

  const titleInvalid = !title.trim() || title.trim().length > 160
  const bodyTooLarge = bodyBytes > DOCUMENT_BODY_MAX_BYTES
  const saveLabel = update.isPending
    ? t("Saving…")
    : saveBlock?.kind === "conflict"
      ? t("Save conflict")
      : saveBlock
        ? t("Save paused")
        : bodyTooLarge || titleInvalid
          ? t("Cannot save")
          : dirty
            ? t("Unsaved changes")
            : t("Saved")

  return (
    <>
      <PageMeta title={title || t("Untitled document")} subtitle={saveLabel} />
      <PageActions>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || !valid || update.isPending || Boolean(saveBlock)}
          onClick={saveNow}
        >
          {update.isPending ? <Spinner /> : <CloudIcon />}
          <span className="hidden sm:inline">{t("Save now")}</span>
        </Button>
      </PageActions>

      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-3 pb-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <label htmlFor="study-document-title" className="sr-only">
              {t("Document title")}
            </label>
            <Input
              id="study-document-title"
              value={title}
              maxLength={160}
              aria-invalid={titleInvalid || undefined}
              className="h-11 border-transparent px-1 text-xl font-semibold shadow-none focus-visible:border-ring md:text-2xl"
              onChange={(event) => {
                setTitle(event.target.value)
                noteLocalEdit()
              }}
            />
          </div>
          <div
            aria-live="polite"
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground",
              saveBlock && "text-destructive"
            )}
          >
            {update.isPending ? (
              <Spinner className="size-3.5" />
            ) : saveBlock ? (
              <CloudOffIcon className="size-3.5" />
            ) : dirty ? (
              <CloudIcon className="size-3.5" />
            ) : (
              <CheckIcon className="size-3.5" />
            )}
            {saveLabel}
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<a href={`/materials/fiches/${documentId}`} />}
          >
            <EyeIcon /> {t("Read")}
          </Button>
          {isSlideDeck ? (
            <>
              <Button
                variant="outline"
                size="sm"
                render={<a href={`/materials/fiches/${documentId}/present`} />}
              >
                <PresentationIcon /> {t("Present")}
              </Button>
              <DocumentPptxExport
                documentId={documentId}
                revision={revision}
                disabled={
                  dirty || !valid || update.isPending || Boolean(saveBlock)
                }
              />
            </>
          ) : null}
        </header>

        {saveBlock ? (
          <Alert
            variant={saveBlock.kind === "error" ? "destructive" : "default"}
            className={
              saveBlock.kind === "conflict"
                ? "border-band-weak bg-band-weak/8"
                : undefined
            }
          >
            <AlertTriangleIcon />
            <AlertTitle>
              {saveBlock.kind === "conflict"
                ? t("This document changed elsewhere")
                : t("Autosave paused")}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {saveBlock.kind === "conflict"
                  ? t(
                      "Your local text is still here and will not be overwritten. Copy it or reload the server version."
                    )
                  : saveBlock.message}
              </p>
              <div className="flex flex-wrap gap-2">
                {saveBlock.kind === "conflict" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={copyLocalDraft}
                    >
                      {t("Copy local draft")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={reloading}
                      onClick={reloadServerVersion}
                    >
                      {reloading ? <Spinner /> : null}
                      {t("Reload server version")}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setSaveBlock(null)
                      if (dirty && valid && !update.isPending) {
                        update.mutate({
                          documentId,
                          revision,
                          title,
                          bodyMarkdown,
                        })
                      }
                    }}
                  >
                    {t("Retry")}
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {titleInvalid || bodyTooLarge || slidesIssue ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("This draft cannot be saved yet.")}</AlertTitle>
            <AlertDescription>
              {titleInvalid
                ? t("Give the document a title of at most 160 characters.")
                : bodyTooLarge
                  ? t("Keep the document body under 512 KiB.")
                  : t("Keep the slide deck to at most 100 slides.")}
            </AlertDescription>
          </Alert>
        ) : null}

        <DocumentToolbar slides={isSlideDeck} onInsert={queueInsertion} />

        <div
          className="flex rounded-lg border bg-muted/30 p-0.5 lg:hidden"
          role="group"
          aria-label={t("Editor pane")}
        >
          <Button
            aria-pressed={mobilePane === "write"}
            variant={mobilePane === "write" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1"
            onClick={() => setMobilePane("write")}
          >
            <PenLineIcon /> {t("Write")}
          </Button>
          <Button
            aria-pressed={mobilePane === "preview"}
            variant={mobilePane === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1"
            onClick={() => setMobilePane("preview")}
          >
            <EyeIcon /> {t("Preview")}
          </Button>
        </div>

        <div className="grid min-h-[34rem] overflow-hidden rounded-xl border bg-card lg:grid-cols-2 lg:divide-x">
          <section
            aria-label={t("Markdown editor")}
            className={cn(
              "min-w-0 overflow-hidden",
              mobilePane !== "write" && "hidden lg:block"
            )}
          >
            <MarkdownEditor
              value={bodyMarkdown}
              ariaLabel={t("Document markdown")}
              insertRequest={insertRequest}
              onChange={(value) => {
                setBodyMarkdown(value)
                noteLocalEdit()
              }}
            />
          </section>
          <section
            aria-label={
              isSlideDeck ? t("Slide deck preview") : t("Live preview")
            }
            className={cn(
              "min-w-0 overflow-auto p-5 sm:p-7",
              mobilePane !== "preview" && "hidden lg:block"
            )}
          >
            {isSlideDeck ? (
              <SlideDeckView markdown={bodyMarkdown} compact />
            ) : (
              <DocumentMarkdown
                markdown={bodyMarkdown}
                ariaLabel={t("Live markdown preview")}
                empty={
                  <div className="grid min-h-80 place-items-center text-center text-sm text-muted-foreground">
                    {t("Start writing to see the preview.")}
                  </div>
                }
              />
            )}
          </section>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          {t("{used} of 512 KiB", {
            used: `${Math.ceil(bodyBytes / 1024)} KiB`,
          })}
        </p>
      </div>
    </>
  )
}

function DocumentToolbar({
  slides,
  onInsert,
}: {
  slides: boolean
  onInsert: (text: string) => void
}) {
  const t = useExtracted()
  const calloutLabels: Record<DocumentCalloutKind, string> = {
    DEF: t("Definition"),
    THM: t("Theorem"),
    METH: t("Method"),
    PIEGE: t("Common pitfall"),
    CHECK: t("Check point"),
  }
  const tools = [
    ...(slides
      ? [
          {
            label: t("New slide"),
            icon: PresentationIcon,
            text: SLIDE_SEPARATOR,
          },
        ]
      : []),
    { label: t("Heading"), icon: Heading2Icon, text: "## Heading\n\n" },
    { label: t("Bold"), icon: BoldIcon, text: "**important**" },
    {
      label: t("List"),
      icon: ListIcon,
      text: "- First point\n- Second point\n",
    },
    {
      label: t("Code block"),
      icon: Code2Icon,
      text: "```\ncode\n```\n\n",
    },
    {
      label: t("Formula"),
      icon: SigmaIcon,
      text: "$$\n\\int_0^1 f(x)\\,dx\n$$\n\n",
    },
  ]

  return (
    <div
      role="toolbar"
      aria-label={t("Markdown tools")}
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-card p-1"
    >
      {tools.map(({ label, icon: Icon, text }) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          className="shrink-0"
          onClick={() => onInsert(text)}
        >
          <Icon />
        </Button>
      ))}
      <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
      {DOCUMENT_CALLOUT_KINDS.map((kind) => (
        <Button
          key={kind}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("Insert {label} callout", {
            label: calloutLabels[kind],
          })}
          title={calloutLabels[kind]}
          className="shrink-0"
          onClick={() => onInsert(DOCUMENT_CALLOUT_SNIPPETS[kind])}
        >
          {/* The word, not the code. The readable label was already here —
              it was the tooltip — while the button itself showed `DEF`,
              `THM`, `PIEGE` in a 10.88px monospace face. The toolbar scrolls,
              so the words fit. */}
          {calloutLabels[kind]}
        </Button>
      ))}
    </div>
  )
}
