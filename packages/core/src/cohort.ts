/**
 * Where you stand in a group, and what that is allowed to say.
 *
 * The arithmetic is small — a sort and a count — and almost all of this file is about the
 * three ways a ranking lies:
 *
 * - **In a tiny group.** "Second of three" identifies the other two. Below
 *   `COHORT_MINIMUM_SHARING` there is no rank at all, and the card says so rather than
 *   showing one with a caveat nobody reads.
 * - **On ties.** Two members on the same average must share a rank, and the next one down
 *   must be pushed past both. Competition ranking — 1, 2, 2, 4 — which is what a school
 *   report says and what a reader expects.
 * - **About who is included.** The group's average is the average of *those who share*,
 *   which is not the class average and must never be called one. A member who shares
 *   nothing is not in the list, so they cannot be ranked in it either.
 *
 * The consent itself is enforced on the server: a figure reaches this module only if its
 * owner left their sharing switch on. What is decided here is what the numbers may be
 * said to *mean*.
 */

export interface CohortMember {
  userId: string;
  name: string;
  average: number;
}

export interface CohortContext {
  groupId: string;
  /** The group's own name, for a card that says which comparison this is. */
  name: string;
  /** Members of the group, sharing or not. */
  memberCount: number;
  /** Those whose figure is readable, which is who a rank is out of. */
  members: CohortMember[];
  /** Which of them is the reader. */
  viewerUserId: string;
}

/**
 * Sharing members needed before a rank is shown.
 *
 * Five, and the number is about identification rather than statistics: in a group of
 * three, a rank plus a group average lets a reader work out the other two figures. Five
 * is the smallest size where being told "you are third" leaves the rest genuinely
 * ambiguous.
 */
export const COHORT_MINIMUM_SHARING = 5;

export interface CohortStanding {
  groupId: string;
  name: string;
  /** Competition rank, 1-based. `null` when the reader shares nothing. */
  rank: number | null;
  /** How many members the rank is out of — those sharing, not the whole group. */
  of: number;
  /** Members of the group who share nothing, so the reading says what it excludes. */
  hidden: number;
  /** Share of the sharing members strictly below the reader, 0 … 1. */
  percentile: number | null;
  /** The reader's own figure. */
  mine: number | null;
  /** The average of those sharing — never called the class average. */
  groupAverage: number;
  best: number;
  median: number;
}

/**
 * Where the reader stands, or `null` when nothing may be said.
 *
 * `null` in one case only — too few members sharing — because that is the case where the
 * *reading itself* is not allowed. A reader who shares nothing gets a standing with a
 * `null` rank instead: the group's figures are still theirs to see, and what is missing is
 * their own place in it, which is a different sentence.
 */
export function cohortStanding(cohort: CohortContext): CohortStanding | null {
  const members = cohort.members.filter((member) =>
    Number.isFinite(member.average),
  );
  if (members.length < COHORT_MINIMUM_SHARING) return null;

  const sorted = [...members].sort((left, right) => right.average - left.average);
  const mine =
    members.find((member) => member.userId === cohort.viewerUserId)?.average ??
    null;

  // Competition rank: everybody strictly above you, plus one. Ties share the better rank
  // and the next member is pushed past all of them.
  const rank =
    mine === null
      ? null
      : members.filter((member) => member.average > mine).length + 1;
  const below =
    mine === null
      ? null
      : members.filter((member) => member.average < mine).length;

  const total = members.reduce((sum, member) => sum + member.average, 0);
  const middle = Math.floor(sorted.length / 2);

  return {
    groupId: cohort.groupId,
    name: cohort.name,
    rank,
    of: members.length,
    hidden: Math.max(0, cohort.memberCount - members.length),
    // Out of the *others*: being above four of your four peers is the top, and dividing by
    // the whole list would cap it below one for everybody.
    percentile:
      below === null || members.length < 2 ? null : below / (members.length - 1),
    mine,
    groupAverage: total / members.length,
    best: sorted[0]?.average ?? 0,
    median:
      sorted.length % 2 === 0
        ? ((sorted[middle - 1]?.average ?? 0) + (sorted[middle]?.average ?? 0)) /
          2
        : (sorted[middle]?.average ?? 0),
  };
}
