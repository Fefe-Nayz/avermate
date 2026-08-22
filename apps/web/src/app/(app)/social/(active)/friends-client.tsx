"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CheckIcon,
  ClockIcon,
  LinkIcon,
  MailPlusIcon,
  UserRoundPlusIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SecretLink } from "@/components/social/secret-link"
import {
  SharingState,
  SocialActions,
  SocialEmpty,
  SocialHeading,
  SocialIdentity,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * Friends: the list, the two ways in (handle or link), the requests in both
 * directions, and the block list. One screen, because none of these deserves
 * a page of its own any more.
 */
export function FriendsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const friends = useQuery(orpc.social.friends.list.queryOptions())
  const requests = useQuery(orpc.social.friends.requests.queryOptions())
  const invitations = useQuery(
    orpc.social.friends.invitations.list.queryOptions()
  )
  const blocks = useQuery(orpc.social.blocks.list.queryOptions())
  const [handle, setHandle] = useState("")
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.requests.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.invitations.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.blocks.list.key(),
      }),
    ])
  }

  const send = useMutation({
    ...orpc.social.friends.request.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setHandle("")
      toast.success(
        result.status === "accepted"
          ? t("They had already asked — you are now friends.")
          : t("Request sent.")
      )
      await refresh()
    },
    onError: () => toast.error(t("Nobody with that handle could be reached.")),
  })
  const respond = useMutation({
    ...orpc.social.friends.respond.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      toast.success(
        result.status === "accepted"
          ? t("Friend added.")
          : t("Request declined.")
      )
      await refresh()
    },
  })
  const cancel = useMutation({
    ...orpc.social.friends.cancel.mutationOptions(),
    onSuccess: refresh,
  })
  const createInvite = useMutation({
    ...orpc.social.friends.invitations.create.mutationOptions(),
    onSuccess: async (invitation) => {
      haptic("success")
      setInviteUrl(
        `${window.location.origin}/social/friends/invitations/${invitation.token}`
      )
      await refresh()
    },
  })
  const revokeInvite = useMutation({
    ...orpc.social.friends.invitations.revoke.mutationOptions(),
    onSuccess: refresh,
  })
  const unblock = useMutation({
    ...orpc.social.blocks.remove.mutationOptions(),
    onSuccess: refresh,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = handle.trim()
    if (value) send.mutate({ handle: value })
  }

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={UsersRoundIcon}
        title={t("Friends")}
        description={t(
          "Each friend sees exactly what your sharing locks allow — nothing more."
        )}
      />

      <SocialSection
        icon={UserRoundPlusIcon}
        title={t("Add a friend")}
        description={t("By their handle, or with a link you send them.")}
      >
        <form className="flex gap-2" onSubmit={submit}>
          <Input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder={t("their-handle")}
            aria-label={t("Friend's handle")}
            maxLength={32}
          />
          <Button type="submit" disabled={send.isPending || !handle.trim()}>
            {send.isPending ? <Spinner /> : <MailPlusIcon />}
            <span className="hidden sm:inline">{t("Send request")}</span>
          </Button>
        </form>
        <SocialActions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={createInvite.isPending}
            onClick={() => createInvite.mutate({})}
          >
            {createInvite.isPending ? <Spinner /> : <LinkIcon />}
            {t("Create an invitation link")}
          </Button>
          {(invitations.data ?? []).map((invitation) => (
            <Button
              key={invitation.id}
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() =>
                revokeInvite.mutate({ invitationId: invitation.id })
              }
            >
              <XIcon />
              {t("Revoke {prefix}…", { prefix: invitation.tokenPrefix })}
            </Button>
          ))}
        </SocialActions>
        {inviteUrl ? (
          <SecretLink url={inviteUrl} label={t("Your invitation link")} />
        ) : null}
      </SocialSection>

      {requests.data?.incoming.length ? (
        <SocialSection
          icon={ClockIcon}
          title={t("Requests for you")}
          description={t("Accepting makes sharing mutual by default.")}
        >
          <SocialList>
            {requests.data.incoming.map((request) => (
              <SocialRow
                key={request.id}
                trailing={
                  <SocialActions>
                    <Button
                      type="button"
                      size="sm"
                      disabled={respond.isPending}
                      onClick={() =>
                        respond.mutate({ requestId: request.id, accept: true })
                      }
                    >
                      <CheckIcon /> {t("Accept")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={respond.isPending}
                      onClick={() =>
                        respond.mutate({ requestId: request.id, accept: false })
                      }
                    >
                      <XIcon /> {t("Decline")}
                    </Button>
                  </SocialActions>
                }
              >
                <SocialIdentity
                  name={request.name}
                  handle={request.handle}
                  avatarUrl={request.avatar}
                  hint={request.message ?? undefined}
                />
              </SocialRow>
            ))}
          </SocialList>
        </SocialSection>
      ) : null}

      {requests.data?.outgoing.length ? (
        <SocialSection icon={ClockIcon} title={t("Waiting for an answer")}>
          <SocialList>
            {requests.data.outgoing.map((request) => (
              <SocialRow
                key={request.id}
                trailing={
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate({ requestId: request.id })}
                  >
                    {t("Cancel")}
                  </Button>
                }
              >
                <SocialIdentity
                  name={request.name}
                  handle={request.handle}
                  avatarUrl={request.avatar}
                />
              </SocialRow>
            ))}
          </SocialList>
        </SocialSection>
      ) : null}

      <SocialSection
        icon={UsersRoundIcon}
        title={t("Your friends")}
        description={t("Open someone to see what they share with you.")}
      >
        {friends.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : friends.data?.friends.length ? (
          <SocialList>
            {friends.data.friends.map((friend) => (
              <SocialRow
                key={friend.friendshipId}
                href={`/social/friends/${friend.friendshipId}`}
                trailing={
                  <SharingState
                    granted={friend.sharesSomething}
                    label={
                      friend.sharesSomething ? t("Shares") : t("Shares nothing")
                    }
                  />
                }
              >
                <SocialIdentity
                  name={friend.name}
                  handle={friend.handle}
                  avatarUrl={friend.avatar}
                />
              </SocialRow>
            ))}
          </SocialList>
        ) : (
          <SocialEmpty
            compact
            icon={UsersRoundIcon}
            title={t("No friends yet")}
            description={t(
              "Send a request to a handle you know, or share an invitation link."
            )}
          />
        )}
      </SocialSection>

      {blocks.data?.length ? (
        <SocialSection
          icon={BanIcon}
          title={t("Blocked")}
          description={t(
            "Blocked accounts cannot reach you with requests or invitations."
          )}
        >
          <SocialList>
            {blocks.data.map((block) => (
              <SocialRow
                key={block.id}
                trailing={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={unblock.isPending}
                    onClick={() => unblock.mutate({ blockId: block.id })}
                  >
                    {t("Unblock")}
                  </Button>
                }
              >
                <SocialIdentity name={block.name} avatarUrl={block.avatar} />
              </SocialRow>
            ))}
          </SocialList>
        </SocialSection>
      ) : null}
    </div>
  )
}
