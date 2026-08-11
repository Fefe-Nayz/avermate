import Link from "next/link"
import { redirect } from "next/navigation"
import {
  BellIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  PrivacyNote,
  SharingState,
  SocialDestination,
  SocialEmpty,
  SocialHeading,
  SocialIdentity,
  SocialList,
  SocialRow,
  SocialSection,
  SocialStat,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { getServerRpc } from "@/lib/orpc/server"
import { socialAppIsAccessible } from "@/lib/social-access"

/**
 * The way into social.
 *
 * Four numbers, the people, and the places to go. The previous version led
 * with a metric grid that mixed a count of friends with the word "Invite
 * only", so a card that looked like a measurement was really a setting —
 * discovery is a choice you make, not a quantity, and it now reads as one.
 */
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

  const visibleFriends = friends.friends.slice(0, 5)
  const inviteOnly = mine.profile?.discovery !== "exact_handle"

  return (
    <>
      <PageMeta title={t("Social")} />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={UsersRoundIcon}
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

        {requests.incoming.length ? (
          <SocialSection
            icon={BellIcon}
            title={t("Friend requests")}
            description={t("Waiting for your choice.")}
            action={
              <Button size="sm" render={<Link href="/social/friends" />}>
                {t("Review")}
              </Button>
            }
          >
            <p className="text-sm text-muted-foreground">
              {requests.incoming.length === 1
                ? t("One person is waiting for an answer.")
                : t("{count} people are waiting for an answer.", {
                    count: String(requests.incoming.length),
                  })}
            </p>
          </SocialSection>
        ) : null}

        <div className="grid grid-cols-2 gap-3 @lg/main:grid-cols-3">
          <SocialStat
            icon={UsersRoundIcon}
            label={t("Friends")}
            value={friends.friends.length}
            hint={t("Mutually accepted")}
          />
          <SocialStat
            icon={BellIcon}
            label={t("Requests")}
            value={requests.incoming.length}
            hint={t("Waiting for you")}
          />
          <SocialStat
            icon={SlidersHorizontalIcon}
            label={t("Shared fields")}
            value={mine.grants.length}
            hint={t("Explicit permissions")}
          />
        </div>

        <SocialSection
          icon={UsersRoundIcon}
          title={t("Friends")}
          description={t("Each row already applies that person's grants.")}
          action={
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/social/friends" />}
            >
              {t("Manage")}
            </Button>
          }
        >
          {visibleFriends.length ? (
            <SocialList>
              {visibleFriends.map((friend) => (
                <SocialRow key={friend.friendshipId}>
                  <SocialIdentity
                    displayName={
                      friend.profile?.displayName || t("Private friend")
                    }
                    avatarUrl={friend.profile?.avatar}
                    secondary={t("Only granted fields are shown")}
                  />
                </SocialRow>
              ))}
            </SocialList>
          ) : (
            <SocialEmpty
              title={t("No friends yet")}
              description={t(
                "Connect by exact handle or accept a private invitation."
              )}
              action={
                <Button size="sm" render={<Link href="/social/friends" />}>
                  {t("Find friends")}
                </Button>
              }
            />
          )}
        </SocialSection>

        <div className="grid gap-3 @lg/main:grid-cols-2">
          <SocialDestination
            href="/social/groups"
            icon={UsersRoundIcon}
            title={t("Groups")}
            description={t(
              "Invite-only classes and study groups, each with its own agreed policy."
            )}
          />
          <SocialDestination
            href="/social/profile"
            icon={SlidersHorizontalIcon}
            title={t("Profile and sharing")}
            description={t(
              "Decide what each audience receives. Nothing is shared until you grant it."
            )}
            badge={mine.grants.length}
          />
        </div>

        <SocialSection
          icon={UserRoundIcon}
          title={t("How you are found")}
          description={t("Never listed on the open web, whichever you choose.")}
          action={
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/social/profile" />}
            >
              {t("Change")}
            </Button>
          }
        >
          <SocialRow
            trailing={
              <SharingState
                granted={!inviteOnly}
                label={inviteOnly ? t("Invite only") : t("Exact handle")}
              />
            }
          >
            <p className="text-sm">
              {inviteOnly
                ? t("Only people you invite can reach your profile.")
                : t("Someone typing your exact handle can send a request.")}
            </p>
          </SocialRow>
          <PrivacyNote />
        </SocialSection>
      </div>
    </>
  )
}
