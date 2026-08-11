"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BellIcon,
  CheckCheckIcon,
  LinkIcon,
  UserRoundCheckIcon,
  UserRoundPlusIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  PrivacyNote,
  SocialEmpty,
  SocialHeading,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"
import {
  INITIAL_SOCIAL_NOTIFICATIONS_INPUT,
  socialNotificationsInput,
} from "@/lib/social-query-inputs"

/**
 * What happened while you were away.
 *
 * Every update used to arrive as the same bell in the same grey circle, so a
 * guardian decision looked exactly like a group join. The icon now says which
 * kind of thing happened, and unread items carry the accent — the only
 * distinction the old list drew was a border almost nobody would notice.
 */
export function NotificationsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const notifications = useQuery(
    orpc.social.notifications.list.queryOptions({
      input: unreadOnly
        ? socialNotificationsInput(true)
        : INITIAL_SOCIAL_NOTIFICATIONS_INPUT,
    })
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

  function describe(kind: string) {
    switch (kind) {
      case "friend_request.received":
        return {
          icon: UserRoundPlusIcon,
          label: t("You received a friend request."),
        }
      case "friend_request.accepted":
        return {
          icon: UserRoundCheckIcon,
          label: t("A friend request was accepted."),
        }
      case "friend_invitation.accepted":
        return {
          icon: LinkIcon,
          label: t("A private friend invitation was accepted."),
        }
      case "group.member_joined":
        return {
          icon: UsersRoundIcon,
          label: t("A member joined a private group."),
        }
      case "guardian_consent.accepted":
        return {
          icon: UserRoundCheckIcon,
          label: t("Guardian approval was recorded."),
        }
      case "guardian_consent.declined":
        return {
          icon: UserRoundCheckIcon,
          label: t("A guardian request was declined."),
        }
      default:
        return {
          icon: BellIcon,
          label: t("A private social update is available."),
        }
    }
  }

  function href(entityType: string, entityId: string | null) {
    if (entityType === "group" && entityId) return `/social/groups/${entityId}`
    if (entityType === "guardian_consent") return "/settings/social"
    return "/social/friends"
  }

  const unread = notifications.data?.filter((item) => !item.readAt).length ?? 0

  return (
    <>
      <PageMeta title={t("Social updates")} backHref="/social" />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={BellIcon}
          title={t("Updates")}
          description={t(
            "Only allow-listed event descriptions appear here. An update never embeds a grade, an account email or private report text."
          )}
          action={
            unread ? (
              <Button
                variant="outline"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate(undefined)}
              >
                <CheckCheckIcon /> {t("Mark all read")}
              </Button>
            ) : undefined
          }
        />

        <SocialSection
          icon={BellIcon}
          title={
            unread
              ? t("{count} unread", { count: String(unread) })
              : t("All caught up")
          }
          action={
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("Unread only")}
              <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} />
            </label>
          }
          bodyClassName={
            notifications.data?.length ? "p-0 px-4 py-1" : undefined
          }
        >
          {notifications.data?.length ? (
            <SocialList>
              {notifications.data.map((notification) => {
                const { icon: Icon, label } = describe(notification.kind)
                const unreadItem = !notification.readAt
                return (
                  <SocialRow key={notification.id}>
                    <Link
                      href={href(
                        notification.entityType,
                        notification.entityId
                      )}
                      className="flex items-center gap-3"
                      onClick={() => {
                        if (unreadItem) {
                          markRead.mutate({ notificationId: notification.id })
                        }
                      }}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full",
                          unreadItem
                            ? "bg-primary/12 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm",
                            unreadItem
                              ? "font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          {label}
                        </span>
                      </span>
                      {unreadItem ? (
                        <span
                          className="size-2 shrink-0 rounded-full bg-primary"
                          aria-label={t("Unread")}
                        />
                      ) : null}
                    </Link>
                  </SocialRow>
                )
              })}
            </SocialList>
          ) : (
            <SocialEmpty
              icon={BellIcon}
              title={
                unreadOnly ? t("Nothing unread") : t("No social updates yet")
              }
              description={t(
                "Friend requests, accepted invitations and guardian decisions land here."
              )}
            />
          )}
        </SocialSection>

        <PrivacyNote />
      </div>
    </>
  )
}
