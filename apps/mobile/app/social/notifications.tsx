import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SocialRouteGate } from "@/components/social/social-gate";
import { SocialNavigation } from "@/components/social/social-ui";
import {
  Button,
  Card,
  Empty,
  Loading,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { radius, usePalette } from "@/lib/theme";

function notificationLabel(kind: string): string {
  if (kind === "friend_request.received") return t("New friend request");
  if (kind === "friend_request.accepted") return t("Friend request accepted");
  if (kind === "friend_invitation.accepted")
    return t("Private invitation accepted");
  if (kind === "group.member_joined") return t("A member joined your group");
  if (kind === "group.policy_changed")
    return t("A group sharing policy changed");
  if (kind === "guardian_consent.accepted")
    return t("Guardian consent accepted");
  if (kind === "guardian_consent.declined")
    return t("Guardian consent declined");
  if (kind === "moderation.account_frozen")
    return t("Social access paused by moderation");
  return t("Social update");
}

export default function SocialNotifications() {
  const router = useRouter();
  const palette = usePalette();
  const input = { unreadOnly: false, limit: 50, offset: 0 } as const;
  const notifications = useQuery(
    orpc.social.notifications.list.queryOptions({ input }),
  );
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.notifications.list.queryKey({ input }),
    });
  const read = useMutation({
    ...orpc.social.notifications.markRead.mutationOptions(),
    onSuccess: refresh,
  });
  const readAll = useMutation({
    ...orpc.social.notifications.markAllRead.mutationOptions(),
    onSuccess: refresh,
  });

  const open = (notification: {
    id: string;
    readAt: Date | null;
    entityType: string;
    entityId: string | null;
  }) => {
    if (!notification.readAt) read.mutate({ notificationId: notification.id });
    if (notification.entityType === "group" && notification.entityId) {
      router.push(`/social/groups/${notification.entityId}`);
    } else if (notification.entityType === "friend_request") {
      router.push("/social/friends");
    } else {
      router.push("/social/setup");
    }
  };

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Social notifications") }} />
        <Screen>
          <SocialNavigation current="updates" />
          <Section
            title={t("Latest updates")}
            action={
              (notifications.data?.some((item) => !item.readAt) ?? false) ? (
                <Button
                  label={t("Mark all read")}
                  variant="ghost"
                  disabled={readAll.isPending}
                  onPress={() => readAll.mutate(undefined)}
                />
              ) : undefined
            }
          >
            {notifications.isLoading ? (
              <Loading />
            ) : notifications.isError ? (
              <Problem>{t("Notifications could not be refreshed.")}</Problem>
            ) : (notifications.data?.length ?? 0) === 0 ? (
              <Empty
                icon="notifications-outline"
                title={t("No social updates")}
                body={t(
                  "Friend, group, consent and moderation changes appear here.",
                )}
              />
            ) : (
              <Card padded={false}>
                {notifications.data?.map((notification, index) => (
                  <Row
                    key={notification.id}
                    first={index === 0}
                    title={notificationLabel(notification.kind)}
                    subtitle={new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(notification.createdAt))}
                    leading={
                      <View
                        accessibilityLabel={
                          notification.readAt ? t("Read") : t("Unread")
                        }
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: radius.pill,
                          backgroundColor: notification.readAt
                            ? palette.border
                            : palette.accent,
                        }}
                      />
                    }
                    onPress={() => open(notification)}
                  />
                ))}
              </Card>
            )}
          </Section>
          <Section title={t("Your safety reports")}>
            <Button
              label={t("View submitted reports")}
              variant="secondary"
              onPress={() => router.push("/social/reports")}
            />
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
