"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon, ArrowRightIcon, Minimize2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { DocumentMarkdown } from "./document-markdown"
import { splitMarkdownSlides } from "./slide-deck-model"
import type { StudyDocumentResult } from "./document-types"

export function SlideDeckPresenter({ documentId }: { documentId: string }) {
  const t = useExtracted()
  const router = useRouter()
  const surface = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const query = useQuery({
    ...orpc.documents.get.queryOptions({ input: { documentId } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const result = query.data as StudyDocumentResult | undefined
  const slides = splitMarkdownSlides(result?.document.bodyMarkdown ?? "")
  const lastIndex = Math.max(0, slides.length - 1)
  const displayedIndex = Math.min(index, lastIndex)

  useEffect(() => {
    surface.current?.focus()
  }, [query.isPending])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const root = surface.current
        if (!root) return
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) {
          event.preventDefault()
          root.focus()
        } else if (!root.contains(document.activeElement)) {
          event.preventDefault()
          first.focus()
        } else if (document.activeElement === root) {
          event.preventDefault()
          const target = event.shiftKey ? last : first
          target.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      } else if (event.key === "Escape") {
        event.preventDefault()
        router.push(`/materials/fiches/${documentId}`)
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault()
        setIndex((current) => Math.min(lastIndex, current + 1))
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault()
        setIndex((current) => Math.max(0, current - 1))
      } else if (event.key === "Home") {
        event.preventDefault()
        setIndex(0)
      } else if (event.key === "End") {
        event.preventDefault()
        setIndex(lastIndex)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [documentId, lastIndex, router])

  if (query.isPending) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-background">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (query.isError || !result) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-background p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>{t("The slide deck could not be loaded.")}</AlertTitle>
          <AlertDescription>
            {query.error?.message || t("This deck could not be loaded.")}
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (result.document.kind !== "slides") {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-background p-6">
        <Alert className="max-w-lg">
          <AlertTitle>{t("This document is not a slide deck.")}</AlertTitle>
          <AlertDescription>
            <Button
              className="mt-3"
              render={<Link href={`/materials/fiches/${documentId}`} />}
            >
              {t("Return to document")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div
      ref={surface}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("Presentation mode for {title}", {
        title: result.document.title,
      })}
      className="fixed inset-0 z-[100] flex flex-col bg-background outline-none"
    >
      <header className="flex min-h-14 items-center justify-between gap-3 border-b px-3 sm:px-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {result.document.title}
          </p>
          <p className="hidden text-xs text-muted-foreground sm:block">
            {t("Use the arrow keys to move. Press Escape to leave.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums" aria-live="polite">
            {t("{current} / {total}", {
              current: String(displayedIndex + 1),
              total: String(slides.length),
            })}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Leave presentation")}
            onClick={() => router.push(`/materials/fiches/${documentId}`)}
          >
            <Minimize2Icon />
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 place-items-center overflow-auto p-3 sm:p-8">
        <article
          aria-live="polite"
          aria-label={t("Slide {current} of {total}", {
            current: String(displayedIndex + 1),
            total: String(slides.length),
          })}
          className="aspect-video w-full max-w-6xl overflow-auto rounded-xl border bg-card p-[clamp(1.5rem,5vw,5rem)] shadow-xl"
        >
          <DocumentMarkdown
            markdown={slides[displayedIndex] ?? ""}
            className="slide-presenter-markdown"
            ariaLabel={t("Current slide content")}
            empty={
              <p className="grid h-full place-items-center text-muted-foreground">
                {t("Empty slide")}
              </p>
            }
          />
        </article>
      </main>

      <footer className="flex items-center justify-center gap-3 border-t p-3">
        <Button
          variant="outline"
          aria-label={t("Previous slide")}
          disabled={displayedIndex === 0}
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
        >
          <ArrowLeftIcon />
          <span className="hidden sm:inline">{t("Previous slide")}</span>
        </Button>
        <Button
          aria-label={t("Next slide")}
          disabled={displayedIndex === lastIndex}
          onClick={() =>
            setIndex((current) => Math.min(lastIndex, current + 1))
          }
        >
          <span className="hidden sm:inline">{t("Next slide")}</span>
          <ArrowRightIcon />
        </Button>
      </footer>
    </div>
  )
}
