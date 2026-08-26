/**
 * The shapes and two helpers the concept screens share.
 *
 * They lived in `concept-management.tsx` while it was the only file that used
 * them. The dialogs moved into their own component, and a type two files both
 * need is a module rather than a circular import between them.
 */

export type Concept = {
  id: string
  setId: string
  parentId: string | null
  canonicalLabel: string
  localLabel: string | null
  description: string | null
  sortOrder: number
  revision: number
}

export type Objective = {
  id: string
  conceptId: string
  statement: string
  expectedLevel: number
  yearId: string
  subjectId: string | null
  activeFrom: Date | null
  activeTo: Date | null
  revision: number
}

/** A fresh client-side id, for rows the server has not seen yet. */
export function key() {
  return crypto.randomUUID()
}

/** What to call a concept: your name for it, or the school's. */
export function conceptLabel(concept: Concept) {
  return concept.localLabel || concept.canonicalLabel
}

export type ConceptListData = {
  concepts: Array<{ concept: Concept; setTitle: string }>
  objectives: Objective[]
  prerequisites: Array<{
    objectiveId: string
    prerequisiteObjectiveId: string
  }>
}
