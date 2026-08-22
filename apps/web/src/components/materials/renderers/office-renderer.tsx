"use client"

import { useState } from "react"
import { EyeIcon, PencilIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { OnlyOfficeEditor } from "../onlyoffice-editor"
import { isOfficeEditable, officeEditorKind } from "../onlyoffice-model"
import { useOfficeSession } from "../use-office-session"
import { materialFileOf } from "./row-file"
import {
  RendererBar,
  RendererError,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

/**
 * A Word, Excel or PowerPoint file, opened rather than downloaded.
 *
 * These are the formats that had nothing at all: a `.docx` was a row you could
 * rename and delete and otherwise only send to your downloads folder. The
 * Document Server renders and edits them, and everything that decides what the
 * reader may do — which URL the server fetches, whether editing is allowed,
 * where saved bytes go — is minted and signed on our side.
 *
 * A PDF deliberately does not come here: the browser's own viewer is already
 * present, needs no document server, and opens instantly.
 */
function OfficeReader({ row, mode, onModeChange }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const [failed, setFailed] = useState(false)
  const editing = mode === "edit"
  const session = useOfficeSession(row.id, editing ? "edit" : "view", true)

  const editable = isOfficeEditable(row.title, file?.mimeType)
  const ready = session.data?.available === true ? session.data.session : null

  if (session.isPending) return <RendererLoading />
  if (session.isError) {
    return (
      <RendererError
        message={t("The document editor is unavailable right now.")}
        onRetry={() => void session.refetch()}
      />
    )
  }
  if (!ready) {
    return (
      <RendererNotice>
        {t(
          "This file opens in a new browser tab. Editing in place needs a document server, which this installation does not have."
        )}
      </RendererNotice>
    )
  }

  return (
    <>
      {editable && onModeChange ? (
        <RendererBar>
          <span className="text-xs text-muted-foreground">
            {editing ? t("Editing") : t("Preview")}
          </span>
          <Button
            size="sm"
            variant={editing ? "outline" : "default"}
            className="ms-auto"
            onClick={() => onModeChange(editing ? "read" : "edit")}
          >
            {editing ? <EyeIcon /> : <PencilIcon />}
            {editing ? t("Read") : t("Edit")}
          </Button>
        </RendererBar>
      ) : null}
      {failed ? (
        <RendererError
          message={t("The document editor could not be loaded.")}
          onRetry={() => {
            setFailed(false)
            void session.refetch()
          }}
        />
      ) : (
        <OnlyOfficeEditor
          session={ready}
          documentId={row.id}
          onError={() => setFailed(true)}
        />
      )}
    </>
  )
}

export const officeRenderer: MaterialRenderer = {
  id: "office",
  // Above the CSV and text readers, below LaTeX: a .csv opens as a real
  // spreadsheet where a document server exists, and as a real table where it
  // does not.
  priority: 80,
  accepts: (row) => {
    const file = materialFileOf(row)
    if (!file) return false
    const kind = officeEditorKind(row.title, file.mimeType)
    return kind !== null && kind !== "pdf"
  },
  Reader: OfficeReader,
  Editor: OfficeReader,
}
