/**
 * A friend's figures, as a card may read them.
 *
 * The sibling of `cohort.ts` and a different relationship: a cohort is a group you are
 * *inside*, ranked against, and a friend is one person you compare with. So the readings
 * differ — nobody is ranked here, and nothing is aggregated — but the rule is the same
 * one, and it is the only rule in this file: **every number here exists because its owner
 * ticked a box.**
 *
 * Three locks on the other side, and this module can tell them apart:
 *
 * - the general average, which may be `null` while subjects are shared;
 * - which subjects, which may be all, some, or none;
 * - the *history* of the general average, which is its own lock and off by default —
 *   a current average says where somebody is, and its curve says when they had a bad
 *   fortnight.
 *
 * A card names a friend and nothing else. The figures arrive with the render, so a
 * withdrawn consent empties the card rather than leaving a number in storage.
 */

export interface FriendSubject {
  /** Matched by name, because two people's subject trees are not the same tree. */
  name: string;
  average: number;
  gradeCount: number;
}

export interface FriendContext {
  userId: string;
  name: string;
  /** Their year's own top mark; a comparison across scales would be nonsense. */
  scale: number;
  /** `null` where that lock is closed, even though the subjects may be open. */
  generalAverage: number | null;
  subjects: FriendSubject[];
  /** `null` unless they opened the history lock. */
  history: Array<{ at: Date; ratio: number }> | null;
}

export interface SubjectComparisonRow {
  name: string;
  /** The reader's own average in that subject, `null` where they have none. */
  mine: number | null;
  /** The friend's, `null` where they do not share it. */
  theirs: number | null;
  /** Signed, and `null` unless both sides have a figure. */
  gap: number | null;
}

/**
 * The two subject lists, side by side.
 *
 * Matched **by name**, which is the only identity two people's subjects share — one
 * person's "Maths" is another's "Mathématiques" and neither knows the other's ids. Names
 * are compared case-insensitively and trimmed, and nothing cleverer: a fuzzy match that
 * paired "Physique" with "Physique-Chimie" would invent a comparison nobody made.
 *
 * Rows where only one side has a figure are kept. A subject a friend does not share is a
 * fact about the comparison — dropping it would quietly shorten the table and make the
 * two lists look more alike than they are.
 */
export function compareSubjects(
  mine: ReadonlyArray<{ name: string; average: number | null }>,
  theirs: readonly FriendSubject[],
): SubjectComparisonRow[] {
  const key = (name: string) => name.trim().toLocaleLowerCase();
  const rows = new Map<string, SubjectComparisonRow>();

  for (const subject of mine) {
    rows.set(key(subject.name), {
      name: subject.name,
      mine: subject.average,
      theirs: null,
      gap: null,
    });
  }
  for (const subject of theirs) {
    const existing = rows.get(key(subject.name));
    if (existing) existing.theirs = subject.average;
    else {
      rows.set(key(subject.name), {
        name: subject.name,
        mine: null,
        theirs: subject.average,
        gap: null,
      });
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      gap:
        row.mine === null || row.theirs === null ? null : row.mine - row.theirs,
    }))
    // Rows both sides have first, then the rest by name: a table whose first half is
    // comparable is a table you can read, and one interleaved with half-empty rows is not.
    .sort((left, right) => {
      const comparable = Number(right.gap !== null) - Number(left.gap !== null);
      return comparable !== 0 ? comparable : left.name.localeCompare(right.name);
    });
}
