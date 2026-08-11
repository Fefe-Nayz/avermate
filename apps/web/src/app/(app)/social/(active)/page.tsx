import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRightIcon,
  BellIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import { ProfilePreview } from "@/components/social/profile-preview"
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
  SocialMetricCard,
  SocialPageHeading,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getServerRpc } from "@/lib/orpc/server"
import { socialAppIsAccessible } from "@/lib/social-access"

export default async function SocialPage() {
  const t = await getExtracted()
  const rpc = getServerRpc()
  const eligibility = await rpc.social.eligibility.get()
  if (!socialAppIsAccessible(eligibility)) redirect("/social/groups")
  const [mine, friends, requests] = await Promise.all([
    rpc.social.profile.mine(),
    rpc.social.friends.list(),
    rpc.social.friends.requests(),
  ])

  const visibleFriends = friends.friends.slice(0, 4)

  return (
    <>
      <PageMeta title={t("Social")} />
      <div className="flex flex-col gap-4">
        <SocialPageHeading
          title={t("Your private social space")}
          description={t(
            "Connect with people you know, compare only what everyone chose to share, and keep school details out of public view."
          )}
          action={
            <Button render={<Link href="/social/friends" />}>
              <UserRoundIcon /> {t("Find friends")}
            </Button>
          }
        />

        <div className="grid grid-cols-2 gap-3 @lg/main:grid-cols-4">
          <SocialMetricCard
            label={t("Friends")}
            value={friends.friends.length}
            description={t("Mutually accepted connections")}
          />
          <SocialMetricCard
            label={t("Requests")}
            value={requests.incoming.length}
            description={t("Waiting for your choice")}
          />
          <SocialMetricCard
            label={t("Shared fields")}
            value={mine.grants.length}
            description={t("Active, explicit permissions")}
            privateValue
          />
          <SocialMetricCard
            label={t("Discovery")}
            value={
              mine.profile?.discovery === "exact_handle"
                ? t("Exact handle")
                : t("Invite only")
            }
            description={t("Never listed on the open web")}
            privateValue
          />
        </div>

        <div className="grid gap-3 @lg/main:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <Card className="py-4">
            <CardHeader className="flex-row items-center justify-between px-4">
              <div>
                <CardTitle className="text-sm">{t("Friends")}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("Each card already applies that person's grants for you.")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                render={<Link href="/social/friends" />}
              >
                {t("Manage")} <ArrowRightIcon />
              </Button>
            </CardHeader>
            <CardContent className="px-4">
              {visibleFriends.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {visibleFriends.map((friend) => (
                    <li
                      key={friend.friendshipId}
                      className="rounded-lg border p-3"
                    >
                      <SocialIdentity
                        displayName={
                          friend.profile?.displayName || t("Private friend")
                        }
                        avatarUrl={friend.profile?.avatar}
                        secondary={t("Only granted fields are shown")}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty className="min-h-44 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <UsersRoundIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t("No friends yet")}</EmptyTitle>
                    <EmptyDescription>
                      {t(
                        "Connect by exact handle or accept a private invitation."
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          {mine.profile ? (
            <ProfilePreview
              profile={{
                displayName: mine.profile.displayName,
                bio: mine.profile.bio,
                educationBand:
                  mine.profile.educationBand === "unknown"
                    ? null
                    : mine.profile.educationBand,
              }}
              audienceLabel={t("Your private source profile")}
            />
          ) : null}
        </div>

        {requests.incoming.length ? (
          <Card className="border-primary/20 py-4">
            <CardHeader className="flex-row items-center justify-between px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BellIcon className="size-4" /> {t("Friend requests")}
                <Badge>{requests.incoming.length}</Badge>
              </CardTitle>
              <Button size="sm" render={<Link href="/social/friends" />}>
                {t("Review requests")}
              </Button>
            </CardHeader>
          </Card>
        ) : null}

        <PrivacyBoundaryNotice />

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-4" aria-hidden />
          {t(
            "Profiles are authenticated-only. Missing, blocked and ineligible accounts receive the same neutral response."
          )}
        </p>
      </div>
    </>
  )
}
