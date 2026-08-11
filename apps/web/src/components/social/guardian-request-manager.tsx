"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Guardian verification")}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t(
            "The child choice is recorded, but social access remains locked until a verified guardian also chooses. No school feature is blocked while waiting."
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {requests.data?.some((request) => request.status === "pending") ? (
          <Badge variant="secondary">{t("Request pending")}</Badge>
        ) : (
          <Badge variant="outline">{t("No active request")}</Badge>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Enter the email of a parent or guardian who has parental authority. The private link only works for a signed-in Avermate account with that verified email. The address is never displayed here afterward."
          )}
        </p>

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
              {t("Send private request")}
            </Button>
          </div>
        </form>

        {requests.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {requests.data.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {request.status === "pending"
                      ? t("Guardian request pending")
                      : request.status === "accepted"
                        ? t("Guardian approval active")
                        : request.status === "declined"
                          ? t("Guardian request declined")
                          : t("Guardian request inactive")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("Policy version")}: {request.policyVersion}
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold tracking-wider">
                    {t("Request code")}: {request.requestCode}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Compare this non-secret code with the guardian review screen before discussing the request."
                    )}
                  </p>
                </div>
                {request.status === "pending" ||
                request.status === "accepted" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => revoke.mutate({ requestId: request.id })}
                  >
                    {t("Withdraw")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <Alert>
          <ShieldCheckIcon aria-hidden />
          <AlertTitle>{t("Two independent choices")}</AlertTitle>
          <AlertDescription>
            {t(
              "Social access only becomes available after both the child and a verified guardian agree. A refusal or withdrawal leaves grades, goals and school analytics available."
            )}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}
