"use client"

import {
  MenuIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import Link from "next/link"
import { useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useContainerWidth } from "@/hooks/use-container-width"
import { cn } from "@/lib/utils"
import { ConversationPane } from "./assistant-conversation-pane"
import { AssistantThreadRail } from "./assistant-thread-rail"
import type {
  AssistantWorkspaceActions,
  AssistantWorkspaceState,
} from "./assistant-types"

/** The pane's shape while its thread is still loading. */
function ConversationSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 items-center gap-3 border-b px-4">
        <Skeleton className="size-8" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
        <Skeleton className="ml-auto h-20 w-2/3 rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    </div>
  )
}

/** Nothing open yet: the one screen where "new chat" is the whole point. */
function NoConversation({
  onToggleRail,
  onClose,
  onCreate,
}: {
  onToggleRail: () => void
  onClose?: () => void
  onCreate: () => void
}) {
  const t = useExtracted()
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 items-center border-b px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleRail}
        >
          <MenuIcon />
          <span className="sr-only">{t("Show conversations")}</span>
        </Button>
        {onClose ? (
          <Button
            className="ml-auto"
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
          >
            <XIcon />
            <span className="sr-only">{t("Close assistant")}</span>
          </Button>
        ) : null}
      </header>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquarePlusIcon />
          </EmptyMedia>
          <EmptyTitle>{t("Your study assistant")}</EmptyTitle>
          <EmptyDescription>
            {t(
              "Open a previous conversation or start a new one. Your notes and files stay where the selected placement says they do."
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <MessageSquarePlusIcon data-icon="inline-start" />
            {t("New chat")}
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}

/**
 * The two-column shell: conversations on the left, one conversation on the
 * right.
 *
 * Only the shell. Everything about a single conversation — what it says at the
 * top, how it streams, what happens when you cannot send — moved to
 * `assistant-conversation-pane`, which is the piece that was worth rewriting.
 * This file decides one thing: which of the three right-hand states to show.
 */
export function AssistantWorkspace({
  state,
  actions,
  onClose,
  expandHref,
  pane,
  paneTitle,
  paneCloseHref,
  className,
  compactRail = false,
}: {
  state: AssistantWorkspaceState
  actions: AssistantWorkspaceActions
  onClose?: () => void
  expandHref?: string
  /** Takes the conversation's place, with the rail left where it is. */
  pane?: ReactNode
  paneTitle?: string
  paneCloseHref?: string
  className?: string
  compactRail?: boolean
}) {
  const t = useExtracted()
  /**
   * The rail follows this element's width, never the window's.
   *
   * `md:` and `(min-width: 768px)` describe the viewport, and the assistant
   * also runs as a side panel: in a 500px panel on a 1400px screen every
   * viewport test said "desktop", so the rail took a static 288px and the
   * conversation was left with 212px — one word per line. `@3xl` is the same
   * 768px threshold read against the container, so the full page behaves
   * exactly as before and a narrow panel gets the overlay it always needed.
   */
  const rootRef = useRef<HTMLDivElement>(null)
  const containerWidth = useContainerWidth(rootRef)
  const wideRailDefault = containerWidth >= 768
  const [railPreference, setRailPreference] = useState<boolean | null>(null)
  const railOpen = railPreference ?? wideRailDefault
  const toggleRail = () =>
    setRailPreference((current) => !(current ?? wideRailDefault))

  return (
    <div
      ref={rootRef}
      className={cn(
        "@container relative flex min-h-0 overflow-hidden bg-background",
        className
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-30 flex shadow-xl transition-transform @3xl:static @3xl:z-auto @3xl:shadow-none",
          railOpen ? "translate-x-0" : "-translate-x-full @3xl:hidden"
        )}
      >
        <AssistantThreadRail
          threads={state.threads}
          selectedThreadId={state.detail?.thread.id ?? null}
          searchQuery={state.searchQuery}
          loading={state.loadingThreads}
          actions={actions}
          compact={compactRail}
        />
      </div>
      {railOpen ? (
        <button
          type="button"
          aria-label={t("Close conversations")}
          className="absolute inset-0 z-20 bg-black/20 @3xl:hidden"
          onClick={() => setRailPreference(false)}
        />
      ) : null}
      {pane ? (
        /*
         * A second view in the conversation's slot, not a page of its own.
         *
         * Action activity used to be a whole route: you left the assistant to
         * read it and, on a wide screen, nothing said how to come back — the
         * only affordance was drawn by the mobile header. It sits here now,
         * beside the same rail, and closes back into the conversation, which
         * is how opening a document inside the file browser already works.
         */
        <section className="flex min-h-0 flex-1 flex-col">
          <header className="flex min-h-(--header-h) items-center gap-2 border-b px-2 md:px-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                railOpen ? t("Hide conversations") : t("Show conversations")
              }
              onClick={toggleRail}
            >
              <PanelLeftIcon />
            </Button>
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
              {paneTitle}
            </h2>
            {paneCloseHref ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Close")}
                render={<Link href={paneCloseHref} />}
              >
                <XIcon />
              </Button>
            ) : null}
          </header>
          <div className="min-h-0 flex-1 overflow-auto">{pane}</div>
        </section>
      ) : state.detail ? (
        <ConversationPane
          key={state.detail.thread.id}
          state={{ ...state, detail: state.detail }}
          actions={actions}
          onClose={onClose}
          expandHref={expandHref}
          railOpen={railOpen}
          onToggleRail={toggleRail}
        />
      ) : state.loadingDetail ? (
        <ConversationSkeleton />
      ) : (
        <NoConversation
          onToggleRail={toggleRail}
          onClose={onClose}
          onCreate={() => void actions.createThread()}
        />
      )}
    </div>
  )
}
