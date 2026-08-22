"use client"

import Image from "next/image"
import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { gradeAttachmentsInput } from "@/lib/route-query-inputs"
import { uploadBrowserFile } from "@/lib/file-upload"

const MAX_COPY_BYTES = 25 * 1024 * 1024
const COPY_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
])

export function GradeCopies({ gradeId }: { gradeId: string }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const input = gradeAttachmentsInput(gradeId)
  const attachments = useQuery(orpc.grades.attachments.queryOptions({ input }))
  const availability = useQuery(orpc.profile.uploadsEnabled.queryOptions())
  const fileInput = useRef<HTMLInputElement>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.grades.attachments.queryKey({ input }),
    })

  const attach = useMutation({
    ...orpc.grades.attachCopy.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Copy attached."))
      await refresh()
    },
  })
  const remove = useMutation({
    ...orpc.grades.removeCopy.mutationOptions(),
    onSuccess: async () => {
      haptic("warning")
      setRemovingId(null)
      toast.success(t("Copy removed."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const rows = attachments.data ?? []
  const uploadsEnabled = availability.data?.enabled ?? false

  return (
    <>
      <Card className="gap-3 py-4">
        <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <PaperclipIcon className="size-4 text-muted-foreground" />
              {t("Copies")}
            </CardTitle>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t("Keep the marked paper with the result that belongs to it.")}
            </p>
          </div>
          {uploadsEnabled ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploading || attach.isPending || rows.length >= 10}
                onClick={() => fileInput.current?.click()}
              >
                <PlusIcon />
                {t("Add a copy")}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,.heic"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (!file) return
                  if (file.size > MAX_COPY_BYTES) {
                    toast.error(t("The copy must be 25 MB or smaller."))
                    return
                  }
                  if (!COPY_MIME_TYPES.has(file.type)) {
                    toast.error(
                      t("Choose a PDF, PNG, JPEG, WebP or HEIC file.")
                    )
                    return
                  }
                  try {
                    setUploading(true)
                    const uploaded = await uploadBrowserFile("gradeCopy", file)
                    await attach.mutateAsync({
                      gradeId,
                      fileId: uploaded.fileId,
                      fileName: file.name,
                      label: file.name,
                    })
                  } catch (error) {
                    haptic("error")
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : t("The upload failed.")
                    )
                  } finally {
                    setUploading(false)
                  }
                }}
              />
            </>
          ) : null}
        </CardHeader>
        <CardContent className="px-4">
          {attachments.isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t("Loading copies…")}
            </p>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-5 text-center">
              <p className="text-sm font-medium">{t("No copy attached")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {uploadsEnabled
                  ? t("Add the returned PDF or a clear photo of the paper.")
                  : t("File uploads are not configured on this server.")}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((attachment) => {
                const image = attachment.file.mimeType.startsWith("image/")
                return (
                  <li
                    key={attachment.id}
                    className="flex min-h-14 items-center gap-3 py-2.5"
                  >
                    <a
                      href={attachment.file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      aria-label={t("Open {name}", {
                        name: attachment.label ?? t("attached copy"),
                      })}
                    >
                      <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                        {image && attachment.file.mimeType !== "image/heic" ? (
                          <Image
                            src={attachment.file.url}
                            alt=""
                            fill
                            unoptimized
                            sizes="40px"
                            className="object-cover"
                          />
                        ) : attachment.file.mimeType === "application/pdf" ? (
                          <FileTextIcon className="size-5" />
                        ) : (
                          <ImageIcon className="size-5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium group-hover:underline">
                          {attachment.label ?? t("Attached copy")}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatBytes(attachment.file.byteSize)}
                        </span>
                      </span>
                      <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={t("Remove {name}", {
                        name: attachment.label ?? t("attached copy"),
                      })}
                      disabled={remove.isPending}
                      onClick={() => setRemovingId(attachment.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {rows.length >= 10 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("This result already has the maximum of ten copies.")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={removingId !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemovingId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove this copy?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "The uploaded file will be deleted. The grade itself will stay unchanged."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || removingId === null}
              onClick={() => {
                if (removingId) remove.mutate({ attachmentId: removingId })
              }}
            >
              {t("Remove copy")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
