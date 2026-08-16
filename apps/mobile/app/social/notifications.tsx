import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import { SwitchField } from "@/components/field";
import {
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
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { usePalette } from "@/lib/theme";

/** What happened while you were away. */
export default function SocialNotifications() {
  const palette = usePalette();
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useQuery(
    orpc.social.notifications.list.queryOptions({
      input: { unreadOnly },
    }),
  );
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.notifications.list.key(),
    });
  const markRead = useMutation({
    ...orpc.social.notifications.markRead.mutationOptions(),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    ...orpc.social.notifications.markAllRead.mutationOptions(),
    onSuccess: refresh,
  });

  function describe(kind: string, params: Record<string, string>) {
    switch (kind) {
      case "friend_request":
        return {
          icon: "person-add-outline" as const,
          label: t("You received a friend request."),
        };
      case "friend_accept":
        return {
          icon: "checkmark-circle-outline" as const,
          label: t("Your friend request was accepted."),
        };
      case "group_joined":
        return {
          icon: "people-circle-outline" as const,
          label: params.groupName
            ? t("Someone joined the class {className}.", {
                className: params.groupName,
              })
            : t("Someone joined your class."),
        };
      case "group_removed":
        return {
          icon: "person-remove-outline" as const,
          label: params.groupName
            ? t("You were removed from the class {className}.", {
                className: params.groupName,
              })
            : t("You were removed from a class."),
        };
      default:
        return {
          icon: "notifications-outline" as const,
          label: t("A social update is available."),
        };
    }
  }

  const unread = notifications.data?.filter((item) => !item.readAt).length ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: t("Updates") }} />
      <Screen>
        <Note>{t("Requests, joins, and moderation outcomes.")}</Note>

        {unread > 0 ? (
          <Button
            label={t("Mark all read")}
            variant="secondary"
            loading={markAll.isPending}
            onPress={() => markAll.mutate({})}
          />
        ) : null}

        <Card>
          <SwitchField
            label={t("Unread only")}
            value={unreadOnly}
            onValueChange={setUnreadOnly}
          />
        </Card>

        <Section title={t("Latest")}>
          {notifications.isLoading ? (
            <Loading />
          ) : notifications.isError ? (
            <Problem>{t("Updates could not be refreshed.")}</Problem>
          ) : notifications.data?.length ? (
            <Card padded={false}>
              {notifications.data.map((item, index) => {
                const { icon, label } = describe(item.kind, item.safeParams);
                const isUnread = !item.readAt;
                return (
                  <Row
                    key={item.id}
                    first={index === 0}
                    title={
                      item.actor?.name ? `${item.actor.name} — ${label}` : label
                    }
                    muted={!isUnread}
                    subtitle={new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.createdAt))}
                    leading={
                      <Icon
                        name={icon}
                        size={18}
                        color={isUnread ? palette.accent : palette.textFaint}
                      />
                    }
                    trailing={
                      isUnread ? (
                        <Button
                          label={t("Mark read")}
                          variant="ghost"
                          size="sm"
                          disabled={markRead.isPending}
                          onPress={() =>
                            markRead.mutate({ notificationId: item.id })
                          }
                        />
                      ) : undefined
                    }
                    onPress={
                      item.entityType === "group" && item.entityId
                        ? () => router.push(`/social/groups/${item.entityId}`)
                        : () => router.push("/social")
                    }
                  />
                );
              })}
            </Card>
          ) : (
            <Empty
              icon="notifications-outline"
              title={unreadOnly ? t("Nothing unread") : t("Nothing yet")}
              body={t("Friend requests and class activity will appear here.")}
            />
          )}
        </Section>
      </Screen>
    </>
  );
}
