import { useState } from "react";
import { Alert, Share, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import { SocialIdentity } from "@/components/social/social-ui";
import { TextField } from "@/components/field";
import {
  Badge,
  Button,
  Card,
  Empty,
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
  const [handle, setHandle] = useState("");

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.requests.queryKey(),
      }),
    ]);

  const send = useMutation({
    ...orpc.social.friends.request.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setHandle("");
      await refresh();
    },
  });
  const respond = useMutation({
    ...orpc.social.friends.respond.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
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
      await Share.share({
        message: `${env.webUrl}/social/friends/invitations/${invitation.token}`,
      });
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t("Friends") }} />
      <Screen>
        <Section title={t("Add a friend")}>
          <Card style={{ gap: space.md }}>
            <TextField
              label={t("Their handle")}
              value={handle}
              onChangeText={setHandle}
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
              onPress={() => send.mutate({ handle: handle.trim() })}
            />
            <Button
              label={t("Share an invitation link")}
              variant="secondary"
              icon="link-outline"
              loading={invite.isPending}
              onPress={() => invite.mutate({})}
            />
          </Card>
        </Section>

        {requests.data?.incoming.length ? (
          <Section title={t("Requests for you")}>
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

        <Section title={t("Your friends")}>
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
                          ? t("Shares their figures")
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

        <Note>
          {t(
            "Each friend sees exactly what your sharing locks allow — nothing more.",
          )}
        </Note>
      </Screen>
    </>
  );
}
