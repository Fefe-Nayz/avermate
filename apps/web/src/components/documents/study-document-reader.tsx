"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  PencilIcon,
  PresentationIcon,
  PrinterIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { cn } from "@/lib/utils"
import { DocumentMarkdown } from "./document-markdown"
import { DocumentPptxExport } from "./document-pptx-export"
import { DocumentArtifactsStrip } from "./document-artifacts-strip"
import { MindmapDocumentView } from "./mindmap-document-view"
import { QuizDocumentView } from "./quiz-document-view"
import { SlideDeckView } from "./slide-deck-view"
import {
  isMindmapContent,
  isQuizPromptContent,
  type StudyDocumentKind,
  type StudyDocumentResult,
} from "./document-types"

export function StudyDocumentReader({ documentId }: { documentId: string }) {
  const t = useExtracted()
  const format = useFormatter()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const query = useQuery({
    ...orpc.documents.get.queryOptions({ input: { documentId } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const remove = useMutation({
    ...orpc.documents.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDeleteOpen(false)
      queryClient.removeQueries({
        queryKey: orpc.documents.get.queryKey({ input: { documentId } }),
        exact: true,
      })
      await queryClient.invalidateQueries({
        queryKey: orpc.documents.list.key(),
        refetchType: "all",
      })
      toast.success(t("Document deleted."))
      router.push("/materials")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The document could not be deleted."))
    },
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

  const result = query.data as StudyDocumentResult
  const document = result.document
  const kindLabel = documentKindLabel(document.kind, t)

  return (
    <>
      <PageMeta title={document.title} subtitle={kindLabel} />
      <PageActions>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Print or export as PDF")}
            onClick={() => window.print()}
          >
            <PrinterIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Edit document")}
            render={<Link href={`/materials/fiches/${documentId}/edit`} />}
          >
            <PencilIcon />
          </Button>
          {document.kind === "slides" ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Present slide deck")}
              render={<Link href={`/materials/fiches/${documentId}/present`} />}
            >
              <PresentationIcon />
            </Button>
          ) : null}
        </div>
      </PageActions>

      <div
        className={cn(
          "mx-auto w-full",
          document.kind === "fiche" || document.kind === "note"
            ? "max-w-4xl"
            : "max-w-[96rem]"
        )}
      >
        <DocumentArtifactsStrip
          documentId={document.id}
          revision={document.revision}
          allowAnki={document.kind !== "mindmap" && document.kind !== "latex"}
          allowPodcast={document.kind === "fiche" || document.kind === "note"}
        />
        <div className="document-screen-only mb-4 flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/materials" />}
          >
            {t("Back to materials")}
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {document.kind === "slides" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link href={`/materials/fiches/${documentId}/present`} />
                  }
                >
                  <PresentationIcon /> {t("Present")}
                </Button>
                <DocumentPptxExport
                  documentId={documentId}
                  revision={document.revision}
                />
              </>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <PrinterIcon /> {t("Export as PDF")}
            </Button>
            <Button
              size="sm"
              render={<Link href={`/materials/fiches/${documentId}/edit`} />}
            >
              <PencilIcon /> {t("Edit")}
            </Button>
          </div>
        </div>

        <main className="study-document-print-root rounded-xl border bg-card px-5 py-7 shadow-xs sm:px-10 sm:py-10 print:border-0 print:shadow-none">
          <header className="mb-8 border-b pb-5">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {kindLabel}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {document.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("Updated {date}", {
                date: format.dateTime(document.updatedAt, {
                  dateStyle: "long",
                  timeStyle: "short",
                }),
              })}
            </p>
          </header>
          {document.kind === "mindmap" ? (
            isMindmapContent(document.metaJson) ? (
              <MindmapDocumentView content={document.metaJson} />
            ) : (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>
                  {t("This mind map cannot be displayed.")}
                </AlertTitle>
                <AlertDescription>
                  {t("Its structured content is missing or invalid.")}
                </AlertDescription>
              </Alert>
            )
          ) : document.kind === "slides" ? (
            <SlideDeckView
              markdown={result.renderedMarkdown ?? document.bodyMarkdown}
            />
          ) : document.kind === "quiz" ? (
            isQuizPromptContent(document.metaJson) ? (
              <QuizDocumentView
                documentId={document.id}
                content={document.metaJson}
              />
            ) : (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>{t("This quiz cannot be displayed.")}</AlertTitle>
                <AlertDescription>
                  {t("Its questions are missing or invalid.")}
                </AlertDescription>
              </Alert>
            )
          ) : (
            <DocumentMarkdown
              markdown={result.renderedMarkdown ?? document.bodyMarkdown}
              ariaLabel={t("Document content")}
              empty={
                <p className="py-16 text-center text-sm text-muted-foreground">
                  {t("This document is empty.")}
                </p>
              }
            />
          )}
        </main>

        <div className="document-screen-only mt-4 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon /> {t("Delete document")}
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Delete document {title}?", { title: document.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "This document and its source links will be permanently deleted."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ documentId })}
            >
              {remove.isPending ? <Spinner /> : null}
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function documentKindLabel(
  kind: StudyDocumentKind,
  t: ReturnType<typeof useExtracted>
): string {
  if (kind === "fiche") return t("Revision sheet")
  if (kind === "note") return t("Study note")
  if (kind === "mindmap") return t("Mind map")
  if (kind === "slides") return t("Slide deck")
  if (kind === "latex") return t("LaTeX document")
  return t("Quiz")
}
