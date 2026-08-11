import { useState } from "react";
import { Share } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import { SocialRouteGate } from "@/components/social/social-gate";
import { PrivacyBoundaryNotice } from "@/components/social/social-ui";
import {
  Button,
  Card,
  Confirmation,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { socialInvitationFragment } from "@/lib/social-invitation-link";

function invitationStatus(invitation: {
  consumedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}) {
  if (invitation.consumedAt) return t("Used");
  if (invitation.revokedAt) return t("Revoked");
  if (new Date(invitation.expiresAt).getTime() <= Date.now())
    return t("Expired");
  return t("Active");
}

export default function GroupInvitations() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [targetEmail, setTargetEmail] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const invitations = useQuery(
    orpc.social.groups.invitations.list.queryOptions({ input: { groupId } }),
  );
  const create = useMutation({
    ...orpc.social.groups.invitations.create.mutationOptions(),
    gcTime: 0,
    onSuccess: async (result) => {
      setFreshToken(result.token);
      setTargetEmail("");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.invitations.list.queryKey({
          input: { groupId },
        }),
      });
    },
  });
  const revoke = useMutation({
    ...orpc.social.groups.invitations.revoke.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.invitations.list.queryKey({
          input: { groupId },
        }),
      }),
  });

  const shareFresh = async () => {
    if (!freshToken) return;
    const url = `${Linking.createURL("/social/invitation")}${socialInvitationFragment(
      { kind: "group", token: freshToken },
    )}`;
    await Share.share({
      title: t("Avermate group invitation"),
      message: t("Review the current group policy before joining: {url}", {
        url,
      }),
      url,
    });
  };

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Group invitations") }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          <Section title={t("Create a single-use link")}>
            <TextField
              label={t("Target email (optional)")}
              value={targetEmail}
              onChangeText={setTargetEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder={t("Restrict this link to one verified account")}
            />
            <Note>
              {t(
                "The invitation is bound to the current policy version. Any policy update invalidates unused old links.",
              )}
            </Note>
            <Button
              label={t("Create invitation")}
              loading={create.isPending}
              onPress={() => {
                setFreshToken(null);
                create.mutate({
                  groupId,
                  targetEmail: targetEmail.trim() ? targetEmail.trim() : null,
                  expiresInDays: 7,
                });
              }}
            />
            {freshToken ? (
              <>
                <Confirmation>
                  {t(
                    "This is the only time the secret invitation link can be displayed.",
                  )}
                </Confirmation>
                <Button
                  label={t("Share now")}
                  variant="secondary"
                  onPress={shareFresh}
                />
              </>
            ) : null}
            {create.isError ? (
              <Problem>{t("The invitation could not be created.")}</Problem>
            ) : null}
          </Section>

          <Section title={t("Invitation history")}>
            {invitations.isLoading ? (
              <Loading />
            ) : invitations.isError ? (
              <Problem>
                {t("Invitation history could not be refreshed.")}
              </Problem>
            ) : (invitations.data?.length ?? 0) === 0 ? (
              <Empty icon="link-outline" title={t("No invitation links")} />
            ) : (
              <Card padded={false}>
                {invitations.data?.map((invitation, index) => {
                  const status = invitationStatus(invitation);
                  const active = status === t("Active");
                  return (
                    <Row
                      key={invitation.id}
                      first={index === 0}
                      title={t("Invitation · {prefix}", {
                        prefix: invitation.tokenPrefix,
                      })}
                      subtitle={`${status} · ${t("Policy {version}", { version: invitation.policyVersion })}${
                        invitation.targeted ? ` · ${t("Email-restricted")}` : ""
                      }`}
                      destructive={active}
                      onPress={
                        active
                          ? () =>
                              revoke.mutate({
                                groupId,
                                invitationId: invitation.id,
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </Card>
            )}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
