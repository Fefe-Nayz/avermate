import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRightIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react"
import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  GroupTypeBadge,
  PrivacyNote,
  SocialEmpty,
  SocialHeading,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { getServerRpc } from "@/lib/orpc/server"

export const metadata: Metadata = {
  title: "Groups & self-declared classes",
  description: "Private, consent-based group comparisons.",
  robots: { index: false, follow: false },
}

/**
 * The groups a person belongs to.
 *
 * A group whose policy changed is the one thing on this page that needs an
 * answer, so those are lifted out of the grid instead of being marked with a
 * badge inside it — a review request three cards down reads as decoration.
 */
export default async function SocialGroupsPage() {
  const t = await getExtracted()
  const result = await getServerRpc().social.groups.list()

  const needsReview = result.groups.filter(
    (group) => group.membershipState === "consent_required"
  )
  const settled = result.groups.filter(
    (group) => group.membershipState !== "consent_required"
  )

  return (
    <>
      <PageMeta title={t("Groups")} backHref="/social" />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={UsersRoundIcon}
          title={t("Groups")}
          description={t(
            "Private groups run on a written policy you accept version by version. Aggregates need a minimum cohort, and named rankings need a separate opt-in."
          )}
          action={
            <Button render={<Link href="/social/groups/new" />}>
              <PlusIcon /> {t("Create group")}
            </Button>
          }
        />

        {needsReview.length ? (
          <SocialSection
            icon={ShieldAlertIcon}
            title={t("Waiting for your review")}
            description={t(
              "Sharing is paused in these groups until you read the new policy and choose again."
            )}
            className="border-caution/40 bg-caution/6"
            bodyClassName="grid gap-3 p-4 @2xl/main:grid-cols-2"
          >
            {needsReview.map((group) => (
              <GroupCard key={group.id} group={group} review />
            ))}
          </SocialSection>
        ) : null}

        {settled.length ? (
          <div className="grid gap-3 @2xl/main:grid-cols-2 @4xl/main:grid-cols-3">
            {settled.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </div>
        ) : null}

        {result.groups.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <SocialEmpty
              title={t("No groups yet")}
              description={t(
                "Create one and write its sharing policy, or open an invitation that explains the policy before you join."
              )}
              action={
                <Button render={<Link href="/social/groups/new" />}>
                  <PlusIcon /> {t("Create a group")}
                </Button>
              }
            />
          </div>
        ) : null}

        <PrivacyNote />
      </div>
    </>
  )
}

async function GroupCard({
  group,
  review = false,
}: {
  group: {
    id: string
    name: string
    description: string
    type: string
    memberCount: number
  }
  review?: boolean
}) {
  const t = await getExtracted()

  return (
    <Link
      href={`/social/groups/${group.id}`}
      className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate font-medium">{group.name}</p>
        <span className="numeric flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <UsersRoundIcon className="size-3.5" aria-hidden />
          {group.memberCount}
        </span>
      </div>

      {group.description ? (
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {group.description}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <GroupTypeBadge type={group.type} />
          {review ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-caution/12 px-2 py-0.5 text-xs font-medium text-caution">
              <ShieldAlertIcon className="size-3" aria-hidden />
              {t("Review needed")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-2 py-0.5 text-xs font-medium text-positive">
              <ShieldCheckIcon className="size-3" aria-hidden />
              {t("Policy accepted")}
            </span>
          )}
        </div>
        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}
