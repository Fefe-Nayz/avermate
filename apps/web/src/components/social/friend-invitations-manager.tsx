"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { LinkIcon, XIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SecretLink } from "@/components/social/secret-link"
import {
  LinkState,
  SocialEmpty,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
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

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.friends.invitations.list.key(),
    })

  const create = useMutation({
    ...orpc.social.friends.invitations.create.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setFreshLink(new URL(result.sharePath, window.location.origin).toString())
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

  const live = invitations.data?.filter(
    (invitation) => !invitation.consumedAt && !invitation.revokedAt
  ).length

  return (
    <SocialSection
      icon={LinkIcon}
      title={t("Invitation links")}
      description={t(
        "A one-time link becomes a friendship only after the recipient signs in and accepts."
      )}
      action={
        <Button
          size="sm"
          disabled={create.isPending}
          onClick={() => create.mutate({ expiresInDays: 7 })}
        >
          {create.isPending ? <Spinner /> : <LinkIcon />}
          {t("New link")}
        </Button>
      }
    >
      {freshLink ? (
        <SecretLink url={freshLink} label={t("Your new invitation link")} />
      ) : null}

      {invitations.data?.length ? (
        <>
          <SocialList>
            {invitations.data.map((invitation) => (
              <SocialRow
                key={invitation.id}
                trailing={
                  <>
                    <LinkState
                      consumed={invitation.consumedAt}
                      revoked={invitation.revokedAt}
                    />
                    {!invitation.consumedAt && !invitation.revokedAt ? (
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
                  </>
                }
              >
                <p className="text-sm">{t("One-time invitation")}</p>
              </SocialRow>
            ))}
          </SocialList>
          <p className="text-xs text-muted-foreground">
            {live === 1
              ? t("One link can still be used.")
              : t("{count} links can still be used.", {
                  count: String(live ?? 0),
                })}
          </p>
        </>
      ) : (
        <SocialEmpty
          compact
          icon={LinkIcon}
          title={t("No invitation links")}
          description={t(
            "Use one to add someone who cannot find you by handle. It expires after seven days."
          )}
        />
      )}
    </SocialSection>
  )
}
