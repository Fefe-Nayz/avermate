"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CheckIcon,
  CloudIcon,
  CloudOffIcon,
  EyeIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ListPlusIcon,
  NetworkIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { haptic } from "@/lib/haptics"
import { randomId } from "@/lib/id"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import {
  DOCUMENT_AUTOSAVE_DELAY_MS,
  isDocumentConflictError,
} from "./document-model"
import {
  addMindmapChild,
  addMindmapSibling,
  deleteMindmapNode,
  flattenMindmap,
  indentMindmapNode,
  mindmapContentIssue,
  MINDMAP_LABEL_MAX_LENGTH,
  MINDMAP_MAX_DEPTH,
  MINDMAP_MAX_NODES,
  MINDMAP_NOTE_MAX_LENGTH,
  outdentMindmapNode,
  setMindmapLabel,
  setMindmapNote,
  type MindmapContentV1,
  type MindmapNodeV1,
} from "./mindmap-model"
import {
  isMindmapContent,
  type EditableStudyDocumentResult,
} from "./document-types"

const MindmapCanvas = dynamic(
  () => import("./mindmap-canvas").then((module) => module.MindmapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-80 place-items-center bg-muted/20">
        <Spinner className="size-5" />
      </div>
    ),
  }
)

type SaveBlock = { kind: "conflict" | "error"; message: string } | null

export function MindmapDocumentEditor({
  initial,
}: {
  initial: EditableStudyDocumentResult
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const documentId = initial.document.id
  const initialContent = isMindmapContent(initial.document.metaJson)
    ? initial.document.metaJson
    : null
  const [title, setTitle] = useState(initial.document.title)
  const [content, setContent] = useState<MindmapContentV1 | null>(
    initialContent
  )
  const [revision, setRevision] = useState(initial.document.revision)
  const [savedTitle, setSavedTitle] = useState(initial.document.title)
  const [savedContent, setSavedContent] = useState(() =>
    initialContent ? JSON.stringify(initialContent) : ""
  )
  const [selectedId, setSelectedId] = useState(initialContent?.root.id ?? null)
  const [saveBlock, setSaveBlock] = useState<SaveBlock>(null)
  const [reloading, setReloading] = useState(false)
  const exactQueryKey = orpc.documents.getForEdit.queryKey({
    input: { documentId },
  })
  const rows = useMemo(
    () => (content ? flattenMindmap(content) : []),
    [content]
  )
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0]
  const contentJson = content ? JSON.stringify(content) : ""
  const dirty = title !== savedTitle || contentJson !== savedContent
  const titleInvalid = !title.trim() || title.trim().length > 160
  const contentIssue = content ? mindmapContentIssue(content) : "invalid"
  const valid = !titleInvalid && !contentIssue

  const update = useMutation({
    ...orpc.documents.update.mutationOptions(),
    onSuccess: async (result, variables) => {
      const updated = result as EditableStudyDocumentResult
      const savedMeta = isMindmapContent(variables.metaJson)
        ? variables.metaJson
        : isMindmapContent(updated.document.metaJson)
          ? updated.document.metaJson
          : null
      setRevision(updated.document.revision)
      setSavedTitle(variables.title ?? updated.document.title)
      if (savedMeta) setSavedContent(JSON.stringify(savedMeta))
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
        message: error.message || t("The mind map could not be saved."),
      })
    },
  })
  const mutateUpdate = update.mutate

  const saveNow = () => {
    if (!content || !dirty || !valid || update.isPending || saveBlock) return
    update.mutate({
      documentId,
      revision,
      title,
      bodyMarkdown: "",
      metaJson: content,
    })
  }

  useEffect(() => {
    if (!content || !dirty || !valid || update.isPending || saveBlock) return
    const timer = window.setTimeout(() => {
      mutateUpdate({
        documentId,
        revision,
        title,
        bodyMarkdown: "",
        metaJson: content,
      })
    }, DOCUMENT_AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [
    content,
    dirty,
    documentId,
    mutateUpdate,
    revision,
    saveBlock,
    title,
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

  const changeContent = (next: MindmapContentV1) => {
    setContent(next)
    noteLocalEdit()
  }

  const newNode = () => ({ id: `node:${randomId()}`, label: t("New idea") })

  const addChild = (parentId: string) => {
    if (!content) return
    const node = newNode()
    const next = addMindmapChild(content, parentId, node)
    if (next !== content) {
      changeContent(next)
      setSelectedId(node.id)
    }
  }

  const addSibling = (targetId: string) => {
    if (!content) return
    const node = newNode()
    const next = addMindmapSibling(content, targetId, node)
    if (next !== content) {
      changeContent(next)
      setSelectedId(node.id)
    }
  }

  const indent = (nodeId: string) => {
    if (!content) return
    changeContent(indentMindmapNode(content, nodeId))
  }

  const outdent = (nodeId: string) => {
    if (!content) return
    changeContent(outdentMindmapNode(content, nodeId))
  }

  const removeNode = (nodeId: string) => {
    if (!content || nodeId === content.root.id) return
    const next = deleteMindmapNode(content, nodeId)
    if (next !== content) {
      changeContent(next)
      setSelectedId(content.root.id)
    }
  }

  const reloadServerVersion = async () => {
    setReloading(true)
    try {
      const latest = (await queryClient.fetchQuery({
        ...orpc.documents.getForEdit.queryOptions({ input: { documentId } }),
        staleTime: 0,
      })) as EditableStudyDocumentResult
      if (!isMindmapContent(latest.document.metaJson)) {
        throw new Error(t("The server mind map is invalid."))
      }
      setTitle(latest.document.title)
      setContent(latest.document.metaJson)
      setSavedTitle(latest.document.title)
      setSavedContent(JSON.stringify(latest.document.metaJson))
      setRevision(latest.document.revision)
      setSelectedId(latest.document.metaJson.root.id)
      setSaveBlock(null)
      toast.success(t("Server version reloaded."))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("The mind map could not be reloaded.")
      )
    } finally {
      setReloading(false)
    }
  }

  const copyLocalDraft = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ title, content }, null, 2)
      )
      toast.success(t("Local mind map copied."))
    } catch {
      toast.error(t("The local mind map could not be copied."))
    }
  }

  const saveLabel = update.isPending
    ? t("Saving…")
    : saveBlock?.kind === "conflict"
      ? t("Save conflict")
      : saveBlock
        ? t("Save paused")
        : !valid
          ? t("Cannot save")
          : dirty
            ? t("Unsaved changes")
            : t("Saved")

  if (!content) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>{t("This mind map cannot be edited.")}</AlertTitle>
        <AlertDescription>
          {t("Its structured content is missing or invalid.")}
        </AlertDescription>
      </Alert>
    )
  }

  const renderOutlineNode = (node: MindmapNodeV1, depth: number): ReactNode => {
    const root = depth === 0
    const children = node.children ?? []
    return (
      <li key={node.id}>
        <div
          className={cn(
            "group flex min-w-0 items-center gap-1 rounded-lg border p-1",
            selected?.id === node.id
              ? "border-primary/40 bg-primary/5"
              : "border-transparent hover:bg-muted/60"
          )}
        >
          <NetworkIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
          <label htmlFor={`mindmap-label-${node.id}`} className="sr-only">
            {t("Idea label at level {level}", {
              level: String(depth + 1),
            })}
          </label>
          <Input
            id={`mindmap-label-${node.id}`}
            value={node.label}
            maxLength={MINDMAP_LABEL_MAX_LENGTH}
            aria-invalid={!node.label.trim() || undefined}
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1.5 shadow-none"
            onFocus={() => setSelectedId(node.id)}
            onChange={(event) => {
              setSelectedId(node.id)
              changeContent(
                setMindmapLabel(content, node.id, event.target.value)
              )
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.altKey) {
                event.preventDefault()
                if (root) addChild(node.id)
                else addSibling(node.id)
              } else if (event.altKey && event.key === "ArrowRight") {
                event.preventDefault()
                indent(node.id)
              } else if (event.altKey && event.key === "ArrowLeft") {
                event.preventDefault()
                outdent(node.id)
              } else if (
                event.key === "Backspace" &&
                (event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault()
                removeNode(node.id)
              }
            }}
          />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t("Add an idea after {label}", {
              label: node.label,
            })}
            disabled={root || rows.length >= MINDMAP_MAX_NODES}
            onClick={() => addSibling(node.id)}
          >
            <ListPlusIcon />
          </Button>
        </div>
        {children.length > 0 ? (
          <ul className="ml-3 space-y-1 border-l border-border pl-2">
            {children.map((child) => renderOutlineNode(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    <>
      <PageMeta title={title || t("Untitled mind map")} subtitle={saveLabel} />
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
            <label htmlFor="mindmap-document-title" className="sr-only">
              {t("Mind map title")}
            </label>
            <Input
              id="mindmap-document-title"
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
        </header>

        {saveBlock ? (
          <Alert
            variant={saveBlock.kind === "error" ? "destructive" : "default"}
          >
            <AlertTriangleIcon />
            <AlertTitle>
              {saveBlock.kind === "conflict"
                ? t("This mind map changed elsewhere")
                : t("Autosave paused")}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {saveBlock.kind === "conflict"
                  ? t(
                      "Your local mind map is still here and will not be overwritten. Copy it or reload the server version."
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
                      {t("Copy local mind map")}
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
                  <Button size="sm" onClick={() => setSaveBlock(null)}>
                    {t("Retry")}
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {titleInvalid || contentIssue ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("This mind map cannot be saved yet.")}</AlertTitle>
            <AlertDescription>
              {titleInvalid
                ? t("Give the document a title of at most 160 characters.")
                : t(
                    "Keep every label filled, with at most 500 ideas, 8 levels and 512 KiB of structured content."
                  )}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid min-h-[38rem] gap-4 xl:grid-cols-[minmax(23rem,0.85fr)_minmax(0,1.4fr)]">
          <section
            aria-labelledby="mindmap-editor-outline-heading"
            className="flex min-h-0 flex-col rounded-xl border bg-card"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <div>
                <h2
                  id="mindmap-editor-outline-heading"
                  className="font-semibold"
                >
                  {t("Outline editor")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("{count} of {maximum} ideas", {
                    count: String(rows.length),
                    maximum: String(MINDMAP_MAX_NODES),
                  })}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !selected ||
                  selected.depth >= MINDMAP_MAX_DEPTH - 1 ||
                  rows.length >= MINDMAP_MAX_NODES
                }
                onClick={() => selected && addChild(selected.id)}
              >
                <PlusIcon /> {t("Add child")}
              </Button>
            </header>

            <div className="max-h-[36rem] flex-1 overflow-auto p-2">
              <ul
                aria-label={t("Editable mind map outline")}
                className="space-y-1"
              >
                {renderOutlineNode(content.root, 0)}
              </ul>
            </div>

            {selected ? (
              <div className="space-y-3 border-t p-3">
                <div
                  className="flex flex-wrap gap-1"
                  role="toolbar"
                  aria-label={t("Outline actions")}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selected.depth === 0}
                    onClick={() => indent(selected.id)}
                  >
                    <IndentIncreaseIcon /> {t("Indent")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selected.depth <= 1}
                    onClick={() => outdent(selected.id)}
                  >
                    <IndentDecreaseIcon /> {t("Outdent")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={selected.depth === 0}
                    onClick={() => removeNode(selected.id)}
                  >
                    <Trash2Icon /> {t("Delete idea")}
                  </Button>
                </div>
                <div>
                  <label
                    htmlFor="mindmap-selected-note"
                    className="mb-1.5 block text-xs font-medium"
                  >
                    {t("Note for {label}", {
                      label: selected.label || t("this idea"),
                    })}
                  </label>
                  <Textarea
                    id="mindmap-selected-note"
                    value={selected.note ?? ""}
                    maxLength={MINDMAP_NOTE_MAX_LENGTH}
                    placeholder={t("Optional context, definition or reminder")}
                    onChange={(event) =>
                      changeContent(
                        setMindmapNote(content, selected.id, event.target.value)
                      )
                    }
                  />
                </div>
              </div>
            ) : null}
          </section>

          <section
            aria-label={t("Mind map preview")}
            className="h-[30rem] min-w-0 overflow-hidden rounded-xl border bg-card xl:h-auto"
          >
            <MindmapCanvas content={content} />
          </section>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "Keyboard: Enter adds a sibling, Alt + Right indents, Alt + Left outdents, and Control + Backspace deletes."
          )}
        </p>
      </div>
    </>
  )
}
