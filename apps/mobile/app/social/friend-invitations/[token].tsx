import { useRef } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSocialEligibility } from "@/components/social/social-gate";
import {
  socialAppIsAccessible,
  socialCoreIsAccessible,
} from "@/components/social/social-model";
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
} from "@/components/social/social-ui";
import {
  Button,
  Card,
  Confirmation,
  Empty,
  Loading,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";
import {
  discardSocialInvitation,
  holdSocialInvitation,
} from "@/lib/social-invitation-session";

export default function AcceptFriendInvitation() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <FriendInvitationDecision token={token} />;
}

export function FriendInvitationDecision({
  token,
  flowId,
}: {
  token: string;
  flowId?: string;
}) {
  const router = useRouter();
  const eligibility = useSocialEligibility();
  const heldFlow = useRef<string | null>(flowId ?? null);
  const socialReady = socialCoreIsAccessible(eligibility.data);
  const profileReady = socialAppIsAccessible(eligibility.data);
  const preview = useQuery({
    ...orpc.social.friends.invitations.preview.queryOptions({
      input: { token },
    }),
    enabled: Boolean(token),
    retry: false,
  });

  const continueSetup = () => {
    heldFlow.current ??= holdSocialInvitation("friend", token);
    router.replace({
      pathname: socialReady ? "/social/profile" : "/social/setup",
      params: { resume: heldFlow.current },
    });
  };
  const accept = useMutation({
    ...orpc.social.friends.invitations.accept.mutationOptions(),
    onSuccess: async () => {
      discardSocialInvitation(heldFlow.current);
      heldFlow.current = null;
      await queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.queryKey(),
      });
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t("Friend invitation") }} />
      <Screen>
        <PrivacyBoundaryNotice compact />
        {eligibility.isLoading || preview.isLoading ? (
          <Loading />
        ) : preview.isError || !preview.data ? (
          <Empty
            icon="link-outline"
            title={t("This invitation is unavailable")}
            body={t(
              "It may be expired, revoked, already used, blocked or unavailable.",
            )}
          />
        ) : (
          <Section title={t("Invitation from")}>
            <Card style={{ gap: space.lg }}>
              <SocialIdentity
                displayName={preview.data.profile.displayName}
                avatar={preview.data.profile.avatar}
              />
              {profileReady ? (
                <Button
                  label={t("Accept friendship")}
                  disabled={accept.isSuccess}
                  loading={accept.isPending}
                  onPress={() => accept.mutate({ token })}
                />
              ) : (
                <>
                  <Problem>
                    {socialReady
                      ? t(
                          "Activate a friend profile before accepting. The invitation is not consumed.",
                        )
                      : t(
                          "Complete social consent before accepting. The invitation is not consumed.",
                        )}
                  </Problem>
                  <Button
                    label={
                      socialReady
                        ? t("Activate friend profile")
                        : t("Set up social")
                    }
                    onPress={continueSetup}
                  />
                </>
              )}
              <Button
                label={t("Not now")}
                variant="ghost"
                onPress={() => {
                  discardSocialInvitation(heldFlow.current);
                  heldFlow.current = null;
                  router.replace("/social");
                }}
              />
              {accept.isSuccess ? (
                <>
                  <Confirmation>
                    {t(
                      "Friendship accepted. Only explicit profile grants are now visible.",
                    )}
                  </Confirmation>
                  <Button
                    label={t("Open friends")}
                    variant="secondary"
                    onPress={() => router.replace("/social/friends")}
                  />
                </>
              ) : null}
              {accept.isError ? (
                <Problem>{t("The invitation could not be accepted.")}</Problem>
              ) : null}
            </Card>
          </Section>
        )}
      </Screen>
    </>
  );
}
