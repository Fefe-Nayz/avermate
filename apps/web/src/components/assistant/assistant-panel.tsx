"use client"

import { useQuery } from "@tanstack/react-query"
import { BotIcon, LoaderCircleIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { Button } from "@/components/ui/button"
import { orpc } from "@/lib/orpc"
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

type AssistantPanelValue = {
  open: boolean
  setOpen: (open: boolean) => void
  width: number
  setWidth: (update: (current: number) => number) => void
  running: boolean
  unread: boolean
  available: boolean
}

const AssistantPanelContext = createContext<AssistantPanelValue | null>(null)

/**
 * The panel's state lives above both the panel and the header.
 *
 * It used to be private to the panel, which is why the only way in was a
 * floating pill parked over the page. Lifting it means the header can own the
 * trigger like every other utility, and the pill can go.
 */
export function AssistantPanelProvider({
  userId,
  children,
}: {
  userId: string
  children: ReactNode
}) {
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
  const available = !(
    pathname === "/assistant" || pathname.startsWith("/assistant/")
  )

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

  return (
    <AssistantPanelContext.Provider
      value={{
        open,
        setOpen: setPanelOpen,
        width,
        setWidth: (update) =>
          setWidth((current) => clampWidth(update(current))),
        running,
        unread,
        available,
      }}
    >
      {children}
    </AssistantPanelContext.Provider>
  )
}

function useAssistantPanel() {
  return useContext(AssistantPanelContext)
}

/** The way into the assistant, sitting with the other header utilities. */
export function AssistantPanelTrigger() {
  const t = useExtracted()
  const panel = useAssistantPanel()
  if (!panel?.available) return null

  return (
    <Button
      type="button"
      variant={panel.open ? "secondary" : "ghost"}
      size="icon-sm"
      className="relative"
      aria-pressed={panel.open}
      aria-label={
        panel.open
          ? t("Close assistant")
          : panel.running
            ? t("Open assistant, response running")
            : panel.unread
              ? t("Open assistant, unread response")
              : t("Open assistant")
      }
      onClick={() => panel.setOpen(!panel.open)}
    >
      {panel.running ? (
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
      ) : (
        <BotIcon className="size-4" />
      )}
      {panel.unread ? (
        <span
          className="absolute top-0.5 right-0.5 size-2 rounded-full border-2 border-background bg-destructive"
          aria-hidden="true"
          data-testid="assistant-unread-indicator"
        />
      ) : null}
    </Button>
  )
}

export function AssistantPanel() {
  const t = useExtracted()
  const panel = useAssistantPanel()
  if (!panel?.available || !panel.open) return null

  const { width, setWidth, setOpen } = panel

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const move = (pointer: PointerEvent) =>
      setWidth(() => window.innerWidth - pointer.clientX)
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

  return (
    <aside
      aria-label={t("Avermate assistant")}
      /*
       * `relative`, not `static`: the resize handle is absolutely positioned
       * against this element, and `md:static` took away the positioning
       * context, so the handle resolved against some ancestor and never
       * landed on the panel edge at all.
       *
       * The inset treatment rides the same `peer-data-[variant=inset]` the
       * main pane uses — the panel is a sibling of the sidebar too — so it
       * reads as a second docked card rather than a slab bolted to the edge,
       * and it follows automatically if the sidebar variant ever changes.
       */
      className="fixed inset-0 z-50 flex min-h-0 overflow-hidden bg-background md:relative md:inset-auto md:z-auto md:h-full md:shrink-0 md:border-l md:peer-data-[variant=inset]:my-2 md:peer-data-[variant=inset]:mr-2 md:peer-data-[variant=inset]:h-auto md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:shadow-sm"
      style={{ width: `min(100vw, ${width}px)` }}
    >
      <button
        type="button"
        aria-label={t("Resize assistant panel")}
        /* Eight pixels was a hairline to aim at. Sixteen, centred on the
             edge, is a target a hand can actually find. */
        className="absolute inset-y-0 left-0 z-20 hidden w-4 -translate-x-1/2 cursor-col-resize touch-none md:block"
        onPointerDown={beginResize}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          setWidth(
            (current) => current + (event.key === "ArrowLeft" ? 20 : -20)
          )
        }}
      >
        <span className="mx-auto block h-full w-px bg-border transition-colors hover:bg-primary" />
      </button>
      {/*
        The conversation header owns Close and Full screen. A cluster pinned
        here sat on top of that header and duplicated its X.
      */}
      <AssistantWorkspaceClient
        className="h-full min-h-0 w-full"
        compactRail
        onClose={() => setOpen(false)}
        expandHref="/assistant"
      />
    </aside>
  )
}
