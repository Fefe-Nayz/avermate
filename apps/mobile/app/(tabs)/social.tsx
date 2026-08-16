import { useState } from "react";
import { Alert, Share, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import { SocialIdentity } from "@/components/social/social-ui";
import { TextField } from "@/components/field";
import {
  Badge,
  Button,
  Card,
  Confirmation,
  Empty,
  Heading,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { env } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, usePalette } from "@/lib/theme";

/**
 * Friends. The list, the requests in both directions, and the two ways to
 * add someone. What each friend actually shares is one tap deeper.
 */
export default function Social() {
  const palette = usePalette();
  const router = useRouter();
  const friends = useQuery(orpc.social.friends.list.queryOptions());
  const requests = useQuery(orpc.social.friends.requests.queryOptions());
  const invitations = useQuery(
    orpc.social.friends.invitations.list.queryOptions(),
  );
  const [handle, setHandle] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.requests.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.invitations.list.queryKey(),
      }),
    ]);

  const send = useMutation({
    ...orpc.social.friends.request.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      setHandle("");
      // The server folds a crossed request into an instant friendship.
      setSent(
        result.status === "accepted"
          ? t("They had already asked — you are now friends.")
          : t("Request sent."),
      );
      await refresh();
    },
  });
  const respond = useMutation({
    ...orpc.social.friends.respond.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      Alert.alert(
        result.status === "accepted"
          ? t("Friend added.")
          : t("Request declined."),
      );
      await refresh();
    },
  });
  const cancel = useMutation({
    ...orpc.social.friends.cancel.mutationOptions(),
    onSuccess: refresh,
  });
  const invite = useMutation({
    ...orpc.social.friends.invitations.create.mutationOptions(),
    onSuccess: async (invitation) => {
      haptic("success");
      await refresh();
      await Share.share({
        message: `${env.webUrl}/social/friends/invitations/${invitation.token}`,
      });
    },
  });
  const revokeInvite = useMutation({
    ...orpc.social.friends.invitations.revoke.mutationOptions(),
    onSuccess: refresh,
  });

  return (
    <>
      <Screen>
        <Heading
          icon="people-outline"
          title={t("Friends")}
          description={t(
            "Each friend sees exactly what your sharing locks allow — nothing more.",
          )}
        />
        <Section
          title={t("Add a friend")}
          description={t("By their handle, or with a link you send them.")}
        >
          <Card style={{ gap: space.md }}>
            <TextField
              label={t("Their handle")}
              value={handle}
              onChangeText={(value) => {
                setHandle(value);
                setSent(null);
              }}
              placeholder={t("their-handle")}
              autoCapitalize="none"
              maxLength={32}
              error={
                send.isError
                  ? t("Nobody with that handle could be reached.")
                  : undefined
              }
            />
            <Button
              label={t("Send request")}
              disabled={!handle.trim()}
              loading={send.isPending}
              onPress={() => {
                setSent(null);
                send.mutate({ handle: handle.trim() });
              }}
            />
            <Button
              label={t("Share an invitation link")}
              variant="secondary"
              icon="link-outline"
              loading={invite.isPending}
              onPress={() => invite.mutate({})}
            />
            {sent ? <Confirmation>{sent}</Confirmation> : null}
            {(invitations.data ?? []).map((invitation) => (
              <Button
                key={invitation.id}
                label={t("Revoke {prefix}…", {
                  prefix: invitation.tokenPrefix,
                })}
                variant="ghost"
                size="sm"
                icon="close"
                disabled={revokeInvite.isPending}
                onPress={() =>
                  revokeInvite.mutate({ invitationId: invitation.id })
                }
              />
            ))}
          </Card>
        </Section>

        {requests.data?.incoming.length ? (
          <Section
            title={t("Requests for you")}
            description={t("Accepting makes sharing mutual by default.")}
          >
            {requests.data.incoming.map((request) => (
              <Card key={request.id} style={{ gap: space.md }}>
                <SocialIdentity
                  name={request.name}
                  handle={request.handle}
                  avatar={request.avatar}
                  secondary={request.message ?? undefined}
                />
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t("Accept")}
                      disabled={respond.isPending}
                      onPress={() =>
                        respond.mutate({ requestId: request.id, accept: true })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t("Decline")}
                      variant="secondary"
                      disabled={respond.isPending}
                      onPress={() =>
                        respond.mutate({ requestId: request.id, accept: false })
                      }
                    />
                  </View>
                </View>
              </Card>
            ))}
          </Section>
        ) : null}

        {requests.data?.outgoing.length ? (
          <Section title={t("Waiting for an answer")}>
            <Card padded={false}>
              {requests.data.outgoing.map((request, index) => (
                <Row
                  key={request.id}
                  first={index === 0}
                  title={request.name || (request.handle ?? "")}
                  subtitle={t("Sent — you can cancel it")}
                  onPress={() =>
                    Alert.alert(t("Cancel this request?"), undefined, [
                      { text: t("Keep waiting"), style: "cancel" },
                      {
                        text: t("Cancel request"),
                        style: "destructive",
                        onPress: () => cancel.mutate({ requestId: request.id }),
                      },
                    ])
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section
          title={t("Your friends")}
          description={t("Open someone to see what they share with you.")}
        >
          {friends.isLoading ? (
            <Loading />
          ) : friends.isError ? (
            <Problem>{t("Friends could not be refreshed.")}</Problem>
          ) : friends.data?.friends.length ? (
            <Card padded={false}>
              {friends.data.friends.map((friend, index) => (
                <Row
                  key={friend.friendshipId}
                  first={index === 0}
                  title={friend.name}
                  trailing={
                    <Badge
                      label={
                        friend.sharesSomething
                          ? t("Shares")
                          : t("Shares nothing")
                      }
                      icon={
                        friend.sharesSomething
                          ? "eye-outline"
                          : "eye-off-outline"
                      }
                      toneColor={
                        friend.sharesSomething ? "positive" : "neutral"
                      }
                    />
                  }
                  onPress={() =>
                    router.push(`/social/friend/${friend.friendshipId}`)
                  }
                />
              ))}
            </Card>
          ) : (
            <Empty
              icon="people-outline"
              title={t("No friends yet")}
              body={t(
                "Send a request to a handle you know, or share an invitation link.",
              )}
            />
          )}
        </Section>

        <Section title={t("Elsewhere")}>
          <Card padded={false}>
            <Row
              first
              title={t("Classes")}
              leading={
                <Icon
                  name="people-circle-outline"
                  size={19}
                  color={palette.textMuted}
                />
              }
              onPress={() => router.push("/social/groups")}
            />
            <Row
              title={t("Sharing")}
              subtitle={t("What your friends may see")}
              leading={
                <Icon
                  name="lock-closed-outline"
                  size={19}
                  color={palette.textMuted}
                />
              }
              onPress={() => router.push("/social/sharing")}
            />
            <Row
              title={t("Updates")}
              leading={
                <Icon
                  name="notifications-outline"
                  size={19}
                  color={palette.textMuted}
                />
              }
              onPress={() => router.push("/social/notifications")}
            />
            <Row
              title={t("Blocked accounts")}
              leading={
                <Icon name="ban-outline" size={19} color={palette.textMuted} />
              }
              onPress={() => router.push("/social/blocks")}
            />
          </Card>
        </Section>
      </Screen>
    </>
  );
}
