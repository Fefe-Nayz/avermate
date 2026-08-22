import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db";
import {
  groupComparisons,
  groupMemberships,
  socialGroups,
} from "../../db/schema/social";
import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../../lib/orpc";
import {
  classYearStatuses,
  parseClassTemplate,
} from "../../lib/class-template";
import { friendships } from "../../db/schema/social";
import {
  assertActiveGroup,
  groupAccess,
  groupFigures,
  identities,
  identity,
  sharedAcademics,
} from "./shared";

/**
 * A group, read as something a member can put on their own dashboard.
 *
 * The board and the cohort are the same numbers and two different surfaces. A board is
 * looked at together, on purpose, in the group's own screen; a cohort follows a member
 * around their own dashboard. So the owner turns it on separately — `cohortEnabled` —
 * rather than getting it for free the moment a comparison exists.
 *
 * Nothing here loosens a consent. A member's figure travels only when their own
 * `shareAverage` is on and their year is connected, which is the same gate the board
 * passes through; the cohort switch only decides whether the *group* may be read this
 * way at all. And a member who shares nothing has no figure of their own, so they get no
 * rank either — not a rule imposed here, just what a ranking of a list you are not in
 * comes to.
 *
 * Derived readings — rank, percentile, the gap to the group — are computed in
 * `@avermate/core` from what this returns, so the web and any other client agree about
 * ties and about the sample below which a rank says nothing.
 */

/** What one member contributes to a comparison. */
export interface CohortMemberFigure {
  userId: string;
  name: string;
  average: number;
}

export const cohortsRouter = {
  /**
   * The groups the caller may read as a cohort.
   *
   * Enough to fill a picker and no numbers at all: a card stores *which* group, and the
   * figures are fetched when it is drawn. A definition that carried averages would be a
   * definition that kept them after a consent was withdrawn.
   */
  list: protectedProcedure.handler(async ({ context }) => {
    const rows = await db
      .select({
        id: socialGroups.id,
        name: socialGroups.name,
        kind: socialGroups.kind,
        state: socialGroups.state,
        cohortEnabled: socialGroups.cohortEnabled,
      })
      .from(socialGroups)
      .innerJoin(
        groupMemberships,
        eq(groupMemberships.groupId, socialGroups.id),
      )
      .where(eq(groupMemberships.userId, context.session.user.id));

    const usable = rows.filter(
      (row) => row.cohortEnabled && row.state === "active",
    );
    const comparisons = await Promise.all(
      usable.map(async (row) => ({
        row,
        scopes: await db
          .select()
          .from(groupComparisons)
          .where(eq(groupComparisons.groupId, row.id))
          .orderBy(groupComparisons.sortOrder, groupComparisons.createdAt),
      })),
    );

    return comparisons.map(({ row, scopes }) => ({
      groupId: row.id,
      name: row.name,
      kind: row.kind,
      comparisons: scopes.map((scope) => ({
        id: scope.id,
        kind: scope.kind,
        subjectName: scope.subjectName,
      })),
    }));
  }),

  /**
   * The figures for one group, comparison by comparison.
   *
   * Named members rather than a bare list of numbers, because a card that says "your
   * average against Amélie's" needs the name — and this is the same data, behind the same
   * consent, that the group's own board already shows to the same people.
   */
  get: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      // Not an error: a group whose owner has not turned cohorts on simply has no
      // figures to give, and a card pointed at it reads as empty rather than as broken.
      if (!access.group.cohortEnabled || access.group.state !== "active") {
        return {
          groupId: access.group.id,
          name: access.group.name,
          enabled: false as const,
          memberCount: 0,
          scale: null,
          decimals: null,
          comparisons: [],
        };
      }

      const [memberships, comparisonRows] = await Promise.all([
        db
          .select()
          .from(groupMemberships)
          .where(eq(groupMemberships.groupId, input.groupId))
          .orderBy(groupMemberships.createdAt),
        db
          .select()
          .from(groupComparisons)
          .where(eq(groupComparisons.groupId, input.groupId))
          .orderBy(groupComparisons.sortOrder, groupComparisons.createdAt),
      ]);
      const named = await identities(memberships.map((row) => row.userId));
      const classTemplate = parseClassTemplate(access.group.classTemplate);
      const scopes = comparisonRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        subjectName: row.subjectName,
        subjectKey: row.subjectKey,
      }));

      const statuses = await classYearStatuses(
        memberships.map((row) => ({
          userId: row.userId,
          yearId: row.yearId,
          template: classTemplate,
        })),
      );
      const readable = await Promise.all(
        memberships.map(async (row, index) => {
          // The board's own gate, unchanged: consent, plus a year actually connected to
          // the class — a figure from an unconnected year is a number about a different
          // set of subjects.
          const shares = row.shareAverage && statuses[index] === "connected";
          if (!shares || !row.yearId) return null;
          const figures = await groupFigures(row.userId, row.yearId, {
            scopes,
            includeTrend: false,
            includeGradeCount: false,
          });
          return figures === null
            ? null
            : {
                userId: row.userId,
                name: named.get(row.userId)?.name ?? "",
                figures,
              };
        }),
      );
      const sharing = readable.flatMap((entry) => (entry ? [entry] : []));

      return {
        groupId: access.group.id,
        name: access.group.name,
        enabled: true as const,
        memberCount: memberships.length,
        // The caller's own scale, so a card formats the group's numbers the way it formats
        // its own. Members of one class share a scale by construction — the template
        // fixes it — so the first is the group's.
        scale: sharing[0]?.figures.scale ?? null,
        decimals: sharing[0]?.figures.decimals ?? null,
        comparisons: scopes.map((scope) => ({
          id: scope.id,
          kind: scope.kind,
          subjectName: scope.subjectName,
          members: sharing.flatMap((entry) => {
            const figure = entry.figures.figures.find(
              (item) => item.scopeId === scope.id,
            );
            return figure?.average === null || figure?.average === undefined
              ? []
              : [
                  {
                    userId: entry.userId,
                    name: entry.name,
                    average: figure.average,
                  } satisfies CohortMemberFigure,
                ];
          }),
        })),
        /** Who the caller is in that list, so a client need not guess. */
        viewerUserId: userId,
        viewerShares: access.membership.shareAverage,
      };
    }),

  /**
   * Every friend who shares something, ready for a card to read.
   *
   * Beside the cohorts because it answers the same question for the other relationship,
   * and in one call because a picker needs the list and a dashboard needs the figures —
   * a friend's shared academics are a few numbers, not the per-member year load a group
   * costs, so fetching them together is cheaper than a query per friend.
   *
   * `sharedAcademics` is the same function the friend's own detail screen uses, so what a
   * card can see and what that screen shows cannot drift apart.
   */
  friends: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select()
      .from(friendships)
      .where(
        or(
          eq(friendships.userLowId, userId),
          eq(friendships.userHighId, userId),
        ),
      );
    const friends = await Promise.all(
      rows.map(async (row) => {
        const friendId =
          row.userLowId === userId ? row.userHighId : row.userLowId;
        const [who, sharing] = await Promise.all([
          identity(friendId),
          sharedAcademics(friendId),
        ]);
        // Somebody who shares nothing is not in the list at all: a picker offering them
        // would be a picker promising a card that can only ever be empty.
        return who === null || sharing === null
          ? null
          : {
              userId: friendId,
              name: who.name,
              scale: sharing.year.scale,
              generalAverage: sharing.generalAverage,
              subjects: sharing.subjects.map((subject) => ({
                name: subject.name,
                average: subject.average,
                gradeCount: subject.gradeCount,
              })),
              history: sharing.history,
            };
      }),
    );
    return friends.flatMap((friend) => (friend ? [friend] : []));
  }),

  /**
   * The owner's switch.
   *
   * Separate from `groups.update` on purpose: turning a board into something that follows
   * members onto their own dashboards is a decision of its own, and a route of its own is
   * where an audit trail would go if one is ever wanted.
   */
  setEnabled: protectedProcedure
    .input(z.object({ groupId: z.string().min(1), enabled: z.boolean() }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      if (access.membership.role !== "owner") {
        throw new ORPCError("FORBIDDEN", {
          message: "Group owner access required",
        });
      }
      // A hold stops writes, and this is a write — the one that decides whether a group
      // follows its members onto their own dashboards. Every other setting on a group
      // asks; this one never did.
      assertActiveGroup(access.group);
      /**
       * Only a class has anything to compare.
       *
       * Comparisons are created with the class and its template; a friends or study group
       * has none and never will, so switching cohorts on there produced a group that
       * announces itself to every card picker and answers every one of them with nothing.
       * Turning it *off* stays allowed, so a group left in that state can be corrected.
       */
      if (input.enabled && access.group.kind !== "class") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only a class can be compared against",
        });
      }
      if (
        input.enabled &&
        !parseClassTemplate(access.group.classTemplate)
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Configure the class before enabling cohorts",
        });
      }
      await db
        .update(socialGroups)
        .set({ cohortEnabled: input.enabled })
        .where(
          and(
            eq(socialGroups.id, input.groupId),
            eq(socialGroups.ownerUserId, context.session.user.id),
          ),
        );
      return { enabled: input.enabled };
    }),
};
