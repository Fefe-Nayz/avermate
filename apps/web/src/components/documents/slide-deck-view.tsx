"use client"

import { useExtracted } from "next-intl"
import { cn } from "@/lib/utils"
import { DocumentMarkdown } from "./document-markdown"
import { splitMarkdownSlides } from "./slide-deck-model"

export function SlideDeckView({
  markdown,
  compact = false,
  className,
}: {
  markdown: string
  compact?: boolean
  className?: string
}) {
  const t = useExtracted()
  const slides = splitMarkdownSlides(markdown)

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        !compact && "xl:grid-cols-2",
        className
      )}
      aria-label={t("Slide deck preview")}
    >
      {slides.map((slide, index) => (
        <article
          // Empty slides are meaningful, so their position is the stable key.
          key={index}
          aria-label={t("Slide {current} of {total}", {
            current: String(index + 1),
            total: String(slides.length),
          })}
          className={cn(
            "relative aspect-video min-w-0 overflow-auto rounded-xl border bg-card shadow-xs",
            compact ? "p-4 sm:p-5" : "p-6 sm:p-8"
          )}
        >
          <span className="absolute right-3 bottom-2 text-[0.65rem] text-muted-foreground">
            {index + 1} / {slides.length}
          </span>
          <DocumentMarkdown
            markdown={slide}
            className={compact ? "text-xs" : undefined}
            ariaLabel={t("Slide {number} content", {
              number: String(index + 1),
            })}
            empty={
              <p className="grid h-full place-items-center text-sm text-muted-foreground">
                {t("Empty slide")}
              </p>
            }
          />
        </article>
      ))}
    </div>
  )
}
