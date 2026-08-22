"use client"

import { useId, useState } from "react"
import { ScanTextIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { SelectField, TextField } from "@/components/forms/controls"
import {
  MaterialFolderPicker,
  ROOT_FOLDER_VALUE,
} from "./materials-folder-picker"
import { canMoveMaterialFolder } from "./materials-model"
import type {
  MaterialDeleteTarget,
  MaterialDocumentDialogState,
  MaterialFolderDialogState,
  MaterialFolderView,
  MaterialSubjectView,
} from "./materials-types"

// The picker owns the sentinel now, so the dialog and the cascader cannot
// disagree about what "no folder" is called.
const ROOT_FOLDER = ROOT_FOLDER_VALUE
const NO_SUBJECT = "__materials_no_subject__"

export function MaterialFolderDialog({
  state,
  folders,
  subjects,
  pending,
  onClose,
  onCreate,
  onRename,
  onMove,
}: {
  state: MaterialFolderDialogState
  folders: readonly MaterialFolderView[]
  subjects: readonly MaterialSubjectView[]
  pending: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    parentId: string | null
    subjectId: string | null
  }) => void
  onRename: (input: { folderId: string; name: string }) => void
  onMove: (input: {
    folderId: string
    parentId: string | null
    subjectId: string | null
  }) => void
}) {
  const t = useExtracted()
  const [name, setName] = useState(
    state.mode === "rename" ? state.folder.name : ""
  )
  const initialParentId =
    state.mode === "create" ? state.parentId : state.folder.parentId
  const [parentId, setParentId] = useState(initialParentId ?? ROOT_FOLDER)
  const [subjectId, setSubjectId] = useState(
    state.mode === "create"
      ? NO_SUBJECT
      : (state.folder.subjectId ?? NO_SUBJECT)
  )

  const subjectOptions = [
    { value: NO_SUBJECT, label: t("No subject") },
    ...[...subjects]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((subject) => ({ value: subject.id, label: subject.name })),
  ]

  const submit = () => {
    if (state.mode === "rename") {
      onRename({ folderId: state.folder.id, name: name.trim() })
      return
    }
    if (state.mode === "move") {
      onMove({
        folderId: state.folder.id,
        parentId: parentId === ROOT_FOLDER ? null : parentId,
        subjectId: subjectId === NO_SUBJECT ? null : subjectId,
      })
      return
    }
    onCreate({
      name: name.trim(),
      parentId: parentId === ROOT_FOLDER ? null : parentId,
      subjectId: subjectId === NO_SUBJECT ? null : subjectId,
    })
  }

  const title =
    state.mode === "create"
      ? t("New folder")
      : state.mode === "rename"
        ? t("Rename folder")
        : t("Move folder")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state.mode === "move"
              ? t("Choose where this folder belongs.")
              : t("Folders keep course materials organized for this year.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {state.mode !== "move" ? (
            <TextField
              label={t("Name")}
              value={name}
              maxLength={160}
              autoFocus
              required
              onChange={(event) => setName(event.target.value)}
            />
          ) : null}
          {state.mode !== "rename" ? (
            <>
              <MaterialFolderPicker
                label={t("Parent folder")}
                rootLabel={t("Top level")}
                folders={folders}
                value={parentId}
                onValueChange={setParentId}
                isDisabled={(folderId) =>
                  state.mode === "move" &&
                  !canMoveMaterialFolder(folders, state.folder.id, folderId)
                }
              />
              <SelectField
                label={t("Subject")}
                value={subjectId}
                onValueChange={setSubjectId}
                options={subjectOptions}
                description={t(
                  "Optional. Use it to keep subject material together."
                )}
              />
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={pending || (state.mode !== "move" && !name.trim())}
            onClick={submit}
          >
            {state.mode === "create" ? t("Create folder") : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MaterialDocumentDialog({
  state,
  folders,
  pending,
  onClose,
  onCreateText,
  onCreateLink,
  onRename,
  onMove,
}: {
  state: MaterialDocumentDialogState
  folders: readonly MaterialFolderView[]
  pending: boolean
  onClose: () => void
  onCreateText: (input: {
    folderId: string | null
    title: string
    textContent: string
  }) => void
  onCreateLink: (input: {
    folderId: string | null
    title?: string
    url: string
  }) => void
  onRename: (input: { documentId: string; title: string }) => void
  onMove: (input: { documentId: string; folderId: string | null }) => void
}) {
  const t = useExtracted()
  const contentId = useId()
  const initialTitle = state.mode === "rename" ? state.row.document.title : ""
  const initialFolderId =
    state.mode === "text" || state.mode === "link"
      ? state.folderId
      : state.row.document.folderId
  const [title, setTitle] = useState(initialTitle)
  const [folderId, setFolderId] = useState(initialFolderId ?? ROOT_FOLDER)
  const [textContent, setTextContent] = useState("")
  const [url, setUrl] = useState("")
  const textBytes = new TextEncoder().encode(textContent).byteLength
  const tooLarge = textBytes > 256 * 1024

  const submit = () => {
    const destination = folderId === ROOT_FOLDER ? null : folderId
    if (state.mode === "text") {
      onCreateText({
        folderId: destination,
        title: title.trim(),
        textContent,
      })
    } else if (state.mode === "link") {
      onCreateLink({
        folderId: destination,
        title: title.trim() || undefined,
        url: url.trim(),
      })
    } else if (state.mode === "rename") {
      onRename({ documentId: state.row.document.id, title: title.trim() })
    } else {
      onMove({ documentId: state.row.document.id, folderId: destination })
    }
  }

  const dialogTitle =
    state.mode === "text"
      ? t("Paste a note")
      : state.mode === "link"
        ? t("Add a link")
        : state.mode === "rename"
          ? t("Rename material")
          : t("Move material")
  const valid =
    state.mode === "move" ||
    (state.mode === "link" ? Boolean(url.trim()) : Boolean(title.trim()))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={state.mode === "text" ? "sm:max-w-lg" : undefined}
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {state.mode === "text"
              ? t("Store text alongside files and links in this course space.")
              : state.mode === "link"
                ? t(
                    "Avermate will import the readable page as markdown after the link is added."
                  )
                : t("Changes are kept inside the selected school year.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {state.mode !== "move" ? (
            <TextField
              label={state.mode === "link" ? t("Title (optional)") : t("Title")}
              value={title}
              maxLength={160}
              autoFocus
              required={state.mode !== "link"}
              onChange={(event) => setTitle(event.target.value)}
            />
          ) : null}
          {state.mode === "link" ? (
            <TextField
              label={t("Web address")}
              type="url"
              value={url}
              required
              placeholder="https://…"
              onChange={(event) => setUrl(event.target.value)}
            />
          ) : null}
          {state.mode === "text" ? (
            <Field data-invalid={tooLarge || undefined}>
              <FieldLabel htmlFor={contentId}>{t("Note")}</FieldLabel>
              <Textarea
                id={contentId}
                value={textContent}
                rows={10}
                aria-invalid={tooLarge || undefined}
                onChange={(event) => setTextContent(event.target.value)}
              />
              <FieldDescription
                className={tooLarge ? "text-destructive" : undefined}
              >
                {t("{used} of 256 KiB", {
                  used: `${Math.ceil(textBytes / 1024)} KiB`,
                })}
              </FieldDescription>
            </Field>
          ) : null}
          {state.mode !== "rename" ? (
            <MaterialFolderPicker
              label={t("Folder")}
              folders={folders}
              value={folderId}
              onValueChange={setFolderId}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button disabled={pending || !valid || tooLarge} onClick={submit}>
            {state.mode === "text"
              ? t("Save note")
              : state.mode === "link"
                ? t("Add link")
                : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MaterialDeleteDialog({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: MaterialDeleteTarget
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useExtracted()
  const name =
    target.kind === "folder" ? target.folder.name : target.row.document.title

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {target.kind === "folder"
              ? t("Delete folder {name}?", { name })
              : t("Delete material {name}?", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target.kind === "folder"
              ? t(
                  "Every folder and material inside it will be permanently deleted."
                )
              : t("This material will be permanently deleted.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {t("Delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function MaterialFolderTranscribeDialog({
  folderName,
  candidates,
  skipped,
  pending,
  onClose,
  onConfirm,
}: {
  folderName: string
  candidates: number
  skipped: number
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useExtracted()
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("Transcribe folder {name}?", { name: folderName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "{count} files can be transcribed. {skipped} correction files will be skipped.",
              {
                count: String(candidates - skipped),
                skipped: String(skipped),
              }
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {candidates - skipped > 0 ? t("Cancel") : t("Close")}
          </AlertDialogCancel>
          {candidates - skipped > 0 ? (
            <AlertDialogAction disabled={pending} onClick={onConfirm}>
              {pending ? <Spinner className="size-4" /> : null}
              {t("Transcribe {count} files", {
                count: String(candidates - skipped),
              })}
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function MaterialAllTranscribeDialog({
  candidates,
  skipped,
  pending,
  onClose,
  onConfirm,
}: {
  candidates: number
  skipped: number
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useExtracted()
  const selected = candidates - skipped
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Transcribe all materials?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "{count} pending files will be transcribed. {skipped} correction files will be skipped.",
              {
                count: String(selected),
                skipped: String(skipped),
              }
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {selected > 0 ? t("Cancel") : t("Close")}
          </AlertDialogCancel>
          {selected > 0 ? (
            <AlertDialogAction disabled={pending} onClick={onConfirm}>
              {pending ? <Spinner className="size-4" /> : <ScanTextIcon />}
              {t("Transcribe all")}
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function MaterialTextPreview({
  title,
  content,
  onClose,
}: {
  title: string
  content: string
  onClose: () => void
}) {
  const t = useExtracted()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("Pasted note")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/30 p-4 whitespace-pre-wrap">
          {content || t("This note is empty.")}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
