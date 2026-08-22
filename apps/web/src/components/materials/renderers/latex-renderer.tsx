"use client"

import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { StreamLanguage } from "@codemirror/language"
import { stex } from "@codemirror/legacy-modes/mode/stex"
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  HammerIcon,
  Redo2Icon,
  SaveIcon,
  Undo2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import type { StudyDocument } from "@/components/documents/document-types"
import { CodeEditor, type CodeEditorApi } from "./code-editor"
import { orderLatexProblems, parseLatexLog } from "./latex-log"
import { RendererBar, RendererLoading, RendererNotice } from "./renderer-chrome"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

/** One instance, built once: `stex` is a stream mode and does not change. */
const LATEX = StreamLanguage.define(stex)

function studyDocumentOf(
  row: MaterialRenderProps["row"]
): StudyDocument | null {
  return row.source.kind === "study" ? row.source.document : null
}

/**
 * A LaTeX source and the PDF it makes, side by side.
 *
 * The shape Overleaf settled on, and it is the right one: a `.tex` is unusual
 * among documents in that what you write and what you get look nothing alike,
 * so you need both on screen at once or you are compiling to find out what you
 * typed.
 *
 * Three things make it usable rather than merely present:
 *
 * - **The build is explicit.** A compile on every keystroke burns a container
 *   per character and shows you a broken document most of the time, because
 *   half-typed LaTeX does not compile. Ctrl+S builds, which is the gesture
 *   everybody already has.
 * - **The last good PDF stays.** A failed build leaves the previous render in
 *   the right pane rather than replacing it with an error — you need to see
 *   what you had while you fix what you broke.
 * - **Errors are clickable.** The log is parsed to the handful of lines that
 *   are about your document, each carrying its line number, and clicking one
 *   puts the caret there. A raw TeX log is not an error message.
 */
function LatexEditor({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const document = studyDocumentOf(row)
  const documentId = document?.id ?? ""

  /**
   * The buffer, as an override rather than a copy.
   *
   * Mirroring the saved body into state through an effect is the classic way
   * to get this wrong: every background refetch fires the effect, and the
   * effect either clobbers what somebody is typing or needs a flag to know not
   * to. Holding `null` until the reader actually types means the editor simply
   * *is* the saved document until it is not, and there is nothing to keep in
   * sync.
   */
  const [draft, setDraft] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const editor = useRef<CodeEditorApi | null>(null)

  const detail = useQuery({
    ...orpc.documents.get.queryOptions({ input: { documentId } }),
    enabled: documentId.length > 0,
  })
  const revision = detail.data?.document.revision ?? document?.revision ?? 1
  const savedBody =
    detail.data?.document.bodyMarkdown ?? document?.bodyMarkdown ?? ""
  const source = draft ?? savedBody
  const dirty = draft !== null && draft !== savedBody

  const build = useMutation({
    ...orpc.documents.build.mutationOptions(),
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The build could not be started."))
    },
  })
  const save = useMutation({
    ...orpc.documents.update.mutationOptions(),
    onSuccess: async () => {
      // Back to following the server, which is about to hold what was just
      // saved.
      setDraft(null)
      await queryClient.invalidateQueries({
        queryKey: orpc.documents.get.queryKey({ input: { documentId } }),
      })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("This document could not be saved."))
    },
  })

  /**
   * The build follows the saved revision, never the buffer.
   *
   * The server refuses a build whose revision does not match the document, and
   * it is right to: compiling text that was never saved produces a PDF of
   * something that does not exist anywhere.
   */
  const latest = useQuery({
    ...orpc.documents.builds.latest.queryOptions({ input: { documentId } }),
    enabled: documentId.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "queued" || status === "running" ? 1_500 : false
    },
  })
  const buildStatus = latest.data?.status ?? null
  const running = buildStatus === "queued" || buildStatus === "running"

  const log = useQuery({
    ...orpc.documents.builds.log.queryOptions({
      input: { buildId: latest.data?.id ?? "" },
    }),
    enabled: Boolean(latest.data?.id) && buildStatus === "failed",
  })
  const problems = useMemo(
    () => orderLatexProblems(parseLatexLog(log.data?.log ?? "")),
    [log.data?.log]
  )

  const saveAndBuild = async () => {
    if (!documentId) return
    let target = revision
    if (dirty) {
      const updated = await save.mutateAsync({
        documentId,
        revision,
        bodyMarkdown: source,
      })
      target = (updated as { revision?: number }).revision ?? revision + 1
    }
    build.mutate({ documentId, revision: target })
  }

  if (!document) return <RendererNotice>{t("Nothing to show.")}</RendererNotice>
  if (detail.isPending) return <RendererLoading />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RendererBar>
        <Button
          size="sm"
          disabled={running || save.isPending || build.isPending}
          onClick={() => void saveAndBuild()}
        >
          {running || save.isPending || build.isPending ? (
            <Spinner />
          ) : (
            <HammerIcon />
          )}
          {running ? t("Building…") : t("Build")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({ documentId, revision, bodyMarkdown: source })
          }
        >
          <SaveIcon /> {dirty ? t("Save") : t("Saved")}
        </Button>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("Undo")}
            onClick={() => editor.current?.undo()}
          >
            <Undo2Icon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("Redo")}
            onClick={() => editor.current?.redo()}
          >
            <Redo2Icon />
          </Button>
        </div>
        <span className="ms-auto text-xs text-muted-foreground">
          {buildStatus === "succeeded"
            ? t("Built")
            : buildStatus === "failed"
              ? t("Build failed")
              : running
                ? t("Building…")
                : t("Not built yet")}
        </span>
      </RendererBar>

      <div className="grid min-h-0 flex-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1">
        <div className="flex min-h-0 flex-col overflow-hidden border-b lg:border-e lg:border-b-0">
          <CodeEditor
            value={source}
            onChange={setDraft}
            language={LATEX}
            ariaLabel={t("LaTeX source")}
            apiRef={editor}
            onSubmit={() => void saveAndBuild()}
          />
          {buildStatus === "failed" ? (
            <div className="max-h-56 shrink-0 overflow-auto border-t bg-destructive/5">
              <div className="flex items-center gap-2 px-3 py-2">
                <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
                <span className="text-xs font-medium text-destructive">
                  {t("{count, plural, one {# problem} other {# problems}}", {
                    count: problems.length,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto h-6 text-xs"
                  onClick={() => setLogOpen((open) => !open)}
                >
                  <ChevronDownIcon
                    className={cn(
                      "transition-transform",
                      logOpen && "rotate-180"
                    )}
                  />
                  {t("Full log")}
                </Button>
              </div>
              {problems.length === 0 && !logOpen ? (
                <p className="px-3 pb-3 text-xs text-muted-foreground">
                  {t("The compiler failed without naming a line.")}
                </p>
              ) : null}
              <ul className="px-1 pb-2">
                {problems.map((problem, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      disabled={problem.line === null}
                      onClick={() =>
                        problem.line !== null &&
                        editor.current?.goToLine(problem.line)
                      }
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span
                        className={cn(
                          "numeric w-10 shrink-0 text-right",
                          problem.kind === "error"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        )}
                      >
                        {problem.line ?? "—"}
                      </span>
                      <span className="min-w-0 flex-1">{problem.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {logOpen ? (
                <pre className="border-t px-3 py-2 font-mono text-[0.65rem] whitespace-pre-wrap">
                  {log.data?.log || t("The compiler wrote nothing.")}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
          {latest.data?.pdfUrl ? (
            <iframe
              // The URL changes per build, and the frame has to reload for the
              // new one — keying it is what makes a rebuild visible.
              key={latest.data.pdfUrl}
              src={`${latest.data.pdfUrl}#view=FitH`}
              title={t("Built PDF")}
              className="min-h-0 flex-1 bg-background"
            />
          ) : running ? (
            <RendererLoading />
          ) : (
            <RendererNotice>
              {buildStatus === "failed"
                ? t("The last build failed. Fix the errors and build again.")
                : t("Build the document to see it here.")}
            </RendererNotice>
          )}
        </div>
      </div>
    </div>
  )
}

export const latexRenderer: MaterialRenderer = {
  id: "latex",
  // Above every text renderer: a .tex is a text file, and showing it as one
  // would be technically true and useless.
  priority: 100,
  accepts: (row) =>
    row.source.kind === "study" && row.source.document.kind === "latex",
  Reader: LatexEditor,
  Editor: LatexEditor,
}
