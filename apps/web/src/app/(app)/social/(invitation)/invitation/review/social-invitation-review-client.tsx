"use client"

import Link from "next/link"
import { useLayoutEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ShieldXIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { FriendInvitationClient } from "../../friends/invitations/[token]/friend-invitation-client"
import { GroupInvitationClient } from "../../invitations/[token]/group-invitation-client"
import {
  InvitationSetupGate,
  SOCIAL_INVITATION_RETURN_KEY,
} from "@/components/social/invitation-setup-gate"
import { PageMeta } from "@/components/shell/page-chrome"
import { SocialFlow, SocialOutcome } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import {
  socialAppIsAccessible,
  socialGroupIsAccessible,
} from "@/lib/social-access"
import {
  parseSocialInvitationHandoff,
  type SocialInvitationSecret,
} from "@/lib/social-invitation"

export function SocialInvitationReviewClient() {
  const [invitation, setInvitation] = useState<
    SocialInvitationSecret | null | undefined
  >(undefined)

  useLayoutEffect(() => {
    const fromHandoff = parseSocialInvitationHandoff(
      sessionStorage.getItem(SOCIAL_INVITATION_RETURN_KEY)
    )
    sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
    queueMicrotask(() => setInvitation(fromHandoff))
  }, [])

  const eligibility = useQuery(orpc.social.eligibility.get.queryOptions())
  const friendPreview = useQuery({
    ...orpc.social.friends.invitations.preview.queryOptions({
      input: { token: invitation?.token ?? "" },
    }),
    enabled:
      invitation?.kind === "friend" && socialAppIsAccessible(eligibility.data),
    retry: false,
  })
  const groupPreview = useQuery({
    ...orpc.social.groups.invitations.preview.queryOptions({
      input: { token: invitation?.token ?? "" },
    }),
    enabled:
      invitation?.kind === "group" && socialGroupIsAccessible(eligibility.data),
    retry: false,
  })

  if (invitation === undefined || !eligibility.data) {
    return <InvitationSpinner />
  }

  if (!invitation) {
    return <UnavailableInvitation />
  }

  const ready =
    invitation.kind === "friend"
      ? socialAppIsAccessible(eligibility.data)
      : socialGroupIsAccessible(eligibility.data)
  if (!ready) {
    return (
      <InvitationSetupGate
        invitation={invitation}
        friendProfileRequired={invitation.kind === "friend"}
      />
    )
  }

  if (invitation.kind === "friend") {
    if (friendPreview.isPending) return <InvitationSpinner />
    if (!friendPreview.data || friendPreview.isError)
      return <UnavailableInvitation />
    return (
      <FriendInvitationClient
        token={invitation.token}
        preview={friendPreview.data}
      />
    )
  }

  if (groupPreview.isPending) return <InvitationSpinner />
  if (!groupPreview.data || groupPreview.isError)
    return <UnavailableInvitation />
  return (
    <GroupInvitationClient
      token={invitation.token}
      preview={groupPreview.data}
    />
  )
}

function InvitationSpinner() {
  const t = useExtracted()
  return (
    <div
      className="grid min-h-64 place-items-center"
      aria-label={t("Loading invitation")}
    >
      <Spinner className="text-muted-foreground" />
    </div>
  )
}

function UnavailableInvitation() {
  const t = useExtracted()
  return (
    <>
      <PageMeta title={t("Private social invitation")} backHref="/social" />
      <SocialFlow>
        <SocialOutcome
          icon={ShieldXIcon}
          title={t("This invitation cannot be opened")}
          action={
            <Button variant="outline" render={<Link href="/social" />}>
              {t("Return to social")}
            </Button>
          }
        >
          {t(
            "It is invalid, expired, already used, or meant for another account. No membership and no sharing permission were created."
          )}
        </SocialOutcome>
      </SocialFlow>
    </>
  )
}
