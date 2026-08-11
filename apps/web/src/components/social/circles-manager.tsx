"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FolderPlusIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SocialIdentity } from "@/components/social/social-ui"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

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
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t("Friend circles")}</CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Private circles help target field permissions. Members are not told the circle name and cannot see who else is inside."
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
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
            <span className="hidden sm:inline">{t("Create circle")}</span>
          </Button>
        </form>

        {circles.data?.length ? (
          <div className="grid gap-4 @lg/main:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="flex gap-2 overflow-x-auto @lg/main:flex-col">
              {circles.data.map((circle) => (
                <Button
                  key={circle.id}
                  type="button"
                  variant={selectedId === circle.id ? "secondary" : "ghost"}
                  className="justify-between"
                  onClick={() => {
                    setSelectedId(circle.id)
                    setRename(circle.name)
                  }}
                >
                  <span className="truncate">{circle.name}</span>
                  <Badge variant="outline">{circle.members.length}</Badge>
                </Button>
              ))}
            </div>

            {selected ? (
              <section
                className="space-y-4 rounded-xl border p-4"
                aria-labelledby="circle-title"
              >
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label htmlFor="circle-name" id="circle-title">
                      {t("Circle name")}
                    </Label>
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

                <div className="flex flex-col gap-2 sm:flex-row">
                  <SelectControl
                    aria-label={t("Friend to add")}
                    value={friendshipId}
                    onValueChange={setFriendshipId}
                    placeholder={t("Choose a friend…")}
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
                </div>

                {selected.members.length ? (
                  <ul className="divide-y rounded-lg border">
                    {selected.members.map((member) => (
                      <li
                        key={member.id}
                        className="flex items-center gap-3 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <SocialIdentity
                            displayName={
                              member.profile?.displayName || t("Private friend")
                            }
                            avatarUrl={member.profile?.avatar}
                          />
                        </div>
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
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    {t("This circle is empty.")}
                  </p>
                )}
              </section>
            ) : (
              <div className="grid min-h-40 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
                {t("Choose a circle to manage it.")}
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("No circles yet. Friends are never grouped automatically.")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
