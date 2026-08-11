"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  Clock3Icon,
  InboxIcon,
  SearchIcon,
  ShieldBanIcon,
  UserMinusIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersRoundIcon,
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
  PrivacyNote,
  SocialActions,
  SocialEmpty,
  SocialHeading,
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
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * Friends.
 *
 * The old screen gave every friend four buttons — view, remove, report, block
 * — so a list of ten people carried forty controls, three of them destructive,
 * all at the same weight. A friend now has one action, and choosing them opens
 * the panel that holds what they can see and everything you can do about it.
 */
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
  const incoming = requests.data?.incoming ?? []
  const outgoing = requests.data?.outgoing ?? []

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
        <SocialHeading
          icon={UsersRoundIcon}
          title={t("Friends")}
          description={t(
            "A connection needs both people to accept. Searching never reveals whether an account is absent, blocked or ineligible."
          )}
        />

        <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_20rem] @4xl/main:items-start">
          <div className="flex flex-col gap-4">
            {incoming.length ? (
              <SocialSection
                icon={InboxIcon}
                title={t("Waiting for your answer")}
                description={t(
                  "Accepting creates the connection. It shares nothing on its own."
                )}
              >
                <SocialList>
                  {incoming.map((request) => (
                    <SocialRow
                      key={request.id}
                      trailing={
                        <>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              accept.mutate({ requestId: request.id })
                            }
                          >
                            <CheckIcon /> {t("Accept")}
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
                        </>
                      }
                    >
                      <SocialIdentity
                        displayName={
                          request.profile?.displayName || t("Private account")
                        }
                        avatarUrl={request.profile?.avatar}
                        handle={request.profile?.handle}
                      />
                    </SocialRow>
                  ))}
                </SocialList>
              </SocialSection>
            ) : null}

            <SocialSection
              icon={UsersRoundIcon}
              title={
                friends.data
                  ? t("Your friends · {count}", {
                      count: String(friends.data.friends.length),
                    })
                  : t("Your friends")
              }
              description={t(
                "Each name already reflects what that person chose to share with you."
              )}
            >
              {friends.isPending ? (
                <div className="grid min-h-32 place-items-center">
                  <Spinner className="text-muted-foreground" />
                </div>
              ) : friends.data?.friends.length ? (
                <SocialList>
                  {friends.data.friends.map((friend) => {
                    const open = friend.friendshipId === selectedFriendId
                    return (
                      <SocialRow
                        key={friend.friendshipId}
                        trailing={
                          <Button
                            size="sm"
                            variant={open ? "secondary" : "ghost"}
                            onClick={() =>
                              setSelectedFriendId(
                                open ? null : friend.friendshipId
                              )
                            }
                          >
                            {open ? t("Close") : t("Open")}
                          </Button>
                        }
                      >
                        <SocialIdentity
                          displayName={
                            friend.profile?.displayName || t("Private friend")
                          }
                          avatarUrl={friend.profile?.avatar}
                          secondary={t("Only granted fields are shown")}
                        />
                      </SocialRow>
                    )
                  })}
                </SocialList>
              ) : (
                <SocialEmpty
                  title={t("No friends yet")}
                  description={t(
                    "Send a request to an exact handle, or share a one-time invitation link."
                  )}
                />
              )}
            </SocialSection>

            {selected ? (
              <SocialSection
                icon={UserRoundIcon}
                title={selected.profile?.displayName || t("Private friend")}
                description={t("Everything this connection involves.")}
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedFriendId(null)}
                  >
                    <XIcon /> {t("Close")}
                  </Button>
                }
                footer={
                  <SocialActions>
                    <ReportDialog
                      source="friendship"
                      sourceId={selected.friendshipId}
                    />
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button size="sm" variant="ghost" disabled={busy} />
                        }
                      >
                        <UserMinusIcon /> {t("Remove friend")}
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
                                friendshipId: selected.friendshipId,
                              })
                            }
                          >
                            {t("Remove friend")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busy}
                          />
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
                                sourceId: selected.friendshipId,
                              })
                            }
                          >
                            {t("Block account")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </SocialActions>
                }
              >
                <ProfilePreview
                  exact
                  profile={selected.profile ?? {}}
                  audienceLabel={t("Exactly what they share with you")}
                />
              </SocialSection>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <SocialSection
              icon={UserPlusIcon}
              title={t("Add by exact handle")}
              description={t(
                "A handle only works when its owner deliberately turned on exact-handle discovery."
              )}
            >
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
                <Button
                  type="submit"
                  size="icon"
                  aria-label={t("Send request")}
                  disabled={busy || handle.trim().length < 3}
                >
                  {send.isPending ? <Spinner /> : <UserPlusIcon />}
                </Button>
              </form>

              {outgoing.length ? (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3Icon className="size-3.5" aria-hidden />
                    {t("Sent and waiting")}
                  </p>
                  <SocialList>
                    {outgoing.map((request) => (
                      <SocialRow
                        key={request.id}
                        trailing={
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
                        }
                      >
                        <SocialIdentity
                          displayName={
                            request.profile?.displayName || t("Private account")
                          }
                          avatarUrl={request.profile?.avatar}
                          handle={request.profile?.handle}
                        />
                      </SocialRow>
                    ))}
                  </SocialList>
                </div>
              ) : null}
            </SocialSection>

            <FriendInvitationsManager />
            <BlocksManager />
          </div>
        </div>

        <CirclesManager />

        <PrivacyNote />
      </div>
    </>
  )
}
