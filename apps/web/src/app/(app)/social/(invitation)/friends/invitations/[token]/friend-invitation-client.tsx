"use client"

import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { LinkIcon, UserRoundPlusIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  SocialEmpty,
  SocialIdentity,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * Someone handed over a link. Show who is asking, then one button. There is
 * no consent document any more: accepting a friend means your sharing locks
 * apply to them, nothing else.
 */
export function FriendInvitationClient({ token }: { token: string }) {
  const t = useExtracted()
  const router = useRouter()
  const preview = useQuery({
    ...orpc.social.friends.invitations.preview.queryOptions({
      input: { token },
    }),
    retry: false,
  })
  const accept = useMutation({
    ...orpc.social.friends.invitations.accept.mutationOptions(),
    onSuccess: (result) => {
      haptic("success")
      toast.success(t("You are now friends."))
      router.push(
        result.friendshipId
          ? `/social/friends/${result.friendshipId}`
          : "/social"
      )
    },
    onError: () => toast.error(t("This invitation can no longer be used.")),
  })

  if (preview.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  const data = preview.data
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-md py-10">
        <SocialEmpty
          icon={LinkIcon}
          title={t("This invitation is no longer valid")}
          description={t("It may have expired, been revoked, or already used.")}
          action={
            <Button variant="outline" onClick={() => router.push("/social")}>
              {t("Go to friends")}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <SocialSection
        icon={UserRoundPlusIcon}
        title={t("Friend invitation")}
        description={t(
          "Becoming friends shares only what each of you unlocked."
        )}
      >
        <SocialIdentity
          name={data.inviter.name}
          handle={data.inviter.handle}
          avatarUrl={data.inviter.avatar}
        />
        {data.self ? (
          <p className="text-sm text-muted-foreground">
            {t("This is your own invitation link — send it to someone else.")}
          </p>
        ) : data.alreadyFriends ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {t("You are already friends.")}
            </p>
            <Button variant="outline" onClick={() => router.push("/social")}>
              {t("Go to friends")}
            </Button>
          </div>
        ) : (
          <Button
            disabled={accept.isPending}
            onClick={() => accept.mutate({ token })}
          >
            {accept.isPending ? <Spinner /> : <UserRoundPlusIcon />}
            {t("Accept and become friends")}
          </Button>
        )}
      </SocialSection>
    </div>
  )
}
