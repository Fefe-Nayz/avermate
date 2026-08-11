"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ShieldCheckIcon, UsersRoundIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  GroupPolicySummary,
  type GroupPolicyView,
} from "@/components/social/group-policy-summary"
import {
  PrivacyBoundaryNotice,
  SocialPageHeading,
} from "@/components/social/social-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>{t("Invitation declined")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            {t(
              "No membership or sharing permission was created. Avermate's school features remain unchanged."
            )}
          </p>
          <Button render={<Link href="/social/groups" />}>
            {t("Back to groups")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <SocialPageHeading
        title={t("Private group invitation")}
        description={t(
          "Review the purpose, audience, requested fields, exposure and withdrawal terms before making any choice."
        )}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UsersRoundIcon className="size-5" />
            <CardTitle>{preview.group.name}</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            {preview.group.description}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {preview.group.type === "class"
              ? t("Self-declared class group")
              : preview.group.type === "study_group"
                ? t("Study group")
                : t("Friends group")}
          </Badge>
          <Badge variant="outline">
            {t("Responsible alias")}: {preview.ownerAlias || t("Group owner")}
          </Badge>
        </CardContent>
      </Card>

      <GroupPolicySummary policy={preview.policy} reconsentRequired />

      <Alert>
        <ShieldCheckIcon aria-hidden />
        <AlertTitle>{t("Two-step consent")}</AlertTitle>
        <AlertDescription>
          {t(
            "Continuing creates a pending membership only. On the next screen you choose required and optional fields and your own academic year. Member details and statistics remain hidden until that exact policy is accepted."
          )}
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="invitation-alias">
          {t("Your alias in this group")}
        </Label>
        <Input
          id="invitation-alias"
          value={alias}
          onChange={(event) => setAlias(event.target.value)}
          maxLength={60}
          placeholder={t("Visible to participating group members")}
        />
        <p className="text-xs text-muted-foreground">
          {t(
            "Your account email and profile handle are not shown to the group."
          )}
        </p>
      </div>

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

      <PrivacyBoundaryNotice />
    </div>
  )
}
