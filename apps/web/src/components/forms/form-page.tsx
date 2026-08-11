"use client"

import { useRouter } from "next/navigation"
import type { FormEvent, ReactNode } from "react"
import { XIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PageMeta } from "@/components/shell/page-chrome"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * The shell every form screen uses.
 *
 * Forms are screens here, not dialogs. A dialog on a phone fights the keyboard,
 * traps scrolling, loses its content to an accidental swipe, and cannot be
 * linked to or navigated back out of. A screen does none of that — and on a
 * desktop the same component simply centres itself in the content area.
 *
 * The submit button is pinned to the bottom on narrow screens so it stays
 * reachable above the keyboard however long the form gets.
 */
export function FormPage({
  title,
  description,
  backHref,
  onSubmit,
  submitLabel,
  submitting = false,
  disabled = false,
  destructive,
  children,
  footerNote,
}: {
  title: string
  description?: string
  backHref?: string
  onSubmit: () => void
  submitLabel: string
  submitting?: boolean
  disabled?: boolean
  /** An extra destructive action, e.g. "Delete". */
  destructive?: { label: string; onClick: () => void }
  children: ReactNode
  footerNote?: ReactNode
}) {
  const t = useExtracted()
  const router = useRouter()

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (submitting || disabled) return
    haptic("light")
    onSubmit()
  }

  return (
    <>
      <PageMeta title={title} subtitle={description} backHref={backHref} />

      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl">
        <div className="hidden items-start justify-between gap-4 pb-4 md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Close")}
            onClick={() => router.back()}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-5 pb-28 md:pb-0">{children}</div>

        {footerNote ? (
          <p className="pt-4 pb-24 text-xs text-muted-foreground md:pb-0">
            {footerNote}
          </p>
        ) : null}

        <div
          className={cn(
            "pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/90 px-4 pt-3 backdrop-blur-xl",
            "md:static md:mt-6 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:backdrop-blur-none"
          )}
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2 pb-3 md:pb-0">
            {destructive ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  haptic("warning")
                  destructive.onClick()
                }}
              >
                {destructive.label}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="ml-auto hidden md:inline-flex"
              onClick={() => router.back()}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitting || disabled}
              className={cn("flex-1 md:flex-none", destructive && "md:ml-0")}
              size="lg"
            >
              {submitting ? <Spinner className="size-4" /> : null}
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </>
  )
}
