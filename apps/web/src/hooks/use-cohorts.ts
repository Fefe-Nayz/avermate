"use client"

import { useMemo } from "react"
import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query"
import type {
  CohortContext,
  FriendContext,
  TemplateFriendRequirement,
} from "@avermate/core"
import { orpc } from "@/lib/orpc"

export interface CohortListGroup {
  groupId: string
  name: string
  comparisons: ReadonlyArray<{
    id: string
    subjectName: string | null
  }>
}

export interface CohortChoice {
  /** The id stored by a card and used as the evaluator's lookup key. */
  comparisonId: string
  /** The id accepted by the figures endpoint. */
  groupId: string
  name: string
}

export interface CohortMemberChoice {
  value: string
  label: string
}

export interface FriendChoice {
  value: string
  label: string
}

/** Picker rows need the cheap list, not every member's shared academic year. */
export function cohortChoices(
  groups: readonly CohortListGroup[]
): CohortChoice[] {
  return groups.flatMap((group) =>
    group.comparisons.map((comparison) => ({
      comparisonId: comparison.id,
      groupId: group.groupId,
      name:
        comparison.subjectName === null
          ? group.name
          : `${group.name} · ${comparison.subjectName}`,
    }))
  )
}

/** Resolve stored comparison ids back to the minimum set of endpoint group ids. */
export function cohortFigureGroupIds(
  groups: readonly CohortListGroup[],
  comparisonIds: readonly string[],
  loadAll: boolean
): string[] {
  if (loadAll) return groups.map((group) => group.groupId)
  const requested = new Set(comparisonIds)
  return groups
    .filter((group) =>
      group.comparisons.some((comparison) => requested.has(comparison.id))
    )
    .map((group) => group.groupId)
}

/** Members offered for one comparison, never pooled across unrelated classes. */
export function cohortMemberChoices(
  cohorts: ReadonlyMap<string, CohortContext>,
  comparisonId: string
): CohortMemberChoice[] {
  const cohort = cohorts.get(comparisonId)
  if (!cohort) return []

  const seen = new Set<string>()
  return cohort.members.flatMap((member) => {
    if (seen.has(member.userId)) return []
    seen.add(member.userId)
    return [{ value: member.userId, label: member.name }]
  })
}

/**
 * Invalidate precisely the cohort views changed by the owner switch: the cheap picker
 * list and the figures for this group. Group detail/list invalidation remains with the
 * screen because those queries belong to a separate social surface.
 */
export async function invalidateCohortQueriesForGroup(
  queryClient: QueryClient,
  groupId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.social.cohorts.list.key(),
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.social.cohorts.get.key({ input: { groupId } }),
      exact: true,
    }),
  ])
}

export interface UseCohortsOptions {
  enabled?: boolean
  /** Comparison ids stored in the definitions currently being evaluated. */
  comparisonIds?: readonly string[]
  /** Reserved for a picker that genuinely has to offer members from every class. */
  loadAllFigures?: boolean
}

/**
 * The groups this reader may be compared against, ready for a card to read.
 *
 * Fetched at render rather than stored: a card's document names a group and nothing else,
 * so a member who turns their sharing off disappears from every card that was comparing
 * against them at the next refetch. A definition that carried the figures would keep them.
 *
 * Two queries deep on purpose. The list is cheap and says *which* groups are open to
 * cards; the figures are a per-group load — every member's shared year — so they are
 * fetched per group and cached per group, and a dashboard with one class card does not
 * pay for a reader's other classes.
 */
export function useCohorts(options?: UseCohortsOptions): {
  cohorts: ReadonlyMap<string, CohortContext>
  /** Comparisons a picker may offer, derived entirely from the cheap list response. */
  choices: CohortChoice[]
  loading: boolean
} {
  // Fetched only for a card that names a class. A dashboard of ordinary averages asked
  // for everybody's classes and then every class's figures — one request per group, per
  // card — to answer a question no card had asked.
  const enabled = options?.enabled ?? true
  const list = useQuery({
    ...orpc.social.cohorts.list.queryOptions(),
    // Other people's figures; a shorter life than the reader's own data, so a withdrawn
    // consent stops being shown within a session rather than at the next reload.
    staleTime: 60_000,
    enabled,
  })

  const choices = useMemo(() => cohortChoices(list.data ?? []), [list.data])

  const figureGroupIds = useMemo(
    () =>
      enabled
        ? cohortFigureGroupIds(
            list.data ?? [],
            options?.comparisonIds ?? [],
            options?.loadAllFigures ?? false
          )
        : [],
    [enabled, list.data, options?.comparisonIds, options?.loadAllFigures]
  )

  const figures = useQueries({
    queries: figureGroupIds.map((groupId) => ({
      ...orpc.social.cohorts.get.queryOptions({
        input: { groupId },
      }),
      staleTime: 60_000,
    })),
  })

  const cohorts = useMemo(() => {
    const map = new Map<string, CohortContext>()
    for (const query of figures) {
      const data = query.data
      if (!data || !data.enabled) continue
      /**
       * One cohort per *comparison*, keyed by the comparison's own id.
       *
       * A group compares several things — the general average, a subject, the pass rate —
       * and a card names one of them. Keying by group alone would make "Maths in Terminale
       * 2" unsayable, and keying by group would silently answer with whichever comparison
       * happened to be first.
       */
      for (const comparison of data.comparisons) {
        map.set(comparison.id, {
          groupId: comparison.id,
          name:
            comparison.subjectName === null
              ? data.name
              : `${data.name} · ${comparison.subjectName}`,
          memberCount: data.memberCount,
          members: comparison.members,
          viewerUserId: data.viewerUserId,
        })
      }
    }
    return map
  }, [figures])

  return {
    cohorts,
    choices,
    loading:
      enabled && (list.isLoading || figures.some((query) => query.isLoading)),
  }
}

/**
 * The friends who share something, ready for a card to read.
 *
 * One query rather than the cohorts' two: a friend's shared figures are a few numbers,
 * and there is no per-group load to defer. Same rule about storage, though — a card names
 * a friend, the numbers arrive here, and a friend who closes a lock drops out of the map
 * at the next fetch.
 */
export function useFriends(options?: { enabled?: boolean }): {
  friends: ReadonlyMap<string, FriendContext>
  /** Those a picker may offer, in the order the server listed them. */
  people: Array<{ userId: string; name: string }>
  loading: boolean
} {
  const query = useQuery({
    ...orpc.social.cohorts.friends.queryOptions(),
    // Other people's figures, so a short life: a lock closed today should stop being
    // shown within the session rather than at the next reload.
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  })

  const friends = useMemo(() => {
    const map = new Map<string, FriendContext>()
    for (const friend of query.data ?? []) {
      map.set(friend.userId, {
        userId: friend.userId,
        name: friend.name,
        scale: friend.scale,
        generalAverage: friend.generalAverage,
        // A subject a friend has never been graded in is not a comparison — the friend
        // screen shows it as "no marks yet", and a card row of "— against —" is noise.
        subjects: friend.subjects.flatMap((subject) =>
          subject.average === null
            ? []
            : [
                {
                  name: subject.name,
                  average: subject.average,
                  gradeCount: subject.gradeCount,
                },
              ]
        ),
        // The wire carries dates as strings once it has been through a cache; the
        // evaluator plots `Date`s, and this is the one place the two meet.
        history:
          friend.history?.map((point) => ({
            at: new Date(point.at),
            ratio: point.ratio,
          })) ?? null,
      })
    }
    return map
  }, [query.data])

  return {
    friends,
    people: (query.data ?? []).map((friend) => ({
      userId: friend.userId,
      name: friend.name,
    })),
    loading: (options?.enabled ?? true) && query.isLoading,
  }
}

/** Offer only friends whose currently shared payload can evaluate this exact metric. */
export function friendChoices(
  friends: ReadonlyMap<string, FriendContext>,
  requirement?: TemplateFriendRequirement
): FriendChoice[] {
  return [...friends.values()].flatMap((friend) => {
    const readable =
      requirement === "generalAverage"
        ? friend.generalAverage !== null
        : requirement === "history"
          ? (friend.history?.length ?? 0) > 0
          : requirement === "subjects"
            ? friend.subjects.length > 0
            : true

    return readable ? [{ value: friend.userId, label: friend.name }] : []
  })
}
