"use client"

import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { LinkIcon, UsersRoundIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  SocialCallout,
  SocialEmpty,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * A group link. Who invited, what the room is, one button. Your average only
 * appears to the group while your own switch is on — and it starts on, which
 * the screen says out loud before you join.
 */
export function GroupInvitationClient({ token }: { token: string }) {
  const t = useExtracted()
  const router = useRouter()
  const preview = useQuery({
    ...orpc.social.groups.invitations.preview.queryOptions({
      input: { token },
    }),
    retry: false,
  })
  const accept = useMutation({
    ...orpc.social.groups.invitations.accept.mutationOptions(),
    onSuccess: (result) => {
      haptic("success")
      toast.success(result.joined ? t("Welcome to the group.") : t("You are already a member."))
      router.push(`/social/groups/${result.groupId}`)
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
          description={t("It may have expired, been revoked, or the group is gone.")}
          action={
            <Button
              variant="outline"
              onClick={() => router.push("/social/groups")}
            >
              {t("Go to groups")}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <SocialSection
        icon={UsersRoundIcon}
        title={data.group.name}
        description={data.group.description || undefined}
      >
        <p className="text-sm text-muted-foreground">
          {data.inviter
            ? t("{name} invites you. {count} people are in.", {
                name: data.inviter.name,
                count: String(data.group.memberCount),
              })
            : t("{count} people are in.", { count: String(data.group.memberCount) })}
        </p>
        {data.group.hasSharedSetup ? (
          <p className="text-sm text-muted-foreground">
            {t(
              "This group offers a common year configuration you can adopt after joining."
            )}
          </p>
        ) : null}
        <SocialCallout title={t("What joining shares")}>
          {t(
            "Members compare general averages. Yours is visible on joining, and one switch inside the group hides it whenever you want."
          )}
        </SocialCallout>
        {data.alreadyMember ? (
          <Button
            variant="outline"
            onClick={() => router.push("/social/groups")}
          >
            {t("You are already a member — open groups")}
          </Button>
        ) : (
          <Button
            disabled={accept.isPending}
            onClick={() => accept.mutate({ token })}
          >
            {accept.isPending ? <Spinner /> : <UsersRoundIcon />}
            {t("Join the group")}
          </Button>
        )}
      </SocialSection>
    </div>
  )
}
