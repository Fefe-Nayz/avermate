"use client"

import { useCallback, useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowLeftIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { useKeyboardInset } from "@/hooks/use-keyboard-inset"

/**
 * A control that takes the whole screen instead of floating over the form.
 *
 * On a phone a popover is the wrong shape for a decision: it opens somewhere
 * the finger is not, the keyboard covers half of it, its scroll fights the
 * page behind it, and the back gesture — which is what a phone means by
 * "cancel" — closes the whole screen instead of the popover. A layer that
 * takes the screen has room for a real list or a real calendar, and it takes
 * a history entry so back cancels the choice and nothing else.
 *
 * Desktop never sees this. There a popover is exactly right, and each control
 * keeps its own.
 */
export function FullScreenLayer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  /** Pinned above the safe area, where a thumb reaches. */
  footer?: ReactNode
}) {
  const t = useExtracted()
  const keyboard = useKeyboardInset()
  const close = useRef(onClose)

  useEffect(() => {
    close.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    // The entry is what makes the back gesture mean "cancel this choice".
    window.history.pushState({ __layer: true }, "")
    const onPopState = () => close.current()
    window.addEventListener("popstate", onPopState)

    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      window.removeEventListener("popstate", onPopState)
      document.body.style.overflow = previous
    }
  }, [open])

  // Leaving through the button has to walk back through the same entry the
  // gesture would have used, or the stack grows an entry per open.
  const dismiss = useCallback(() => {
    if (window.history.state?.__layer) window.history.back()
    else close.current()
  }, [])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // The layer ends where the keyboard begins, so its own footer and the
      // bottom of its list stay reachable instead of sliding underneath.
      style={keyboard > 0 ? { bottom: `${keyboard}px` } : undefined}
      className="fixed inset-0 z-50 flex flex-col bg-background md:hidden"
    >
      <header className="flex shrink-0 items-start gap-2 border-b pt-[max(0.5rem,var(--spacing-safe-top))] pr-[max(0.5rem,var(--spacing-safe-right))] pb-2 pl-[max(0.5rem,var(--spacing-safe-left))]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("Back")}
          onClick={dismiss}
        >
          <ArrowLeftIcon className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 py-1.5">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {description ? (
            <p className="truncate text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-[var(--spacing-safe-right)] pl-[var(--spacing-safe-left)]">
        {children}
      </div>

      {footer ? (
        <div className="shrink-0 border-t bg-background pt-3 pr-[max(1rem,var(--spacing-safe-right))] pb-[max(0.75rem,var(--spacing-safe-bottom))] pl-[max(1rem,var(--spacing-safe-left))]">
          {footer}
        </div>
      ) : null}
    </div>,
    document.body
  )
}
