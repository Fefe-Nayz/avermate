"use client"

import { useQuery } from "@tanstack/react-query"
import { BotIcon, LoaderCircleIcon, XIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { Button } from "@/components/ui/button"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import { AssistantWorkspaceClient } from "./assistant-client"

const DEFAULT_WIDTH = 500
const MIN_WIDTH = 380
const MAX_WIDTH = 820

function clampWidth(width: number): number {
  const viewportMaximum =
    typeof window === "undefined" ? MAX_WIDTH : window.innerWidth * 0.68
  return Math.round(
    Math.min(MAX_WIDTH, viewportMaximum, Math.max(MIN_WIDTH, width))
  )
}

export function AssistantPanel({ userId }: { userId: string }) {
  const t = useExtracted()
  const pathname = usePathname()
  const storagePrefix = `avermate:assistant-panel:${userId}`
  const [hydrated, setHydrated] = useState(false)
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [lastSeenAt, setLastSeenAt] = useState(0)
  const runsQuery = useQuery({
    ...orpc.assistant.threads.list.queryOptions({
      input: {
        limit: 30,
        includeArchived: false,
        includeDeleted: false,
        starredOnly: false,
      },
    }),
    refetchInterval: 15_000,
  })
  const running = Boolean(
    runsQuery.data?.items.some((item) => item.activeRunId !== null)
  )
  const latestActivityAt = Math.max(
    0,
    ...(runsQuery.data?.items.map((item) =>
      new Date(item.lastMessageAt ?? item.thread.updatedAt).getTime()
    ) ?? [])
  )
  const unread = hydrated && !open && latestActivityAt > lastSeenAt

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(`${storagePrefix}:open`) === "true")
      const storedWidth = Number(localStorage.getItem(`${storagePrefix}:width`))
      if (Number.isFinite(storedWidth)) setWidth(clampWidth(storedWidth))
      const seenKey = `${storagePrefix}:last-seen-at`
      const storedSeen = Number(localStorage.getItem(seenKey))
      if (Number.isFinite(storedSeen) && storedSeen > 0) {
        setLastSeenAt(storedSeen)
      } else if (latestActivityAt > 0) {
        localStorage.setItem(seenKey, String(latestActivityAt))
        setLastSeenAt(latestActivityAt)
      }
    } finally {
      setHydrated(true)
    }
  }, [latestActivityAt, storagePrefix])

  useEffect(() => {
    if (!hydrated || !open || latestActivityAt <= lastSeenAt) return
    localStorage.setItem(
      `${storagePrefix}:last-seen-at`,
      String(latestActivityAt)
    )
  }, [hydrated, lastSeenAt, latestActivityAt, open, storagePrefix])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(`${storagePrefix}:open`, String(open))
  }, [hydrated, open, storagePrefix])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(`${storagePrefix}:width`, String(width))
  }, [hydrated, storagePrefix, width])

  const setPanelOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!hydrated || latestActivityAt <= lastSeenAt) return
    localStorage.setItem(
      `${storagePrefix}:last-seen-at`,
      String(latestActivityAt)
    )
    setLastSeenAt(latestActivityAt)
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const move = (pointer: PointerEvent) =>
      setWidth(clampWidth(window.innerWidth - pointer.clientX))
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
      document.body.style.removeProperty("cursor")
      document.body.style.removeProperty("user-select")
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop, { once: true })
  }

  if (pathname === "/assistant" || pathname.startsWith("/assistant/")) {
    return null
  }

  return (
    <>
      {open ? (
        <aside
          aria-label={t("Avermate assistant")}
          className="fixed inset-0 z-50 flex min-h-0 bg-background md:static md:inset-auto md:z-auto md:h-full md:shrink-0 md:border-l"
          style={{ width: `min(100vw, ${width}px)` }}
        >
          <button
            type="button"
            aria-label={t("Resize assistant panel")}
            className="absolute inset-y-0 left-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none md:block"
            onPointerDown={beginResize}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return
              event.preventDefault()
              setWidth((current) =>
                clampWidth(current + (event.key === "ArrowLeft" ? 20 : -20))
              )
            }}
          >
            <span className="mx-auto block h-full w-px bg-border transition-colors hover:bg-primary" />
          </button>
          <AssistantWorkspaceClient
            className="h-full min-h-0 w-full"
            compactRail
            onClose={() => setPanelOpen(false)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2 z-30 md:hidden"
            onClick={() => setPanelOpen(false)}
          >
            <XIcon />
            <span className="sr-only">{t("Close assistant")}</span>
          </Button>
        </aside>
      ) : (
        <Button
          type="button"
          size="lg"
          className={cn(
            "fixed right-[max(1rem,var(--spacing-safe-right))] bottom-[calc(var(--spacing-tabbar)+var(--spacing-safe-bottom)+1rem)] z-40 rounded-full shadow-xl md:bottom-6",
            running && "ring-2 ring-primary/30"
          )}
          aria-label={
            running
              ? t("Open assistant, response running")
              : unread
                ? t("Open assistant, unread response")
                : t("Open assistant")
          }
          onClick={() => setPanelOpen(true)}
        >
          {running ? (
            <LoaderCircleIcon
              className="animate-spin motion-reduce:animate-none"
              data-icon="inline-start"
            />
          ) : (
            <BotIcon data-icon="inline-start" />
          )}
          {t("Assistant")}
          {unread ? (
            <span
              className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-destructive"
              aria-hidden="true"
              data-testid="assistant-unread-indicator"
            />
          ) : null}
        </Button>
      )}
    </>
  )
}
