"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FolderPlusIcon,
  LayersIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  SocialActions,
  SocialEmpty,
  SocialIdentity,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"

/**
 * Circles are the only grouping a person makes about their own friends, and
 * the old panel hid that behind a two-pane file browser. Circles are few and
 * short-named, so they are shown all at once as selectable chips and the
 * chosen one opens underneath.
 */
export function CirclesManager() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const circles = useQuery(orpc.social.circles.list.queryOptions())
  const friends = useQuery(orpc.social.friends.list.queryOptions())
  const [newName, setNewName] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rename, setRename] = useState("")
  const [friendshipId, setFriendshipId] = useState("")

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.circles.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.grants.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.previewMineAs.key(),
      }),
    ])
  }

  const create = useMutation({
    ...orpc.social.circles.create.mutationOptions(),
    onSuccess: async (circle) => {
      haptic("success")
      setNewName("")
      setSelectedId(circle.id)
      setRename(circle.name)
      toast.success(t("Circle created."))
      await refresh()
    },
  })
  const update = useMutation({
    ...orpc.social.circles.update.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Circle renamed."))
      await refresh()
    },
  })
  const removeCircle = useMutation({
    ...orpc.social.circles.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setSelectedId(null)
      toast.success(t("Circle deleted and its grants withdrawn."))
      await refresh()
    },
  })
  const addMember = useMutation({
    ...orpc.social.circles.addMember.mutationOptions(),
    onSuccess: async () => {
      setFriendshipId("")
      await refresh()
    },
  })
  const removeMember = useMutation({
    ...orpc.social.circles.removeMember.mutationOptions(),
    onSuccess: refresh,
  })

  const selected = circles.data?.find((circle) => circle.id === selectedId)
  const availableFriends = useMemo(() => {
    const memberFriendships = new Set(
      selected?.members.map((member) => member.friendshipId).filter(Boolean)
    )
    return (friends.data?.friends ?? []).filter(
      (friend) => !memberFriendships.has(friend.friendshipId)
    )
  }, [friends.data?.friends, selected?.members])
  const busy =
    create.isPending ||
    update.isPending ||
    removeCircle.isPending ||
    addMember.isPending ||
    removeMember.isPending

  function createCircle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newName.trim()
    if (name) create.mutate({ name })
  }

  return (
    <SocialSection
      icon={LayersIcon}
      title={t("Friend circles")}
      description={t(
        "A private grouping used to target permissions. Members are never told the circle name, nor who else is in it."
      )}
    >
      <form className="flex gap-2" onSubmit={createCircle}>
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={t("New circle name")}
          aria-label={t("New circle name")}
          maxLength={60}
        />
        <Button disabled={busy || !newName.trim()}>
          {create.isPending ? <Spinner /> : <FolderPlusIcon />}
          <span className="hidden sm:inline">{t("Create")}</span>
        </Button>
      </form>

      {circles.data?.length ? (
        <>
          <div className="flex flex-wrap gap-2">
            {circles.data.map((circle) => {
              const active = selectedId === circle.id
              return (
                <button
                  key={circle.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedId(active ? null : circle.id)
                    setRename(circle.name)
                    setFriendshipId("")
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "hover:bg-accent/60"
                  )}
                >
                  <span className="truncate">{circle.name}</span>
                  <span
                    className={cn(
                      "numeric rounded-full px-1.5 text-xs",
                      active
                        ? "bg-primary/15"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {circle.members.length}
                  </span>
                </button>
              )
            })}
          </div>

          {selected ? (
            <div className="flex flex-col gap-4 rounded-xl border p-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1 space-y-2">
                  <Label htmlFor="circle-name">{t("Circle name")}</Label>
                  <Input
                    id="circle-name"
                    value={rename}
                    onChange={(event) => setRename(event.target.value)}
                    maxLength={60}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy || !rename.trim() || rename.trim() === selected.name
                  }
                  onClick={() =>
                    update.mutate({
                      circleId: selected.id,
                      name: rename.trim(),
                      expectedRevision: selected.revision,
                    })
                  }
                >
                  {update.isPending ? <Spinner /> : null}
                  {t("Rename")}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t("Delete circle")}
                        disabled={busy}
                      />
                    }
                  >
                    <Trash2Icon />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("Delete this circle?")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t(
                          "The private grouping and every field permission targeting it are withdrawn. Friendships remain unchanged."
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() =>
                          removeCircle.mutate({
                            circleId: selected.id,
                            expectedRevision: selected.revision,
                          })
                        }
                      >
                        {t("Delete circle")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <SocialActions>
                <SelectControl
                  aria-label={t("Friend to add")}
                  value={friendshipId}
                  onValueChange={setFriendshipId}
                  placeholder={t("Choose a friend…")}
                  className="min-w-48 flex-1"
                  options={availableFriends.map((friend) => ({
                    value: friend.friendshipId,
                    label: friend.profile?.displayName || t("Private friend"),
                  }))}
                />
                <Button
                  type="button"
                  disabled={busy || !friendshipId}
                  onClick={() =>
                    addMember.mutate({
                      circleId: selected.id,
                      friendshipId,
                      expectedRevision: selected.revision,
                    })
                  }
                >
                  {addMember.isPending ? <Spinner /> : <UserPlusIcon />}
                  {t("Add")}
                </Button>
              </SocialActions>

              {selected.members.length ? (
                <SocialList>
                  {selected.members.map((member) => (
                    <SocialRow
                      key={member.id}
                      trailing={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("Remove from circle")}
                          disabled={busy}
                          onClick={() =>
                            removeMember.mutate({
                              circleId: selected.id,
                              circleMemberId: member.id,
                              expectedRevision: selected.revision,
                            })
                          }
                        >
                          <UserMinusIcon />
                        </Button>
                      }
                    >
                      <SocialIdentity
                        displayName={
                          member.profile?.displayName || t("Private friend")
                        }
                        avatarUrl={member.profile?.avatar}
                      />
                    </SocialRow>
                  ))}
                </SocialList>
              ) : (
                <SocialEmpty
                  compact
                  icon={UserPlusIcon}
                  title={t("This circle is empty")}
                  description={t(
                    "Add friends to it, then point a permission at the circle instead of at each person."
                  )}
                />
              )}
            </div>
          ) : null}
        </>
      ) : (
        <SocialEmpty
          compact
          icon={LayersIcon}
          title={t("No circles yet")}
          description={t("Friends are never grouped automatically.")}
        />
      )}
    </SocialSection>
  )
}
