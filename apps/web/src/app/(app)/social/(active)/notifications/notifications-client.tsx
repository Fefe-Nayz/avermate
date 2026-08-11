"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellIcon, CheckCheckIcon, ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  PrivacyBoundaryNotice,
  SocialPageHeading,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { orpc } from "@/lib/orpc"
import {
  INITIAL_SOCIAL_NOTIFICATIONS_INPUT,
  socialNotificationsInput,
} from "@/lib/social-query-inputs"

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

  function notificationLabel(kind: string) {
    if (kind === "friend_request.received")
      return t("You received a friend request.")
    if (kind === "friend_request.accepted")
      return t("A friend request was accepted.")
    if (kind === "friend_invitation.accepted")
      return t("A private friend invitation was accepted.")
    if (kind === "group.member_joined")
      return t("A member joined a private group.")
    if (kind === "guardian_consent.accepted")
      return t("Guardian approval was recorded.")
    if (kind === "guardian_consent.declined")
      return t("A guardian request was declined.")
    return t("A private social update is available.")
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
        <SocialPageHeading
          title={t("Social updates")}
          description={t(
            "Only allow-listed event descriptions appear here. Notifications never embed grades, account emails or private report text."
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

        <label className="flex items-center justify-end gap-2 text-sm">
          {t("Unread only")}
          <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} />
        </label>

        {notifications.data?.length ? (
          <ul className="space-y-2">
            {notifications.data.map((notification) => (
              <li key={notification.id}>
                <Card
                  className={
                    notification.readAt
                      ? "py-3 opacity-75"
                      : "border-primary/20 py-3"
                  }
                >
                  <CardContent className="flex items-center gap-3 px-4">
                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                      <BellIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={href(
                          notification.entityType,
                          notification.entityId
                        )}
                        className="text-sm font-medium hover:underline"
                        onClick={() => {
                          if (!notification.readAt) {
                            markRead.mutate({ notificationId: notification.id })
                          }
                        }}
                      >
                        {notificationLabel(notification.kind)}
                      </Link>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <ShieldCheckIcon className="size-3" />{" "}
                        {t("Private account update")}
                      </p>
                    </div>
                    {!notification.readAt ? <Badge>{t("New")}</Badge> : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid min-h-52 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
            {t("No social updates.")}
          </div>
        )}

        <PrivacyBoundaryNotice compact />
      </div>
    </>
  )
}
