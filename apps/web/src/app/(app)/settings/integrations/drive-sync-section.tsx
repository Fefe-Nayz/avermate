"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  FolderIcon,
  FileIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { SettingsSection } from "@/components/settings/settings-section"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"

/** What `connectors.list` gives back, in the shape this screen reads. */
interface ContentConnection {
  id: string
  provider: string
  accountLabel: string
  status: "connected" | "expired" | "error"
  lastSyncedAt: Date | null
  lastError: string | null
  scopeJson: { folderIds: string[] } | null
}

/**
 * A personal drive, as a source of course materials.
 *
 * OneDrive and Google Drive are genuinely the same shape, which is worth
 * stating because Moodle is not: a drive authenticates by OAuth, knows nothing
 * about school, has to be *pointed* at folders, and reports changes by a delta
 * cursor and a webhook. Moodle knows your courses, brings grades and a
 * timetable as well as files, and is configured with a token you paste. So the
 * two drives share a component and Moodle keeps its own.
 *
 * Adding a drive is one entry in this table plus the provider on the server.
 */
export interface DriveProvider {
  /** Matches `content_connections.provider`. */
  id: "onedrive" | "googledrive"
  name: string
  /** The word for the top of the tree in the folder picker. */
  rootLabel: string
}

interface RemoteEntry {
  id: string
  name: string
  kind: "folder" | "file"
  childCount?: number | null
  /** Google Drive exposes navigation-only collections such as Shared with me. */
  selectable?: boolean
}

/**
 * OneDrive, as a source of course materials.
 *
 * Read-only and scoped: connecting does not pull in a drive, it pulls in the
 * folders you point at. That is the decision worth making visible on this
 * screen — "connected" is not a state anybody wants on its own, and a connector
 * with no scope chosen is a connector doing nothing, so it says so and offers
 * the picker rather than sitting there looking finished.
 *
 * Synced files land in the browser as rows with a `onedrive` chip, in whatever
 * folder the mapping puts them. There is deliberately no separate tree per
 * source: separating by connector forces you to choose *where to look* before
 * looking, and breaks the case that matters — the handout and your own notes
 * for the same chapter, side by side.
 */
export function DriveSyncSection({ provider }: { provider: DriveProvider }) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const { yearId } = useYear()
  const [scoping, setScoping] = useState<ContentConnection | null>(null)
  const [disconnecting, setDisconnecting] = useState<ContentConnection | null>(
    null
  )

  const connections = useQuery({
    ...orpc.connectors.list.queryOptions({ input: { yearId: yearId ?? "" } }),
    enabled: Boolean(yearId),
  })
  const mine = useMemo(
    () =>
      ((connections.data ?? []) as ContentConnection[]).filter(
        (connection) => connection.provider === provider.id
      ),
    [connections.data, provider.id]
  )

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.connectors.list.key() })

  const connect = useMutation({
    ...orpc.connectors.oauthUrl.mutationOptions(),
    onSuccess: (result) => {
      // Microsoft's consent screen, on its own page. Replacing rather than
      // opening a tab: a popup here is a popup blocker away from a dead button.
      window.location.href = (result as { url: string }).url
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(
        error.message ||
          t("{name} could not be reached.", { name: provider.name })
      )
    },
  })

  const syncNow = useMutation({
    ...orpc.connectors.syncNow.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Synchronization queued."))
      await refresh()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The synchronization could not start."))
    },
  })

  const disconnect = useMutation({
    ...orpc.connectors.disconnect.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDisconnecting(null)
      toast.success(t("{name} disconnected.", { name: provider.name }))
      await refresh()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(
        error.message ||
          t("{name} could not be disconnected.", { name: provider.name })
      )
    },
  })

  return (
    <SettingsSection
      id={provider.id}
      icon={CloudIcon}
      title={provider.name}
      description={t(
        "Choose folders in this account and their files appear in Supports, filed where you put them. Read-only: nothing is ever written back."
      )}
      footer={
        mine.length === 0 ? (
          <Button
            size="sm"
            disabled={connect.isPending || !yearId}
            onClick={() =>
              connect.mutate({
                // Widened on the server as each drive lands; the descriptor is
                // the only place that knows which ones exist.
                provider: provider.id,
                yearId: yearId ?? "",
              })
            }
          >
            {connect.isPending ? <Spinner /> : <CloudIcon />}
            {t("Connect {name}", { name: provider.name })}
          </Button>
        ) : null
      }
    >
      {connections.isPending ? (
        <div className="grid min-h-20 place-items-center">
          <Spinner className="size-4" />
        </div>
      ) : mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("No {name} account is connected.", { name: provider.name })}
        </p>
      ) : (
        <ul className="divide-y">
          {mine.map((connection) => {
            const scoped = connection.scopeJson?.folderIds.length ?? 0
            return (
              <li key={connection.id} className="flex flex-col gap-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {connection.accountLabel}
                  </span>
                  <Badge
                    variant={
                      connection.status === "connected"
                        ? "outline"
                        : "destructive"
                    }
                  >
                    {connection.status === "connected"
                      ? t("Connected")
                      : connection.status === "expired"
                        ? t("Sign in again")
                        : t("Error")}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  {[
                    scoped === 0
                      ? t("No folder chosen yet — nothing is being synced.")
                      : t(
                          "{count, plural, one {# folder} other {# folders}} synced",
                          { count: scoped }
                        ),
                    connection.lastSyncedAt
                      ? t("Last sync {when}", {
                          when: format.relativeTime(
                            new Date(connection.lastSyncedAt)
                          ),
                        })
                      : t("Never synced"),
                  ].join(" · ")}
                </p>

                {connection.lastError ? (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-lg bg-destructive/5 p-2 text-xs text-destructive"
                  >
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    {connection.lastError}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={scoped === 0 ? "default" : "outline"}
                    onClick={() => setScoping(connection)}
                  >
                    <FolderIcon />
                    {scoped === 0 ? t("Choose folders") : t("Change folders")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncNow.isPending || scoped === 0}
                    onClick={() =>
                      syncNow.mutate({ connectionId: connection.id })
                    }
                  >
                    {syncNow.isPending ? <Spinner /> : <RefreshCwIcon />}
                    {t("Sync now")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDisconnecting(connection)}
                  >
                    <Trash2Icon /> {t("Disconnect")}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {scoping ? (
        <DriveScopeDialog
          connection={scoping}
          provider={provider}
          onClose={() => setScoping(null)}
          onSaved={async () => {
            setScoping(null)
            await refresh()
          }}
        />
      ) : null}

      <AlertDialog
        open={disconnecting !== null}
        onOpenChange={(open) => (open ? undefined : setDisconnecting(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Disconnect {name}?", { name: provider.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* Said plainly, because "disconnect" reads as if it might delete
                  the files in the drive, and it does not. */}
              {t(
                "The synced files leave Supports. Nothing in the drive itself is touched."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={() =>
                disconnecting &&
                disconnect.mutate({ connectionId: disconnecting.id })
              }
            >
              {disconnect.isPending ? <Spinner /> : null}
              {t("Disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}

/**
 * Choosing what to sync, by walking the drive.
 *
 * A drill-down rather than a tree, because this is the one folder list in the
 * app that is not already loaded: every level is a round trip to Microsoft, and
 * a tree that expands would fetch branches nobody asked to see. Walking in means
 * exactly one request per folder you actually open.
 *
 * Choosing a folder takes everything inside it — the server collapses an
 * ancestor and its descendant to just the ancestor — so ticking a parent after
 * a child is not a contradiction, it is a simplification.
 */
function DriveScopeDialog({
  connection,
  provider,
  onClose,
  onSaved,
}: {
  connection: ContentConnection
  provider: DriveProvider
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const t = useExtracted()
  const [path, setPath] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: provider.rootLabel },
  ])
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(connection.scopeJson?.folderIds ?? [])
  )
  const here = path[path.length - 1]?.id ?? null

  const listing = useQuery({
    ...orpc.connectors.browse.queryOptions({
      input: {
        connectionId: connection.id,
        ...(here ? { remoteFolderId: here } : {}),
      },
    }),
  })
  const entries = (listing.data ?? []) as RemoteEntry[]
  const folders = entries.filter((entry) => entry.kind === "folder")
  const files = entries.filter((entry) => entry.kind === "file")

  const save = useMutation({
    ...orpc.connectors.setScope.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Folders saved. The first sync has started."))
      await onSaved()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The folders could not be saved."))
    },
  })

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Which folders?")}</DialogTitle>
          <DialogDescription>
            {t(
              "A chosen folder brings everything inside it, and keeps up with changes on its own."
            )}
          </DialogDescription>
        </DialogHeader>

        <nav
          aria-label={t("Path")}
          className="flex flex-wrap items-center gap-1"
        >
          {path.map((step, index) => (
            <span
              key={`${step.id ?? "root"}-${index}`}
              className="flex items-center gap-1"
            >
              {index > 0 ? (
                <ChevronRightIcon
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
              ) : null}
              <button
                type="button"
                disabled={index === path.length - 1}
                onClick={() =>
                  setPath((current) => current.slice(0, index + 1))
                }
                className={cn(
                  "max-w-40 truncate rounded px-1 text-xs",
                  index === path.length - 1
                    ? "font-medium"
                    : "text-muted-foreground hover:underline"
                )}
              >
                {step.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="max-h-72 min-h-56 overflow-auto rounded-lg border">
          {listing.isPending ? (
            <div className="grid min-h-56 place-items-center">
              <Spinner className="size-4" />
            </div>
          ) : listing.isError ? (
            <div className="grid min-h-56 place-items-center p-4 text-center">
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {listing.error.message ||
                    t("{name} could not be reached.", { name: provider.name })}
                </p>
                <Button size="sm" onClick={() => void listing.refetch()}>
                  <RefreshCwIcon /> {t("Retry")}
                </Button>
              </div>
            </div>
          ) : entries.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("This folder is empty.")}
            </p>
          ) : (
            <ul className="divide-y">
              {folders.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 px-2 py-1.5"
                >
                  {entry.selectable === false ? (
                    <span aria-hidden className="size-4 shrink-0" />
                  ) : (
                    <Checkbox
                      checked={selected.has(entry.id)}
                      onCheckedChange={(checked) => toggle(entry.id, checked)}
                      aria-label={t("Sync {name}", { name: entry.name })}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setPath((current) => [
                        ...current,
                        { id: entry.id, name: entry.name },
                      ])
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-accent"
                  >
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.name}
                    </span>
                    {entry.childCount ? (
                      <span className="numeric text-xs text-muted-foreground">
                        {entry.childCount}
                      </span>
                    ) : null}
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
              {/* Files are shown but not selectable: the unit of syncing is a
                  folder, and a list that hid them would look like an empty
                  folder to somebody who knows what is in it. */}
              {files.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 px-2 py-1.5 ps-9 text-sm text-muted-foreground"
                >
                  <FileIcon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {selected.size === 0
            ? t("Nothing chosen yet.")
            : t(
                "{count, plural, one {# folder chosen} other {# folders chosen}}",
                {
                  count: selected.size,
                }
              )}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                connectionId: connection.id,
                folderIds: [...selected],
              })
            }
          >
            {save.isPending ? <Spinner /> : <CheckIcon />}
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
