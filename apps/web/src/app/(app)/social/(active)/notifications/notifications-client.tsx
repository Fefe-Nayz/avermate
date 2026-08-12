"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BellIcon,
  CheckCheckIcon,
  UserRoundCheckIcon,
  UserRoundPlusIcon,
  UserXIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  SocialEmpty,
  SocialHeading,
  SocialList,
  SocialRow,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"

/**
 * What happened while you were away. The icon says which kind of thing
 * happened; unread items carry the accent.
 */
export function NotificationsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const notifications = useQuery(
    orpc.social.notifications.list.queryOptions({ input: { unreadOnly } })
  )
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.notifications.list.key(),
    })
  const markRead = useMutation({
    ...orpc.social.notifications.markRead.mutationOptions(),
    onSuccess: refresh,
  })
  const markAll = useMutation({
    ...orpc.social.notifications.markAllRead.mutationOptions(),
    onSuccess: refresh,
  })

  function describe(kind: string, params: Record<string, string>) {
    switch (kind) {
      case "friend_request":
        return {
          icon: UserRoundPlusIcon,
          label: t("You received a friend request."),
        }
      case "friend_accept":
        return {
          icon: UserRoundCheckIcon,
          label: t("Your friend request was accepted."),
        }
      case "group_joined":
        return {
          icon: UsersRoundIcon,
          label: params.groupName
            ? t("Someone joined {groupName}.", { groupName: params.groupName })
            : t("Someone joined your group."),
        }
      case "group_removed":
        return {
          icon: UserXIcon,
          label: params.groupName
            ? t("You were removed from {groupName}.", {
                groupName: params.groupName,
              })
            : t("You were removed from a group."),
        }
      default:
        return { icon: BellIcon, label: t("A social update is available.") }
    }
  }

  function href(entityType: string, entityId: string | null) {
    if (entityType === "group" && entityId) return `/social/groups/${entityId}`
    return "/social"
  }

  const unread = notifications.data?.filter((item) => !item.readAt).length ?? 0

  return (
    <>
      <PageMeta title={t("Updates")} backHref="/social" />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={BellIcon}
          title={t("Updates")}
          description={t("Requests, joins, and moderation outcomes.")}
          action={
            unread > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate({})}
              >
                <CheckCheckIcon /> {t("Mark all read")}
              </Button>
            ) : undefined
          }
        />

        <label className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          {t("Unread only")}
          <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} />
        </label>

        {notifications.data?.length ? (
          <SocialList>
            {notifications.data.map((item) => {
              const { icon: IconComponent, label } = describe(
                item.kind,
                item.safeParams
              )
              const isUnread = !item.readAt
              return (
                <SocialRow
                  key={item.id}
                  href={href(item.entityType, item.entityId)}
                  leading={
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full",
                        isUnread
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <IconComponent className="size-4" aria-hidden />
                    </span>
                  }
                  trailing={
                    isUnread ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={markRead.isPending}
                        onClick={(event) => {
                          event.preventDefault()
                          markRead.mutate({ notificationId: item.id })
                        }}
                      >
                        {t("Mark read")}
                      </Button>
                    ) : undefined
                  }
                >
                  <p
                    className={cn(
                      "truncate text-sm",
                      isUnread ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {item.actor?.name ? `${item.actor.name} — ${label}` : label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.createdAt))}
                  </p>
                </SocialRow>
              )
            })}
          </SocialList>
        ) : (
          <SocialEmpty
            icon={BellIcon}
            title={unreadOnly ? t("Nothing unread") : t("Nothing yet")}
            description={t(
              "Friend requests and group activity will appear here."
            )}
          />
        )}
      </div>
    </>
  )
}
