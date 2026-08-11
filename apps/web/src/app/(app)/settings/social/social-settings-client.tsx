"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  GraduationCapIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { ChoiceField } from "@/components/forms/controls"
import { PageMeta } from "@/components/shell/page-chrome"
import { EligibilityState } from "@/components/social/eligibility-state"
import { GuardianRequestManager } from "@/components/social/guardian-request-manager"
import { SOCIAL_INVITATION_RETURN_KEY } from "@/components/social/invitation-setup-gate"
import { PrivacyBoundaryNotice } from "@/components/social/social-ui"
import { ResumeSocialInvitation } from "@/components/social/resume-social-invitation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type AgeBand = "under15" | "15to17" | "adult"

export function SocialSettingsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const eligibility = useQuery(orpc.social.eligibility.get.queryOptions())
  const profile = useQuery(orpc.social.profile.mine.queryOptions())
  const [ageBand, setAgeBand] = useState<AgeBand>("15to17")

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.eligibility.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.mine.key(),
      }),
    ])
  }

  const begin = useMutation({
    ...orpc.social.eligibility.begin.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Your eligibility choice was recorded."))
      await refresh()
    },
    onError: () => toast.error(t("The choice could not be recorded.")),
  })
  const activate = useMutation({
    ...orpc.social.profile.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Your social profile is active."))
      await refresh()
    },
    onError: () => toast.error(t("The social profile could not be activated.")),
  })
  const revoke = useMutation({
    ...orpc.social.eligibility.revoke.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Social sharing was turned off."))
      await refresh()
    },
    onError: () => toast.error(t("Social sharing could not be turned off.")),
  })

  const view = eligibility.data
  const ownProfile = profile.data?.profile
  const busy = begin.isPending || activate.isPending || revoke.isPending

  return (
    <>
      <PageMeta title={t("Social & sharing")} backHref="/settings" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Social & sharing")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Choose whether social features are available for this account."
            )}
          </p>
        </div>

        {!view || profile.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : (
          <>
            <EligibilityState eligibility={view} />

            <ResumeSocialInvitation
              groupReady={view.status === "active" && view.canUseSocial}
              friendReady={
                view.status === "active" &&
                view.canUseSocial &&
                ownProfile?.status === "active"
              }
            />

            {view.enabled && view.status === "age_unknown" ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("Choose an age range")}</CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(
                      "A birth date is not requested or stored. This choice only selects the correct consent path."
                    )}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ChoiceField
                    label={t("Age range")}
                    value={ageBand}
                    onValueChange={setAgeBand}
                    choices={[
                      {
                        value: "under15",
                        label: t("Under 15"),
                        description: t(
                          "Requires a child choice and verified guardian approval."
                        ),
                        icon: <UsersRoundIcon className="size-4" />,
                      },
                      {
                        value: "15to17",
                        label: t("15 to 17"),
                        description: t(
                          "You review and choose social sharing yourself."
                        ),
                        icon: <GraduationCapIcon className="size-4" />,
                      },
                      {
                        value: "adult",
                        label: t("18 or older"),
                        description: t(
                          "You review and choose social sharing yourself."
                        ),
                        icon: <UserRoundIcon className="size-4" />,
                      },
                    ]}
                  />
                  <Alert>
                    <ShieldCheckIcon aria-hidden />
                    <AlertTitle>{t("A choice, not a requirement")}</AlertTitle>
                    <AlertDescription>
                      {t(
                        "Continuing records consent to the current social policy. Leaving this screen keeps social sharing off and does not affect grades, goals or analytics."
                      )}{" "}
                      <Link href="/legal/social-sharing">
                        {t("Read the social sharing summary")}
                      </Link>
                    </AlertDescription>
                  </Alert>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        begin.mutate({
                          ageBand,
                          channel: "web",
                          acceptedPolicyVersion: view.policyVersion,
                        })
                      }
                    >
                      {begin.isPending ? <Spinner /> : null}
                      {t("I choose to continue")}
                    </Button>
                    <Button
                      variant="outline"
                      render={<Link href="/settings" />}
                      onClick={() =>
                        sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
                      }
                    >
                      {t("Keep social sharing off")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {view.status === "guardian_required" ||
            view.status === "verification_expired" ? (
              <GuardianRequestManager />
            ) : null}

            {view.status === "active" && ownProfile?.status === "off" ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("Create an invite-only profile")}</CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(
                      "The safest default is invite-only. Your profile is never published on the open web, and no profile field is shared until you grant it."
                    )}
                  </p>
                </CardHeader>
                <CardContent>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      activate.mutate({
                        status: "active",
                        discovery: "invite_only",
                        expectedRevision: ownProfile.revision,
                      })
                    }
                  >
                    {activate.isPending ? <Spinner /> : null}
                    {t("Activate invite-only profile")}
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {view.status === "active" && ownProfile?.status === "active" ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("Social profile")}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Manage profile fields, audiences and exact previews in the social area."
                    )}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button render={<Link href="/social/profile" />}>
                    {t("Manage sharing")}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button variant="destructive" disabled={busy} />}
                    >
                      {t("Turn social sharing off")}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("Turn social sharing off now?")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t(
                            "Your profile becomes unavailable immediately and active social consent is withdrawn. School tracking remains unchanged."
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => revoke.mutate({ channel: "web" })}
                        >
                          {t("Turn off social sharing")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            ) : null}

            <PrivacyBoundaryNotice />
          </>
        )}
      </div>
    </>
  )
}
