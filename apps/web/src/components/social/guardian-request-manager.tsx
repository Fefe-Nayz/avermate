"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UserRoundCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  SocialCallout,
  SocialEmpty,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * Asking a guardian.
 *
 * The request code is the one thing on this screen the two people compare out
 * loud, so it is typeset to be read aloud rather than buried as a line of body
 * text. The guardian's address is deliberately never echoed back.
 */
export function GuardianRequestManager() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const requests = useQuery(orpc.social.guardian.requests.queryOptions())
  const [guardianEmail, setGuardianEmail] = useState("")

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.guardian.requests.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.eligibility.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.mine.key(),
      }),
    ])
  }

  const initiate = useMutation({
    ...orpc.social.guardian.initiate.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setGuardianEmail("")
      toast.success(
        t(
          "If the address can receive this request, a private guardian link has been sent."
        )
      )
      await refresh()
    },
    onError: () =>
      toast.error(t("The guardian request could not be processed.")),
  })
  const revoke = useMutation({
    ...orpc.social.guardian.revoke.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("The guardian request or approval was withdrawn."))
      await refresh()
    },
  })
  const busy = initiate.isPending || revoke.isPending

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = guardianEmail.trim().toLowerCase()
    if (email) initiate.mutate({ guardianEmail: email })
  }

  function statusOf(status: string) {
    if (status === "pending") return t("Waiting for the guardian")
    if (status === "accepted") return t("Approved")
    if (status === "declined") return t("Declined")
    return t("Inactive")
  }

  return (
    <SocialSection
      icon={UserRoundCheckIcon}
      title={t("Guardian verification")}
      description={t(
        "Two independent choices. Nothing about grades, goals or analytics is blocked while you wait."
      )}
    >
      <form className="space-y-2" onSubmit={submit}>
        <Label htmlFor="guardian-email">{t("Guardian email")}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="guardian-email"
            type="email"
            autoComplete="email"
            value={guardianEmail}
            onChange={(event) => setGuardianEmail(event.target.value)}
            placeholder="guardian@example.com"
            required
          />
          <Button
            type="submit"
            disabled={busy || guardianEmail.trim().length === 0}
          >
            {initiate.isPending ? <Spinner /> : null}
            {t("Send request")}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Use the address of a parent or guardian with parental authority. The link only works for a signed-in account with that verified email, and the address is never displayed here afterwards."
          )}
        </p>
      </form>

      {requests.data?.length ? (
        <SocialList>
          {requests.data.map((request) => (
            <SocialRow
              key={request.id}
              trailing={
                request.status === "pending" || request.status === "accepted" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => revoke.mutate({ requestId: request.id })}
                  >
                    {t("Withdraw")}
                  </Button>
                ) : null
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {statusOf(request.status)}
                </span>
                <Badge variant="outline" className="text-muted-foreground">
                  {t("Policy {version}", {
                    version: String(request.policyVersion),
                  })}
                </Badge>
              </div>
              <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">
                  {t("Request code")}
                </p>
                <p className="font-mono text-base font-semibold tracking-[0.2em]">
                  {request.requestCode}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {t(
                    "Not a secret. Read it out to check you are both looking at the same request."
                  )}
                </p>
              </div>
            </SocialRow>
          ))}
        </SocialList>
      ) : (
        <SocialEmpty
          compact
          icon={UserRoundCheckIcon}
          title={t("No request yet")}
          description={t(
            "Social access opens only after both the young person and a verified guardian agree."
          )}
        />
      )}

      <SocialCallout tone="positive" title={t("Either side can stop it")}>
        {t(
          "Withdrawing an approval turns social access off again, and leaves grades, goals and school analytics untouched."
        )}
      </SocialCallout>
    </SocialSection>
  )
}
