import { dehydrate } from "@tanstack/react-query"
import { notFound } from "next/navigation"
import { getServerOrpc } from "@/lib/orpc/server"
import { createQueryClient } from "@/lib/query-client"
import {
  FIXTURE_COMPARISON_ID,
  FIXTURE_GROUP_ID,
  FIXTURE_YEAR_ID,
  fixtureCohort,
  fixtureFriend,
  fixtureSnapshot,
  fixtureYear,
} from "@/components/cards/card-matrix-fixture"
import { DevCardsPage } from "./dev-cards-page"

/**
 * Every card the app can draw, in every arrangement it can be drawn in.
 *
 * Outside the authenticated tree and seeded with a fixture, for two reasons: the
 * page is about layout, and layout should not depend on whose marks are being
 * drawn; and a card bench you have to sign in to reach is a card bench nobody
 * opens. The seeded caches are the ones the year provider reads, so every card
 * below runs the real evaluator over real `Date`s.
 *
 * Development only — `notFound` in production, so this never ships as a route.
 */
export default async function DevCardsRoute() {
  if (process.env.NODE_ENV === "production") notFound()

  const queryClient = createQueryClient()
  const orpc = getServerOrpc()

  // The wire types carry server columns the year provider never reads — `userId`,
  // `createdAt`, `presetId`. The fixture is written as the domain types the
  // provider actually consumes, and this is the one place the two meet, so the
  // narrowing happens here and is visible rather than spread through the fixture.
  const seed = (key: readonly unknown[], value: unknown) => {
    queryClient.setQueryData(
      key as Parameters<typeof queryClient.setQueryData>[0],
      value as never
    )
  }

  seed(orpc.years.list.queryKey(), [fixtureYear])
  seed(
    orpc.snapshot.get.queryKey({ input: { yearId: FIXTURE_YEAR_ID } }),
    fixtureSnapshot()
  )
  /**
   * A class to be compared against.
   *
   * The one fixture on this page that stands in for *other people*, seeded through the
   * same caches the cohort hook reads — so the ranking cards below run the real standing
   * rules over a real six-member group rather than a stub.
   */
  seed(orpc.social.cohorts.list.queryKey(), [
    {
      groupId: FIXTURE_GROUP_ID,
      name: fixtureCohort.name,
      kind: "class",
      comparisons: [
        {
          id: FIXTURE_COMPARISON_ID,
          kind: "general",
          subjectName: null,
        },
      ],
    },
  ])
  seed(
    orpc.social.cohorts.get.queryKey({ input: { groupId: FIXTURE_GROUP_ID } }),
    {
      groupId: FIXTURE_GROUP_ID,
      name: fixtureCohort.name,
      enabled: true,
      memberCount: fixtureCohort.memberCount,
      scale: 20,
      decimals: 2,
      comparisons: [
        {
          id: FIXTURE_COMPARISON_ID,
          kind: "general",
          subjectName: null,
          members: fixtureCohort.members,
        },
      ],
      viewerUserId: fixtureCohort.viewerUserId,
      viewerShares: true,
    }
  )

  // A friend, with all three locks open — the other half of "somebody else" on this page.
  seed(orpc.social.cohorts.friends.queryKey(), [fixtureFriend])

  return <DevCardsPage dehydratedState={dehydrate(queryClient)} />
}
