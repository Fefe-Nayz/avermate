"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2Icon, ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import { ProfilePreview } from "@/components/social/profile-preview"
import { PrivacyBoundaryNotice } from "@/components/social/social-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="text-success" /> {t("Friend added")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/social/friends" />}>
            {t("Go to friends")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <PageMeta
        title={t("Private friend invitation")}
        backHref="/social/friends"
      />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <ProfilePreview
          profile={preview.profile}
          audienceLabel={t("Invitation sender")}
        />
        <Alert>
          <ShieldCheckIcon aria-hidden />
          <AlertTitle>{t("Your choice")}</AlertTitle>
          <AlertDescription>
            {t(
              "Accepting creates a mutual friend connection. It does not reveal any profile field by itself: each person still chooses explicit audiences, and either person can remove or block the other immediately."
            )}
          </AlertDescription>
        </Alert>
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
        <PrivacyBoundaryNotice compact />
      </div>
    </>
  )
}
