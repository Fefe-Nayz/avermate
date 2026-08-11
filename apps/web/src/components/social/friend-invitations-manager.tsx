"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  CopyIcon,
  LinkIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

export function FriendInvitationsManager() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const invitations = useQuery(
    orpc.social.friends.invitations.list.queryOptions()
  )
  const [freshLink, setFreshLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.friends.invitations.list.key(),
    })

  const create = useMutation({
    ...orpc.social.friends.invitations.create.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setFreshLink(new URL(result.sharePath, window.location.origin).toString())
      setCopied(false)
      await refresh()
    },
    onError: () =>
      toast.error(
        t(
          "A private invitation can only be created from an invite-only profile."
        )
      ),
  })
  const revoke = useMutation({
    ...orpc.social.friends.invitations.revoke.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Invitation revoked."))
      await refresh()
    },
  })

  async function copyLink() {
    if (!freshLink) return
    await navigator.clipboard.writeText(freshLink)
    setCopied(true)
    haptic("success")
  }

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">
          {t("Private invitation links")}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "A one-time link creates a friendship only after the recipient signs in, has social access and explicitly accepts."
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <Button
          disabled={create.isPending}
          onClick={() => create.mutate({ expiresInDays: 7 })}
        >
          {create.isPending ? <Spinner /> : <LinkIcon />}
          {t("Create a 7-day invitation")}
        </Button>

        {freshLink ? (
          <Alert>
            <ShieldCheckIcon aria-hidden />
            <AlertTitle>{t("Copy this link now")}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {t(
                  "For safety, the full secret is shown only after creation. Do not post it publicly."
                )}
              </p>
              <div className="flex gap-2">
                <Input
                  value={freshLink}
                  readOnly
                  aria-label={t("New private invitation link")}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" onClick={copyLink}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  <span className="sr-only">{t("Copy link")}</span>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {invitations.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {invitations.data.map((invitation) => {
              const active = !invitation.consumedAt && !invitation.revokedAt
              return (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={active ? "secondary" : "outline"}>
                      {invitation.consumedAt
                        ? t("Used")
                        : invitation.revokedAt
                          ? t("Revoked")
                          : t("Active")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t("One-time invitation")}
                    </span>
                  </div>
                  {active ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() =>
                        revoke.mutate({ invitationId: invitation.id })
                      }
                    >
                      <XIcon /> {t("Revoke")}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
