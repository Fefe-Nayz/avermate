"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CrownIcon,
  PlusIcon,
  SchoolIcon,
  SnowflakeIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import {
  SocialEmpty,
  SocialHeading,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"

/** Classes share one academic structure; friendships remain person-to-person. */
export function GroupsClient() {
  const t = useExtracted()
  const groups = useQuery(orpc.social.groups.list.queryOptions())

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={SchoolIcon}
        title={t("Classes")}
        description={t(
          "Follow a class using the same subjects, periods and grading scale. Friend sharing remains separate."
        )}
        action={
          <Button type="button" render={<Link href="/social/groups/new" />}>
            <PlusIcon /> {t("New class")}
          </Button>
        }
      />

      <SocialSection icon={SchoolIcon} title={t("Your classes")}>
        {groups.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : groups.data?.length ? (
          <SocialList>
            {groups.data.map((group) => (
              <SocialRow
                key={group.id}
                href={`/social/groups/${group.id}`}
                trailing={
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {group.state === "frozen" ? (
                      <Badge variant="outline" className="gap-1">
                        <SnowflakeIcon className="size-3" aria-hidden />
                        {t("On hold")}
                      </Badge>
                    ) : null}
                    {group.role === "owner" ? (
                      <Badge variant="secondary" className="gap-1">
                        <CrownIcon className="size-3" aria-hidden />
                        {t("Owner")}
                      </Badge>
                    ) : null}
                    {group.yearStatus === "connected" ? (
                      <Badge variant="outline" className="gap-1">
                        <CircleCheckIcon className="size-3" aria-hidden />
                        {group.linkedYearName ?? t("Year connected")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <CircleAlertIcon className="size-3" aria-hidden />
                        {group.setupRequired
                          ? t("Model needed")
                          : group.yearStatus === "incompatible"
                            ? t("Incompatible year")
                            : t("Choose a year")}
                      </Badge>
                    )}
                  </div>
                }
              >
                <p className="text-sm font-medium">{group.name}</p>
                <p className="text-xs text-muted-foreground">
                  {group.memberCount === 1
                    ? t("1 member")
                    : t("{count} members", {
                        count: String(group.memberCount),
                      })}
                  {group.description ? ` · ${group.description}` : ""}
                </p>
              </SocialRow>
            ))}
          </SocialList>
        ) : (
          <SocialEmpty
            compact
            icon={SchoolIcon}
            title={t("No classes yet")}
            description={t(
              "Create a class from an existing year or a new model, or open an invitation from a classmate."
            )}
          />
        )}
      </SocialSection>
    </div>
  )
}
