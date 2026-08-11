import { useRef, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import { GroupPolicySummary } from "@/components/social/group-policy-ui";
import { groupTypeLabel } from "@/components/social/social-copy";
import { useSocialEligibility } from "@/components/social/social-gate";
import { socialCoreIsAccessible } from "@/components/social/social-model";
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
  Note,
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

export default function AcceptGroupInvitation() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <GroupInvitationDecision token={token} />;
}

export function GroupInvitationDecision({
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
  const [alias, setAlias] = useState("");
  const preview = useQuery({
    ...orpc.social.groups.invitations.preview.queryOptions({
      input: { token },
    }),
    enabled: Boolean(token),
    retry: false,
  });
  const accept = useMutation({
    ...orpc.social.groups.invitations.accept.mutationOptions(),
    onSuccess: async (result) => {
      discardSocialInvitation(heldFlow.current);
      heldFlow.current = null;
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.replace(`/social/groups/${result.groupId}`);
    },
  });
  const decline = useMutation({
    ...orpc.social.groups.invitations.decline.mutationOptions(),
    onSuccess: () => {
      discardSocialInvitation(heldFlow.current);
      heldFlow.current = null;
      router.replace("/social/groups");
    },
  });

  const continueSetup = () => {
    heldFlow.current ??= holdSocialInvitation("group", token);
    router.replace({
      pathname: "/social/setup",
      params: { resume: heldFlow.current },
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Group invitation") }} />
      <Screen>
        <PrivacyBoundaryNotice compact />
        {eligibility.isLoading || preview.isLoading ? (
          <Loading />
        ) : preview.isError || !preview.data ? (
          <Empty
            icon="link-outline"
            title={t("This invitation is unavailable")}
            body={t(
              "It may be expired, used, revoked, blocked or tied to an older policy.",
            )}
          />
        ) : (
          <>
            <Section title={t("You were invited to")}>
              <Card style={{ gap: space.md }}>
                <SocialIdentity
                  displayName={preview.data.group.name}
                  secondary={groupTypeLabel(preview.data.group.type)}
                />
                {preview.data.group.description ? (
                  <Note>{preview.data.group.description}</Note>
                ) : null}
                <Note>
                  {t("Created by {alias}{selfDeclared}", {
                    alias: preview.data.ownerAlias,
                    selfDeclared: preview.data.ownerIsSelfDeclared
                      ? ` · ${t("self-declared identity")}`
                      : "",
                  })}
                </Note>
              </Card>
            </Section>
            <GroupPolicySummary policy={preview.data.policy} />
            <Section title={t("Join without sharing yet")}>
              <TextField
                label={t("Your group alias")}
                value={alias}
                onChangeText={setAlias}
                maxLength={60}
                placeholder={t("A name group members will see")}
              />
              <Note>
                {t(
                  "Accepting this invitation creates a pending membership only. You choose metrics and school year on the next screen.",
                )}
              </Note>
              {socialReady ? (
                <>
                  <Button
                    label={t("Continue to consent choices")}
                    disabled={!alias.trim() || accept.isPending}
                    loading={accept.isPending}
                    onPress={() =>
                      accept.mutate({ token, alias: alias.trim() })
                    }
                  />
                  <Button
                    label={t("Decline invitation")}
                    variant="ghost"
                    loading={decline.isPending}
                    onPress={() => decline.mutate({ token })}
                  />
                </>
              ) : (
                <>
                  <Problem>
                    {t(
                      "Complete social consent before joining. The invitation is not consumed and no group data is shared.",
                    )}
                  </Problem>
                  <Button label={t("Set up social")} onPress={continueSetup} />
                </>
              )}
              {accept.isError || decline.isError ? (
                <Problem>
                  {t("The invitation decision could not be saved.")}
                </Problem>
              ) : null}
              <Button
                label={t("Not now")}
                variant="ghost"
                onPress={() => {
                  discardSocialInvitation(heldFlow.current);
                  heldFlow.current = null;
                  router.replace("/social");
                }}
              />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
