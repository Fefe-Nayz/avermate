"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  FlameIcon,
  MoreHorizontalIcon,
  ShieldIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"

export interface ManagedUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  banReason?: string | null
  banExpires?: Date | string | null
  mokattamThemeAvailable: boolean
}

export function hasAdminRole(role: string): boolean {
  return role
    .split(",")
    .map((entry) => entry.trim())
    .includes("admin")
}

function localDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

export function AdminUserActions({
  user,
  onChanged,
  onDeleted,
}: {
  user: ManagedUser
  onChanged?: () => void
  onDeleted?: () => void
}) {
  const t = useExtracted()
  const viewer = useAuthenticatedUser()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<"ban" | "delete" | null>(null)
  const [reason, setReason] = useState(user.banReason ?? "")
  const [expiresAt, setExpiresAt] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [minimumExpiry] = useState(() => localDateTime(new Date()))
  const self = viewer.id === user.id
  const administrator = hasAdminRole(user.role)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.users.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.user.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.overview.key() }),
    ])
    onChanged?.()
  }
  const success = (message: string) => {
    toast.success(message)
    setDialog(null)
    void refresh()
  }
  const failure = (error: Error) => toast.error(error.message)

  const setRole = useMutation({
    ...orpc.admin.setRole.mutationOptions(),
    onSuccess: () => success(t("Role updated.")),
    onError: failure,
  })
  const setBanned = useMutation({
    ...orpc.admin.setBanned.mutationOptions(),
    onSuccess: () =>
      success(user.banned ? t("Suspension lifted.") : t("Account suspended.")),
    onError: failure,
  })
  const remove = useMutation({
    ...orpc.admin.deleteUser.mutationOptions(),
    onSuccess: () => {
      success(t("Account deleted."))
      onDeleted?.()
    },
    onError: failure,
  })
  const theme = useMutation({
    ...orpc.admin.grantTheme.mutationOptions(),
    onSuccess: () =>
      success(
        user.mokattamThemeAvailable
          ? t("Mokattam access removed.")
          : t("Mokattam unlocked for this account.")
      ),
    onError: failure,
  })
  const pending =
    setRole.isPending ||
    setBanned.isPending ||
    remove.isPending ||
    theme.isPending

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Manage {name}", { name: user.name })}
              disabled={pending}
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={self && administrator}
            onClick={() =>
              setRole.mutate({
                userId: user.id,
                role: administrator ? "user" : "admin",
              })
            }
          >
            <ShieldIcon className="size-4" />
            {administrator ? t("Remove admin") : t("Make admin")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              theme.mutate({
                userId: user.id,
                theme: "mokattam",
                available: !user.mokattamThemeAvailable,
              })
            }
          >
            <FlameIcon className="size-4" />
            {user.mokattamThemeAvailable
              ? t("Remove Mokattam")
              : t("Grant Mokattam")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.banned ? (
            <DropdownMenuItem
              disabled={self}
              onClick={() =>
                setBanned.mutate({
                  userId: user.id,
                  banned: false,
                  reason: null,
                  expiresAt: null,
                })
              }
            >
              <BanIcon className="size-4" /> {t("Lift suspension")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={self} onClick={() => setDialog("ban")}>
              <BanIcon className="size-4" /> {t("Suspend account")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={self}
            onClick={() => setDialog("delete")}
          >
            <Trash2Icon className="size-4" /> {t("Delete account")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialog === "ban"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("Suspend {name}", { name: user.name })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "All current sessions are revoked immediately. The reason is shown when access is denied."
              )}
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5 text-sm font-medium">
            {t("Reason")}
            <Textarea
              value={reason}
              maxLength={300}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("Explain why this account is suspended")}
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            {t("Expires (optional)")}
            <Input
              type="datetime-local"
              value={expiresAt}
              min={minimumExpiry}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || setBanned.isPending}
              onClick={() =>
                setBanned.mutate({
                  userId: user.id,
                  banned: true,
                  reason: reason.trim(),
                  expiresAt: expiresAt ? new Date(expiresAt) : null,
                })
              }
            >
              {t("Suspend account")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Delete {name}", { name: user.name })}</DialogTitle>
            <DialogDescription>
              {t(
                "This permanently deletes the account and all of its years, grades, goals and settings. Type the account id to confirm."
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-muted p-2 font-mono text-xs break-all">
            {user.id}
          </p>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={user.id}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={confirmation !== user.id || remove.isPending}
              onClick={() =>
                remove.mutate({ userId: user.id, confirmation: user.id })
              }
            >
              {t("Delete permanently")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
