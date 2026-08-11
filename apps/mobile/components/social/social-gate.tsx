import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button, Empty, Loading, Problem, Screen, Section } from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import {
  socialAppIsAccessible,
  socialCoreIsAccessible,
  socialSetupIsAccessible,
} from "./social-model";

export function useSocialEligibility() {
  return useQuery({
    ...orpc.social.eligibility.get.queryOptions(),
    staleTime: 30_000,
  });
}

export function SocialRouteGate({
  children,
  requireActiveProfile = true,
}: {
  children: ReactNode;
  requireActiveProfile?: boolean;
}) {
  const router = useRouter();
  const eligibility = useSocialEligibility();

  if (eligibility.isLoading) return <Loading />;
  if (eligibility.isError || !eligibility.data) {
    return (
      <Screen>
        <Section>
          <Empty
            icon="cloud-offline-outline"
            title={t("Social is unavailable offline")}
            body={t("Reconnect to verify your current sharing permissions.")}
            action={
              <Button
                label={t("Try again")}
                variant="secondary"
                onPress={() => void eligibility.refetch()}
              />
            }
          />
        </Section>
      </Screen>
    );
  }

  if (!socialSetupIsAccessible(eligibility.data)) {
    return (
      <Screen>
        <Section>
          <Empty
            icon="people-outline"
            title={t("Social is not available yet")}
            body={t("Administrators can enable it when the privacy and moderation controls are ready for your account.")}
          />
        </Section>
      </Screen>
    );
  }

  const accessible = requireActiveProfile
    ? socialAppIsAccessible(eligibility.data)
    : socialCoreIsAccessible(eligibility.data);
  if (!accessible) {
    const frozen = eligibility.data.status === "frozen";
    return (
      <Screen>
        <Section>
          <Empty
            icon={frozen ? "lock-closed-outline" : "shield-checkmark-outline"}
            title={
              frozen
                ? t("Social access is paused")
                : requireActiveProfile && socialCoreIsAccessible(eligibility.data)
                  ? t("Activate a friend profile")
                  : t("Finish social setup")
            }
            body={
              frozen
                ? t("Your academic data remains private while an administrator reviews this account.")
                : requireActiveProfile && socialCoreIsAccessible(eligibility.data)
                  ? t("Friend features require an active profile. Groups remain available without one.")
                  : t("Choose your age band and consent to the current policy before anything is shared.")
            }
            action={
              frozen ? undefined : (
                <Button
                  label={
                    requireActiveProfile && socialCoreIsAccessible(eligibility.data)
                      ? t("Open social profile")
                      : t("Review setup")
                  }
                  onPress={() =>
                    router.push(
                      requireActiveProfile && socialCoreIsAccessible(eligibility.data)
                        ? "/social/profile"
                        : "/social/setup",
                    )
                  }
                />
              )
            }
          />
          {frozen ? (
            <Problem>{t("Contact support if you think this pause is a mistake.")}</Problem>
          ) : null}
        </Section>
      </Screen>
    );
  }

  return children;
}
