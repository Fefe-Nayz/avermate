"use client"

import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FileTextIcon,
  LinkIcon,
  NotebookPenIcon,
  UploadCloudIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { uploadBrowserFile } from "@/lib/file-upload"
import { orpc, rpc } from "@/lib/orpc"

type SourceMode = "upload" | "link" | "note"

function extension(fileName: string) {
  const dot = fileName.lastIndexOf(".")
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase()
}

function fileIsMedia(file: File) {
  return (
    /^(audio|video)\//.test(file.type) ||
    /\.(?:mp3|m4a|wav|ogg|mp4|webm|mov)$/i.test(file.name)
  )
}

export function ProjectAddSourceDialog({
  open,
  onOpenChange,
  projectId,
  yearId,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  yearId: string | null
  onCompleted: () => Promise<void> | void
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<SourceMode>("upload")
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")
  const [content, setContent] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availability = useQuery({
    ...orpc.materials.documents.uploadsEnabled.queryOptions(),
    enabled: open,
  })

  function reset() {
    setTitle("")
    setUrl("")
    setContent("")
    setFile(null)
    setSavedDocumentId(null)
    setError(null)
  }

  async function createSource() {
    if (!yearId) {
      throw new Error(
        t("Choose an academic year before adding a source to this project.")
      )
    }

    if (mode === "upload") {
      if (!file) throw new Error(t("Choose a file to add."))
      if (!availability.data?.enabled) {
        throw new Error(t("File uploads are unavailable on this server."))
      }

      const media = fileIsMedia(file)
      const maxBytes = media
        ? availability.data.maxMediaBytes
        : availability.data.maxDocumentBytes
      if (file.size > maxBytes) {
        throw new Error(t("This file is larger than the server limit."))
      }

      const mime = file.type.trim().toLowerCase()
      const supported =
        availability.data.mimeTypes.includes(mime) ||
        ((!mime || mime === "application/octet-stream") &&
          availability.data.extensions.includes(extension(file.name)))
      if (!supported) {
        throw new Error(t("This file type is not supported."))
      }

      const uploaded = await uploadBrowserFile(
        media ? "courseMedia" : "courseMaterial",
        file
      )
      const result = await rpc.materials.documents.upload({
        yearId,
        folderId: null,
        title: title.trim() || undefined,
        fileId: uploaded.fileId,
        fileName: file.name,
      })
      return result.document.id
    }

    if (mode === "link") {
      if (!url.trim()) throw new Error(t("Enter the page URL to import."))
      const result = await rpc.materials.documents.createLink({
        yearId,
        folderId: null,
        title: title.trim() || undefined,
        url: url.trim(),
      })
      return result.document.id
    }

    if (!title.trim()) throw new Error(t("Give this note a title."))
    if (!content.trim()) throw new Error(t("Write something in this note."))
    const result = await rpc.materials.documents.createText({
      yearId,
      folderId: null,
      title: title.trim(),
      textContent: content.trim(),
    })
    return result.document.id
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    let documentId = savedDocumentId
    try {
      if (!documentId) {
        documentId = await createSource()
        setSavedDocumentId(documentId)
        await queryClient.invalidateQueries({
          queryKey: orpc.materials.documents.key(),
        })
      }
      await rpc.projects.addItem({
        projectId,
        kind: "material",
        referenceId: documentId,
        contextMode: "include",
        label: null,
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.projects.get.queryKey({ input: { projectId } }),
        }),
      ])
      await onCompleted()
      toast.success(t("Source added to the project."))
      reset()
      onOpenChange(false)
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : t("The source could not be added.")
      setError(message)
      if (documentId) {
        toast.warning(
          t(
            "The source was saved in Materials, but it could not be attached to this project."
          )
        )
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("Add a source")}</DialogTitle>
            <DialogDescription>
              {t(
                "Import it once into Materials and attach it to this project's searchable context."
              )}
            </DialogDescription>
          </DialogHeader>

          {!yearId ? (
            <Alert variant="destructive">
              <FileTextIcon />
              <AlertTitle>{t("No academic year selected")}</AlertTitle>
              <AlertDescription>
                {t(
                  "Link the project to a year, or select an active year, before importing a source."
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {savedDocumentId ? (
            <Alert>
              <FileTextIcon />
              <AlertTitle>{t("Source saved in Materials")}</AlertTitle>
              <AlertDescription>
                {t(
                  "The original is safe. Retry only its attachment to this project."
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Tabs
              value={mode}
              onValueChange={(value) => {
                setMode(value as SourceMode)
                setError(null)
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="upload">
                  <UploadCloudIcon data-icon="inline-start" />
                  {t("File")}
                </TabsTrigger>
                <TabsTrigger value="link">
                  <LinkIcon data-icon="inline-start" />
                  {t("Web page")}
                </TabsTrigger>
                <TabsTrigger value="note">
                  <NotebookPenIcon data-icon="inline-start" />
                  {t("Note")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="pt-4">
                <FieldGroup>
                  <Field data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor="project-source-file">
                      {t("Document, image, audio or video")}
                    </FieldLabel>
                    <Input
                      id="project-source-file"
                      type="file"
                      disabled={pending || availability.data?.enabled === false}
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null)
                        setError(null)
                      }}
                    />
                    <FieldDescription>
                      {availability.isLoading
                        ? t("Checking this server's upload limits…")
                        : availability.data?.enabled
                          ? t("The original stays available in Materials.")
                          : t(
                              "Uploads are not configured; links and notes still work."
                            )}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="project-source-file-title">
                      {t("Display name (optional)")}
                    </FieldLabel>
                    <Input
                      id="project-source-file-title"
                      value={title}
                      maxLength={160}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={file?.name ?? t("Keep the file name")}
                    />
                  </Field>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="link" className="pt-4">
                <FieldGroup>
                  <Field data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor="project-source-url">
                      {t("URL")}
                    </FieldLabel>
                    <Input
                      id="project-source-url"
                      type="url"
                      inputMode="url"
                      value={url}
                      onChange={(event) => {
                        setUrl(event.target.value)
                        setError(null)
                      }}
                      placeholder="https://…"
                    />
                    <FieldDescription>
                      {t(
                        "Avermate imports the readable content and keeps a citation back to the page."
                      )}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="project-source-link-title">
                      {t("Display name (optional)")}
                    </FieldLabel>
                    <Input
                      id="project-source-link-title"
                      value={title}
                      maxLength={160}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={t("Use the page title")}
                    />
                  </Field>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="note" className="pt-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="project-source-note-title">
                      {t("Title")}
                    </FieldLabel>
                    <Input
                      id="project-source-note-title"
                      value={title}
                      maxLength={160}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={t("Lecture notes")}
                    />
                  </Field>
                  <Field data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor="project-source-note-content">
                      {t("Content")}
                    </FieldLabel>
                    <Textarea
                      id="project-source-note-content"
                      value={content}
                      onChange={(event) => {
                        setContent(event.target.value)
                        setError(null)
                      }}
                      className="min-h-40"
                      placeholder={t(
                        "Paste or write the useful material here…"
                      )}
                    />
                  </Field>
                </FieldGroup>
              </TabsContent>
            </Tabs>
          )}

          {error ? <FieldError>{error}</FieldError> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={pending || !yearId}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UploadCloudIcon data-icon="inline-start" />
              )}
              {pending
                ? t("Adding…")
                : savedDocumentId
                  ? t("Retry attachment")
                  : t("Add to project")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
