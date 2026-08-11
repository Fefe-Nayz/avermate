"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UsersRoundIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  GroupPolicySummary,
  type GroupPolicyView,
} from "@/components/social/group-policy-summary"
import {
  GroupTypeBadge,
  PrivacyNote,
  SocialCallout,
  SocialFlow,
  SocialHeading,
  SocialOutcome,
  SocialSection,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"

type InvitationPreview = {
  invitationId: string
  group: {
    id: string
    name: string
    description: string
    type: "friends" | "study_group" | "class"
  }
  policy: GroupPolicyView & { digest: string }
  expiresAt: Date
  ownerAlias?: string
}

/**
 * Deciding on a group invitation.
 *
 * Joining is deliberately two steps — a pending membership first, the field
 * choices second — and the old screen buried that in a paragraph while the
 * button said "Continue". The button now says what it does, so nobody accepts
 * a policy they thought they were only previewing.
 */
export function GroupInvitationClient({
  token,
  preview,
}: {
  token: string
  preview: InvitationPreview
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [alias, setAlias] = useState("")
  const [declined, setDeclined] = useState(false)
  const accept = useMutation({
    ...orpc.social.groups.invitations.accept.mutationOptions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push(`/social/groups/${result.groupId}`)
    },
  })
  const decline = useMutation({
    ...orpc.social.groups.invitations.decline.mutationOptions(),
    onSuccess: () => setDeclined(true),
  })
  const busy = accept.isPending || decline.isPending

  useEffect(() => {
    window.history.replaceState(window.history.state, "", "/social/groups")
  }, [])

  if (declined) {
    return (
      <SocialFlow>
        <SocialOutcome
          title={t("Invitation declined")}
          action={
            <Button render={<Link href="/social/groups" />}>
              {t("Back to groups")}
            </Button>
          }
        >
          {t(
            "No membership and no sharing permission were created. Nothing about your account changed."
          )}
        </SocialOutcome>
      </SocialFlow>
    )
  }

  return (
    <SocialFlow className="max-w-3xl">
      <SocialHeading
        icon={UsersRoundIcon}
        title={t("A private group invitation")}
        description={t(
          "Read the purpose, the audience, the requested figures and how far each one travels before deciding."
        )}
      />

      <SocialSection
        icon={UsersRoundIcon}
        title={preview.group.name}
        description={preview.group.description || undefined}
      >
        <div className="flex flex-wrap gap-1.5">
          <GroupTypeBadge type={preview.group.type} />
          <Badge variant="outline">
            {t("Responsible alias")}: {preview.ownerAlias || t("Group owner")}
          </Badge>
        </div>
      </SocialSection>

      <GroupPolicySummary policy={preview.policy} reconsentRequired />

      <SocialCallout tone="caution" title={t("This is step one of two")}>
        {t(
          "Continuing creates a pending membership only. On the next screen you choose the optional figures and your academic year — nothing is derived from your account before that."
        )}
      </SocialCallout>

      <SocialSection
        title={t("Your alias in this group")}
        description={t("Your account email and profile handle are never shown.")}
      >
        <div className="space-y-2">
          <Label htmlFor="invitation-alias" className="sr-only">
            {t("Your alias in this group")}
          </Label>
          <Input
            id="invitation-alias"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            maxLength={60}
            placeholder={t("Visible to participating group members")}
          />
        </div>
      </SocialSection>

      {accept.error || decline.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(
            "This invitation is unavailable, expired, changed or linked to another account."
          )}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => decline.mutate({ token })}
        >
          {decline.isPending ? <Spinner /> : null}
          {t("Decline without joining")}
        </Button>
        <Button
          disabled={busy || !alias.trim()}
          onClick={() => accept.mutate({ token, alias: alias.trim() })}
        >
          {accept.isPending ? <Spinner /> : null}
          {t("Continue to field choices")}
        </Button>
      </div>

      <PrivacyNote />
    </SocialFlow>
  )
}
