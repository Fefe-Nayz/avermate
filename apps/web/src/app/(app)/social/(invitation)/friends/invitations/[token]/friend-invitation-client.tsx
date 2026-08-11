"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UserRoundCheckIcon, UserRoundPlusIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import { ProfilePreview } from "@/components/social/profile-preview"
import {
  PrivacyNote,
  SocialCallout,
  SocialFlow,
  SocialHeading,
  SocialOutcome,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type InvitationPreview = {
  invitationId: string
  expiresAt: Date
  profile: { displayName: string | null; avatar: string | null }
}

export function FriendInvitationClient({
  token,
  preview,
}: {
  token: string
  preview: InvitationPreview
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [accepted, setAccepted] = useState(false)
  const accept = useMutation({
    ...orpc.social.friends.invitations.accept.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setAccepted(true)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.friends.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.friends.requests.key(),
        }),
      ])
    },
  })

  useEffect(() => {
    window.history.replaceState(window.history.state, "", "/social/friends")
  }, [])

  if (accepted) {
    return (
      <SocialFlow>
        <PageMeta title={t("Private friend invitation")} />
        <SocialOutcome
          tone="positive"
          icon={UserRoundCheckIcon}
          title={t("You are now connected")}
          action={
            <Button render={<Link href="/social/friends" />}>
              {t("Go to friends")}
            </Button>
          }
        >
          {t(
            "Nothing is shared yet. Each of you still decides, field by field, what the other receives."
          )}
        </SocialOutcome>
      </SocialFlow>
    )
  }

  return (
    <>
      <PageMeta
        title={t("Private friend invitation")}
        backHref="/social/friends"
      />
      <SocialFlow>
        <SocialHeading
          icon={UserRoundPlusIcon}
          title={t("A private friend invitation")}
          description={t(
            "Someone sent you a one-time link. Here is everything they currently share."
          )}
        />

        <ProfilePreview
          profile={preview.profile}
          audienceLabel={t("The person who invited you")}
        />

        <SocialCallout tone="positive" title={t("What accepting does")}>
          {t(
            "It creates a mutual connection and nothing else. No profile field becomes visible by itself, and either of you can remove or block the other immediately."
          )}
        </SocialCallout>

        {accept.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t("This invitation is unavailable or was already used.")}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" render={<Link href="/social/friends" />}>
            {t("Not now")}
          </Button>
          <Button
            disabled={accept.isPending}
            onClick={() => accept.mutate({ token })}
          >
            {accept.isPending ? <Spinner /> : null}
            {t("Accept friendship")}
          </Button>
        </div>

        <PrivacyNote />
      </SocialFlow>
    </>
  )
}
