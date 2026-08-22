"use client"

import dynamic from "next/dynamic"
import { useId, useState } from "react"
import { useExtracted } from "next-intl"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { OnlyOfficeSession } from "./onlyoffice-model"

/**
 * The Document Server's own editor, dropped into the pane.
 *
 * Loaded on demand, and that is the whole reason this file exists as a wrapper.
 * `DocumentEditor` injects a `<script>` from the Document Server on mount, so
 * importing it eagerly would put a vendor script tag on the critical path of a
 * screen where most people never open an `.xlsx` at all. `next/dynamic` with
 * `ssr: false` keeps it out of the server render too — the component reads
 * `window.DocsAPI`, which does not exist there.
 */
const DocumentEditor = dynamic(
  () =>
    import("@onlyoffice/document-editor-react").then(
      (module) => module.DocumentEditor
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner className="size-5" />
      </div>
    ),
  }
)

/**
 * One editor per document and per mode.
 *
 * The Document Server keys its instances by the DOM id, and switching from
 * reading to editing is a different instance with different permissions rather
 * than the same one re-configured — remounting is what makes the change take.
 */
export function OnlyOfficeEditor({
  session,
  documentId,
  className,
  onError,
  onDocumentReady,
}: {
  session: OnlyOfficeSession
  /** Only ever a fallback key, for a config that somehow carries no document. */
  documentId: string
  className?: string
  /** The Document Server could not be reached, or refused the config. */
  onError?: (message: string) => void
  onDocumentReady?: () => void
}) {
  const t = useExtracted()
  const reactId = useId()
  const [failed, setFailed] = useState<string | null>(null)

  // `useId` produces colons, which are legal in an id attribute and illegal in
  // the CSS selector the Document Server builds from it.
  const id = `onlyoffice${reactId.replace(/[^a-zA-Z0-9]/g, "")}`

  if (failed) {
    return (
      <div
        role="alert"
        className={cn(
          "grid min-h-56 place-items-center p-6 text-center text-sm text-destructive",
          className
        )}
      >
        {failed}
      </div>
    )
  }

  return (
    <div className={cn("min-h-0 flex-1 overflow-hidden", className)}>
      <DocumentEditor
        // The mode is part of the key: reading and editing are two instances.
        key={`${session.config.document?.key ?? documentId}:${
          session.config.editorConfig?.mode ?? "view"
        }`}
        id={id}
        documentServerUrl={session.documentServerUrl}
        config={session.config}
        height="100%"
        width="100%"
        onLoadComponentError={(code, description) => {
          const message =
            description ||
            t("The document editor could not be loaded. ({code})", {
              code: String(code),
            })
          setFailed(message)
          onError?.(message)
        }}
        events_onDocumentReady={() => onDocumentReady?.()}
      />
    </div>
  )
}
