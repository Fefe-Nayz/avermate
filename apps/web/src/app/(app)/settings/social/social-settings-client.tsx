"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  GraduationCapIcon,
  PowerIcon,
  SlidersHorizontalIcon,
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
import {
  PrivacyNote,
  SocialActions,
  SocialCallout,
  SocialSection,
} from "@/components/social/social-ui"
import { ResumeSocialInvitation } from "@/components/social/resume-social-invitation"
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
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <UsersRoundIcon className="size-5 text-muted-foreground" />
            {t("Social & sharing")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Whether the optional social features are available for this account at all."
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

            {/*
             * Both the first run and every return after a withdrawal. The
             * server reports `age_unknown` only until an age band is on file;
             * once it is, withdrawing consent reports `consent_required`
             * instead — and that had no branch at all, so anyone who turned
             * social off could never turn it back on. The age question is
             * skipped when the answer is already known.
             */}
            {view.enabled &&
            (view.status === "age_unknown" ||
              view.status === "consent_required") ? (
              <SocialSection
                icon={PowerIcon}
                title={
                  view.status === "consent_required"
                    ? t("Turn social sharing back on")
                    : t("Choose an age range")
                }
                description={
                  view.status === "consent_required"
                    ? t(
                        "Consent was withdrawn, so nothing is shared right now. Granting it again restores access — it re-shares nothing on its own."
                      )
                    : t(
                        "A birth date is never requested or stored. This only picks the right consent path."
                      )
                }
                footer={
                  <SocialActions>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        begin.mutate({
                          ageBand:
                            view.status === "consent_required" &&
                            view.ageBand !== "unknown"
                              ? view.ageBand
                              : ageBand,
                          channel: "web",
                          acceptedPolicyVersion: view.policyVersion,
                        })
                      }
                    >
                      {begin.isPending ? <Spinner /> : null}
                      {t("I choose to continue")}
                    </Button>
                    <Button
                      variant="ghost"
                      render={<Link href="/settings" />}
                      onClick={() =>
                        sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
                      }
                    >
                      {t("Keep it off")}
                    </Button>
                  </SocialActions>
                }
              >
                {view.status === "age_unknown" ? (
                  <ChoiceField
                    label={t("Age range")}
                    value={ageBand}
                    onValueChange={setAgeBand}
                    choices={[
                      {
                        value: "under15",
                        label: t("Under 15"),
                        description: t(
                          "Needs both a choice from you and verified guardian approval."
                        ),
                        icon: <UsersRoundIcon className="size-4" />,
                      },
                      {
                        value: "15to17",
                        label: t("15 to 17"),
                        description: t("You choose for yourself."),
                        icon: <GraduationCapIcon className="size-4" />,
                      },
                      {
                        value: "adult",
                        label: t("18 or older"),
                        description: t("You choose for yourself."),
                        icon: <UserRoundIcon className="size-4" />,
                      },
                    ]}
                  />
                ) : null}

                <SocialCallout
                  tone="positive"
                  title={t("A choice, not a requirement")}
                >
                  {t(
                    "Continuing records consent to the current policy. Walking away keeps social sharing off and changes nothing about grades, goals or analytics."
                  )}{" "}
                  <Link
                    href="/legal/social-sharing"
                    className="underline underline-offset-4"
                  >
                    {t("Read the social sharing summary")}
                  </Link>
                </SocialCallout>
              </SocialSection>
            ) : null}

            {view.status === "guardian_required" ||
            view.status === "verification_expired" ? (
              <GuardianRequestManager />
            ) : null}

            {view.status === "active" && ownProfile?.status === "off" ? (
              <SocialSection
                icon={UserRoundIcon}
                title={t("Create an invite-only profile")}
                description={t(
                  "The safest starting point. Your profile is never published on the open web, and no field is shared until you grant it."
                )}
                footer={
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
                }
              >
                <SocialCallout title={t("What a profile is for")}>
                  {t(
                    "It is the thing permissions point at. Without one, nobody can be granted anything — with one, they still receive nothing until you say so."
                  )}
                </SocialCallout>
              </SocialSection>
            ) : null}

            {view.status === "active" && ownProfile?.status === "active" ? (
              <SocialSection
                icon={SlidersHorizontalIcon}
                title={t("Your social profile is on")}
                description={t(
                  "Fields, audiences and exact previews live in the social area."
                )}
              >
                <SocialActions>
                  <Button render={<Link href="/social/profile" />}>
                    {t("Manage sharing")}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          className="text-destructive"
                          disabled={busy}
                        />
                      }
                    >
                      <PowerIcon /> {t("Turn social sharing off")}
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
                </SocialActions>
              </SocialSection>
            ) : null}

            <PrivacyNote />
          </>
        )}
      </div>
    </>
  )
}
