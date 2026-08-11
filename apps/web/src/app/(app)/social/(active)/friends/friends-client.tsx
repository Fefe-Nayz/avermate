"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  Clock3Icon,
  SearchIcon,
  ShieldBanIcon,
  ShieldCheckIcon,
  UserMinusIcon,
  UserPlusIcon,
  UserRoundXIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { BlocksManager } from "@/components/social/blocks-manager"
import { CirclesManager } from "@/components/social/circles-manager"
import { FriendInvitationsManager } from "@/components/social/friend-invitations-manager"
import { ProfilePreview } from "@/components/social/profile-preview"
import { ReportDialog } from "@/components/social/report-dialog"
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
  SocialPageHeading,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

export function FriendsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const friends = useQuery(orpc.social.friends.list.queryOptions())
  const requests = useQuery(orpc.social.friends.requests.queryOptions())
  const [handle, setHandle] = useState("")
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.requests.key(),
      }),
    ])
  }

  const send = useMutation({
    ...orpc.social.friends.send.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setHandle("")
      toast.success(
        t(
          "If this exact handle can receive requests, the request is now pending."
        )
      )
      await refresh()
    },
    onError: () =>
      toast.error(t("The request could not be processed. Try again later.")),
  })
  const accept = useMutation({
    ...orpc.social.friends.accept.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Friend request accepted."))
      await refresh()
    },
  })
  const decline = useMutation({
    ...orpc.social.friends.decline.mutationOptions(),
    onSuccess: refresh,
  })
  const cancel = useMutation({
    ...orpc.social.friends.cancel.mutationOptions(),
    onSuccess: refresh,
  })
  const remove = useMutation({
    ...orpc.social.friends.remove.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setSelectedFriendId(null)
      toast.success(
        t("Friend removed. Sharing access was recalculated immediately.")
      )
      await refresh()
    },
  })
  const block = useMutation({
    ...orpc.social.blocks.create.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setSelectedFriendId(null)
      toast.success(
        t("Account blocked. Connections and usable sharing ended immediately.")
      )
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: orpc.social.blocks.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.circles.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.grants.list.key(),
        }),
      ])
    },
  })

  const busy =
    send.isPending ||
    accept.isPending ||
    decline.isPending ||
    cancel.isPending ||
    remove.isPending ||
    block.isPending
  const selected = friends.data?.friends.find(
    (friend) => friend.friendshipId === selectedFriendId
  )

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const exact = handle.trim().replace(/^@/, "")
    if (exact.length < 3) return
    send.mutate({ handle: exact, message: null })
  }

  return (
    <>
      <PageMeta title={t("Friends")} backHref="/social" />
      <div className="flex flex-col gap-4">
        <SocialPageHeading
          title={t("Friends")}
          description={t(
            "Connections require acceptance from both people. Searching never reveals whether an account is absent, blocked or ineligible."
          )}
        />

        <Card className="py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">
              {t("Add by exact handle")}
            </CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                "A handle only works when its owner deliberately enabled exact-handle discovery."
              )}
            </p>
          </CardHeader>
          <CardContent className="px-4">
            <form className="flex gap-2" onSubmit={submit}>
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="@handle"
                  aria-label={t("Exact handle")}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={33}
                  className="pl-9"
                />
              </div>
              <Button type="submit" disabled={busy || handle.trim().length < 3}>
                {send.isPending ? <Spinner /> : <UserPlusIcon />}
                <span className="hidden sm:inline">{t("Send request")}</span>
              </Button>
            </form>
          </CardContent>
        </Card>

        {requests.data?.incoming.length || requests.data?.outgoing.length ? (
          <div className="grid gap-3 @lg/main:grid-cols-2">
            <Card className="py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">
                  {t("Received requests")} · {requests.data.incoming.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                {requests.data.incoming.length ? (
                  <ul className="divide-y rounded-lg border">
                    {requests.data.incoming.map((request) => (
                      <li
                        key={request.id}
                        className="flex items-center gap-3 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <SocialIdentity
                            displayName={
                              request.profile?.displayName ||
                              t("Private account")
                            }
                            avatarUrl={request.profile?.avatar}
                            handle={request.profile?.handle}
                          />
                        </div>
                        <Button
                          size="icon-sm"
                          aria-label={t("Accept request")}
                          disabled={busy}
                          onClick={() =>
                            accept.mutate({ requestId: request.id })
                          }
                        >
                          <CheckIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("Decline request")}
                          disabled={busy}
                          onClick={() =>
                            decline.mutate({ requestId: request.id })
                          }
                        >
                          <XIcon />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("Block requester")}
                                disabled={busy}
                              />
                            }
                          >
                            <ShieldBanIcon />
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("Block this requester?")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t(
                                  "The request disappears immediately and future connections or sharing between both accounts are prevented until you unblock."
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {t("Cancel")}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() =>
                                  block.mutate({
                                    source: "friend_request",
                                    sourceId: request.id,
                                  })
                                }
                              >
                                {t("Block account")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("No received requests.")}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">
                  {t("Sent requests")} · {requests.data.outgoing.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                {requests.data.outgoing.length ? (
                  <ul className="divide-y rounded-lg border">
                    {requests.data.outgoing.map((request) => (
                      <li
                        key={request.id}
                        className="flex items-center gap-3 p-3"
                      >
                        <Clock3Icon className="size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <SocialIdentity
                            displayName={
                              request.profile?.displayName ||
                              t("Private account")
                            }
                            avatarUrl={request.profile?.avatar}
                            handle={request.profile?.handle}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            cancel.mutate({ requestId: request.id })
                          }
                        >
                          {t("Cancel")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("No sent requests.")}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Card className="py-4">
          <CardHeader className="flex-row items-center justify-between px-4">
            <CardTitle className="text-sm">
              {t("Your friends")} · {friends.data?.friends.length ?? 0}
            </CardTitle>
            <Badge variant="outline">
              <ShieldCheckIcon /> {t("Grant-filtered")}
            </Badge>
          </CardHeader>
          <CardContent className="px-4">
            {friends.data?.friends.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {friends.data.friends.map((friend) => (
                  <li
                    key={friend.friendshipId}
                    className="space-y-3 rounded-xl border p-3"
                  >
                    <SocialIdentity
                      displayName={
                        friend.profile?.displayName || t("Private friend")
                      }
                      avatarUrl={friend.profile?.avatar}
                      secondary={t("Exact view for your account")}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedFriendId(friend.friendshipId)}
                      >
                        {t("View shared profile")}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button size="sm" variant="ghost" disabled={busy} />
                          }
                        >
                          <UserMinusIcon /> {t("Remove")}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("Remove this friend?")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t(
                                "The friendship and its circle memberships end immediately. Specific grants are no longer usable."
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                remove.mutate({
                                  friendshipId: friend.friendshipId,
                                })
                              }
                            >
                              {t("Remove friend")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <ReportDialog
                        source="friendship"
                        sourceId={friend.friendshipId}
                      />
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button size="sm" variant="ghost" disabled={busy} />
                          }
                        >
                          <ShieldBanIcon /> {t("Block")}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("Block this account?")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t(
                                "The friendship, pending requests, circle memberships and usable grants end immediately. They will not return if you unblock later."
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                block.mutate({
                                  source: "friendship",
                                  sourceId: friend.friendshipId,
                                })
                              }
                            >
                              {t("Block account")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty className="min-h-52 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UserRoundXIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t("No friends yet")}</EmptyTitle>
                  <EmptyDescription>
                    {t(
                      "Use an exact handle above. Both people remain in control."
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <div role="region" aria-label={t("Shared profile preview")}>
            <ProfilePreview
              exact
              profile={selected.profile ?? {}}
              audienceLabel={t("Exactly what this friend shares with you")}
            />
          </div>
        ) : null}

        <div className="grid gap-4 @xl/main:grid-cols-2">
          <FriendInvitationsManager />
          <BlocksManager />
        </div>

        <CirclesManager />

        <PrivacyBoundaryNotice compact />
      </div>
    </>
  )
}
