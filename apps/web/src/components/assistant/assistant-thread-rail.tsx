"use client"

import {
  ActivityIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type {
  AssistantThreadSummary,
  AssistantWorkspaceActions,
} from "./assistant-types"

type RailSection = "recent" | "starred" | "archived" | "trash"

function relativeTime(value: string | null | undefined): string {
  if (!value) return ""
  const milliseconds = new Date(value).getTime() - Date.now()
  const absolute = Math.abs(milliseconds)
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  if (absolute < 60_000)
    return format.format(Math.round(milliseconds / 1_000), "second")
  if (absolute < 3_600_000)
    return format.format(Math.round(milliseconds / 60_000), "minute")
  if (absolute < 86_400_000)
    return format.format(Math.round(milliseconds / 3_600_000), "hour")
  return format.format(Math.round(milliseconds / 86_400_000), "day")
}

function inSection(
  thread: AssistantThreadSummary,
  section: RailSection
): boolean {
  if (section === "trash") return Boolean(thread.deletedAt)
  if (thread.deletedAt) return false
  if (section === "archived") return Boolean(thread.archivedAt)
  if (thread.archivedAt) return false
  return section === "starred" ? Boolean(thread.starredAt) : true
}

function ThreadMenu({
  thread,
  actions,
  onRename,
}: {
  thread: AssistantThreadSummary
  actions: AssistantWorkspaceActions
  onRename: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${thread.title}`}
        render={<Button type="button" variant="ghost" size="icon-xs" />}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!thread.deletedAt ? (
          <>
            <DropdownMenuItem onClick={onRename}>
              <PencilIcon /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void actions.updateThread(thread.id, {
                  starred: !thread.starredAt,
                })
              }
            >
              <StarIcon /> {thread.starredAt ? "Unstar" : "Star"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void actions.updateThread(thread.id, {
                  archived: !thread.archivedAt,
                })
              }
            >
              {thread.archivedAt ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
              {thread.archivedAt ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void actions.trashThread(thread.id)}
            >
              <Trash2Icon /> Move to trash
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem
            onClick={() => void actions.restoreThread(thread.id)}
          >
            <ArchiveRestoreIcon /> Restore
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThreadRow({
  thread,
  selected,
  actions,
}: {
  thread: AssistantThreadSummary
  selected: boolean
  actions: AssistantWorkspaceActions
}) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(thread.title)

  if (renaming) {
    return (
      <form
        className="mx-2 my-1 flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          const clean = title.trim()
          if (!clean) return
          void actions.updateThread(thread.id, { title: clean })
          setRenaming(false)
        }}
      >
        <Input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRenaming(false)
          }}
          className="h-8"
          aria-label="Conversation title"
        />
        <Button type="submit" size="xs">
          Save
        </Button>
      </form>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group mx-2 my-0.5 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
      )}
      onClick={() => actions.selectThread(thread.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        actions.selectThread(thread.id)
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {thread.starredAt ? (
            <StarIcon className="size-3 fill-current" />
          ) : null}
          <span className="truncate text-sm font-medium">{thread.title}</span>
          {thread.running ? (
            <LoaderCircleIcon className="size-3 animate-spin text-primary" />
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {thread.preview || "No messages yet"}
          </span>
          <time suppressHydrationWarning>
            {relativeTime(thread.lastMessageAt ?? thread.updatedAt)}
          </time>
        </span>
      </span>
      <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <ThreadMenu
          thread={thread}
          actions={actions}
          onRename={() => setRenaming(true)}
        />
      </span>
    </div>
  )
}

export function AssistantThreadRail({
  threads,
  selectedThreadId,
  searchQuery,
  loading,
  actions,
  compact = false,
}: {
  threads: readonly AssistantThreadSummary[]
  selectedThreadId: string | null
  searchQuery: string
  loading: boolean
  actions: AssistantWorkspaceActions
  compact?: boolean
}) {
  const [section, setSection] = useState<RailSection>("recent")
  const visible = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return threads
      .filter((thread) => inSection(thread, section))
      .filter(
        (thread) =>
          !query ||
          thread.title.toLocaleLowerCase().includes(query) ||
          thread.preview?.toLocaleLowerCase().includes(query)
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }, [searchQuery, section, threads])

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-r bg-muted/15",
        compact ? "w-64" : "w-72"
      )}
      aria-label="Conversations"
    >
      <div className="flex items-center gap-2 p-3">
        <Button
          className="flex-1"
          size="sm"
          onClick={() => void actions.createThread()}
        >
          <PlusIcon data-icon="inline-start" /> New chat
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Open action activity"
          render={<Link href="/assistant/actions" />}
          nativeButton={false}
        >
          <ActivityIcon />
        </Button>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => actions.searchThreads(event.target.value)}
            placeholder="Search chats"
            className="pl-8"
          />
        </div>
      </div>
      <Tabs
        value={section}
        onValueChange={(value) => setSection(value as RailSection)}
      >
        <TabsList className="mx-3 grid grid-cols-4">
          <TabsTrigger value="recent" aria-label="Recent chats">
            Recent
          </TabsTrigger>
          <TabsTrigger value="starred" aria-label="Starred chats">
            ★
          </TabsTrigger>
          <TabsTrigger value="archived" aria-label="Archived chats">
            Archive
          </TabsTrigger>
          <TabsTrigger value="trash" aria-label="Deleted chats">
            Trash
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ScrollArea className="mt-2 min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Loading chats
          </div>
        ) : visible.length ? (
          <div className="pb-3">
            {visible.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedThreadId}
                actions={actions}
              />
            ))}
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No conversations in this section.
          </p>
        )}
      </ScrollArea>
    </aside>
  )
}
