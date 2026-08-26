"use client"

import type { ReactNode } from "react"
import { RefreshCwIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

/**
 * The three states every renderer has, written once.
 *
 * Loading, failed and too-large are the same three states for a PDF, a
 * spreadsheet and a LaTeX source, and a renderer that reinvents them is a
 * renderer that words them differently from the one beside it. Each of these
 * fills the pane rather than sitting at the top of it, because the pane is the
 * whole right-hand side and a one-line message floating in it reads as a
 * screen that failed to draw.
 */

export function RendererLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <Spinner className="size-5" />
    </div>
  )
}

/**
 * The sentence first, the server's words second.
 *
 * Every caller wrote `error.message || t("…")`, so an English transport error
 * — "Authentication required" — won over the translated sentence and the
 * fallback only ever showed when the server said nothing at all. A reader in
 * French got an English string about a layer they cannot see. The technical
 * text is not thrown away; it just stops being the headline.
 */
export function RendererError({
  message,
  detail,
  onRetry,
}: {
  message: string
  detail?: string
  onRetry?: () => void
}) {
  const t = useExtracted()
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
        {detail && detail !== message ? (
          <p className="text-xs break-words text-muted-foreground">{detail}</p>
        ) : null}
        {onRetry ? (
          <Button size="sm" onClick={onRetry}>
            <RefreshCwIcon /> {t("Retry")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function RendererNotice({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-sm text-balance text-muted-foreground">{children}</p>
        {action}
      </div>
    </div>
  )
}

/**
 * A strip above a renderer, for the controls that belong to the format.
 *
 * Build and Read/Edit belong here; Rename and Delete do not — those belong to
 * the row and are already in the pane's own header. Keeping the two apart is
 * what stops the pane from growing a second, competing toolbar.
 */
export function RendererBar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2",
        className
      )}
    >
      {children}
    </div>
  )
}
