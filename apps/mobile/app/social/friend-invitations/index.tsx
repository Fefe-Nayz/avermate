import { useState } from "react";
import { Share } from "react-native";
import { Stack } from "expo-router";
import * as Linking from "expo-linking";
import { useMutation, useQuery } from "@tanstack/react-query";
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

function inviteStatus(invitation: {
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

export default function FriendInvitations() {
  const invitations = useQuery(
    orpc.social.friends.invitations.list.queryOptions(),
  );
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const create = useMutation({
    ...orpc.social.friends.invitations.create.mutationOptions(),
    gcTime: 0,
    onSuccess: async (created) => {
      setFreshToken(created.token);
      await queryClient.invalidateQueries({
        queryKey: orpc.social.friends.invitations.list.queryKey(),
      });
    },
  });
  const revoke = useMutation({
    ...orpc.social.friends.invitations.revoke.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.invitations.list.queryKey(),
      }),
  });

  const shareFresh = async () => {
    if (!freshToken) return;
    const url = `${Linking.createURL("/social/invitation")}${socialInvitationFragment(
      { kind: "friend", token: freshToken },
    )}`;
    await Share.share({
      title: t("Avermate friend invitation"),
      message: t("Open this private, single-use Avermate invitation: {url}", {
        url,
      }),
      url,
    });
  };

  return (
    <SocialRouteGate>
      <>
        <Stack.Screen options={{ title: t("Private invitations") }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          <Section title={t("Create an invitation")}>
            <Note>
              {t(
                "Each link is single-use and expires after seven days. Share it only with the intended person.",
              )}
            </Note>
            <Button
              label={t("Create private link")}
              loading={create.isPending}
              onPress={() => {
                setFreshToken(null);
                create.mutate({ expiresInDays: 7 });
              }}
            />
            {freshToken ? (
              <>
                <Confirmation>
                  {t(
                    "The link is ready. For safety, this is the only time its secret can be displayed.",
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
              <Problem>
                {t(
                  "Set discovery to Invitation links only in your social profile, then try again.",
                )}
              </Problem>
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
              <Empty
                icon="link-outline"
                title={t("No invitation links")}
                body={t("Create one when an exact handle is not appropriate.")}
              />
            ) : (
              <Card padded={false}>
                {(invitations.data ?? []).map((invitation, index) => {
                  const status = inviteStatus(invitation);
                  const active = status === t("Active");
                  return (
                    <Row
                      key={invitation.id}
                      first={index === 0}
                      title={t("Invitation · {prefix}", {
                        prefix: invitation.tokenPrefix,
                      })}
                      subtitle={status}
                      destructive={active}
                      onPress={
                        active
                          ? () => revoke.mutate({ invitationId: invitation.id })
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
