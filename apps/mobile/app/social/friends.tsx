import { useState } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import {
  SocialRouteGate,
  useSocialEligibility,
} from "@/components/social/social-gate";
import {
  InlineActions,
  PrivacyBoundaryNotice,
  SocialIdentity,
  SocialNavigation,
} from "@/components/social/social-ui";
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
import { socialAppIsAccessible } from "@/components/social/social-model";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

export default function Friends() {
  const router = useRouter();
  const palette = usePalette();
  const eligibility = useSocialEligibility();
  const enabled = socialAppIsAccessible(eligibility.data);
  const friends = useQuery({
    ...orpc.social.friends.list.queryOptions(),
    enabled,
  });
  const requests = useQuery({
    ...orpc.social.friends.requests.queryOptions(),
    enabled,
  });
  const [handle, setHandle] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.friends.requests.queryKey(),
      }),
    ]);
  };

  const send = useMutation({
    ...orpc.social.friends.send.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setHandle("");
      setMessage("");
      setProblem(null);
      setConfirmation(
        t(
          "If that exact handle can receive requests, the invitation is now pending.",
        ),
      );
      await refresh();
    },
    onError: () => {
      haptic("error");
      setProblem(t("The friend request could not be sent. Try again later."));
    },
  });
  const accept = useMutation({
    ...orpc.social.friends.accept.mutationOptions(),
    onSuccess: refresh,
  });
  const decline = useMutation({
    ...orpc.social.friends.decline.mutationOptions(),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    ...orpc.social.friends.cancel.mutationOptions(),
    onSuccess: refresh,
  });
  const blockRequest = useMutation({
    ...orpc.social.blocks.create.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: orpc.social.blocks.list.queryKey(),
        }),
      ]);
    },
    onError: () => setProblem(t("That account could not be blocked.")),
  });

  return (
    <SocialRouteGate>
      <>
        <Stack.Screen options={{ title: t("Friends") }} />
        <Screen>
          <SocialNavigation current="friends" />
          <PrivacyBoundaryNotice compact />

          <Section title={t("Add by exact handle")}>
            <TextField
              label={t("Exact handle")}
              value={handle}
              onChangeText={(value) =>
                setHandle(value.replace(/^@/, "").toLowerCase())
              }
              autoCapitalize="none"
              placeholder="lea.dupont"
            />
            <TextField
              label={t("Message (optional)")}
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder={t(
                "A short context without personal contact details",
              )}
            />
            <Button
              label={t("Send request")}
              disabled={handle.trim().length < 3 || send.isPending}
              loading={send.isPending}
              onPress={() => {
                setProblem(null);
                setConfirmation(null);
                send.mutate({
                  handle: handle.trim(),
                  message: message.trim() ? message.trim() : null,
                });
              }}
            />
            <Note>
              {t(
                "Avermate gives the same response for unknown, blocked and unavailable handles, so this form cannot be used as an account directory.",
              )}
            </Note>
            {confirmation ? <Confirmation>{confirmation}</Confirmation> : null}
            {problem ? <Problem>{problem}</Problem> : null}
            <Button
              label={t("Use a private invitation link instead")}
              variant="ghost"
              onPress={() => router.push("/social/friend-invitations")}
            />
          </Section>

          {requests.isLoading ? <Loading /> : null}
          {requests.isError ? (
            <Section>
              <Problem>
                {t(
                  "Requests could not be refreshed. Cached friends stay visible.",
                )}
              </Problem>
            </Section>
          ) : null}

          {(requests.data?.incoming.length ?? 0) > 0 ? (
            <Section title={t("Requests to you")}>
              {requests.data?.incoming.map((request) => (
                <Card key={request.id} style={{ gap: space.md }}>
                  <SocialIdentity
                    displayName={
                      request.profile?.displayName ?? t("Private account")
                    }
                    avatar={request.profile?.avatar}
                    handle={request.profile?.handle}
                  />
                  {request.message ? (
                    <Text
                      selectable
                      style={[type.body, { color: palette.text }]}
                    >
                      {request.message}
                    </Text>
                  ) : null}
                  <InlineActions>
                    <Button
                      label={t("Accept")}
                      onPress={() => accept.mutate({ requestId: request.id })}
                      disabled={accept.isPending || decline.isPending}
                    />
                    <Button
                      label={t("Decline")}
                      variant="secondary"
                      onPress={() => decline.mutate({ requestId: request.id })}
                      disabled={accept.isPending || decline.isPending}
                    />
                    <Button
                      label={t("Block")}
                      variant="destructive"
                      onPress={() =>
                        blockRequest.mutate({
                          source: "friend_request",
                          sourceId: request.id,
                        })
                      }
                      disabled={blockRequest.isPending}
                    />
                    <Button
                      label={t("Report")}
                      variant="ghost"
                      onPress={() =>
                        router.push({
                          pathname: "/social/report",
                          params: {
                            source: "friend_request",
                            sourceId: request.id,
                          },
                        })
                      }
                    />
                  </InlineActions>
                </Card>
              ))}
            </Section>
          ) : null}

          {(requests.data?.outgoing.length ?? 0) > 0 ? (
            <Section title={t("Sent requests")}>
              <Card padded={false}>
                {requests.data?.outgoing.map((request, index) => (
                  <Row
                    key={request.id}
                    first={index === 0}
                    title={
                      request.profile?.displayName ?? t("Pending invitation")
                    }
                    subtitle={
                      request.profile?.handle
                        ? `@${request.profile.handle}`
                        : t("Waiting for a response")
                    }
                    onPress={() => cancel.mutate({ requestId: request.id })}
                    trailing={
                      <Text
                        style={[type.footnote, { color: palette.negative }]}
                      >
                        {t("Cancel")}
                      </Text>
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
              <Empty
                icon="cloud-offline-outline"
                title={t("Friends could not be refreshed")}
                body={t("Reconnect to verify the latest privacy grants.")}
              />
            ) : (friends.data?.friends.length ?? 0) === 0 ? (
              <Empty
                icon="people-outline"
                title={t("No accepted friends yet")}
                body={t(
                  "Friendships appear here only after mutual acceptance.",
                )}
              />
            ) : (
              <Card padded={false}>
                {friends.data?.friends.map((friend, index) => (
                  <Row
                    key={friend.friendshipId}
                    first={index === 0}
                    title={friend.profile?.displayName ?? t("Private friend")}
                    subtitle={
                      friend.profile?.bio || t("View exact shared profile")
                    }
                    onPress={() =>
                      router.push(`/social/friend/${friend.friendshipId}`)
                    }
                  />
                ))}
              </Card>
            )}
          </Section>

          <Section title={t("Manage")}>
            <Card padded={false}>
              <Row
                first
                title={t("Friend circles")}
                subtitle={t(
                  "Give selected friends different profile permissions",
                )}
                onPress={() => router.push("/social/circles")}
              />
              <Row
                title={t("Blocked accounts")}
                subtitle={t("Requests and discovery stop in both directions")}
                onPress={() => router.push("/social/blocks")}
              />
            </Card>
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
