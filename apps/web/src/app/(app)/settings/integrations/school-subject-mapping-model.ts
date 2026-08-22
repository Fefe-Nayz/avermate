export type SubjectMappingStatus = "mapped" | "unmatched" | "ambiguous"

export function subjectMappingsNeedingReview<
  T extends { matchStatus: SubjectMappingStatus; subjectId: string | null },
>(mappings: readonly T[]) {
  return mappings.filter(
    (mapping) => mapping.matchStatus !== "mapped" || !mapping.subjectId
  )
}

export function linkedSubjectMappings<
  T extends { matchStatus: SubjectMappingStatus; subjectId: string | null },
>(mappings: readonly T[]) {
  return mappings.filter(
    (mapping) => mapping.matchStatus === "mapped" && Boolean(mapping.subjectId)
  )
}

export function subjectMappingReviewCounts(
  mappings: readonly {
    matchStatus: SubjectMappingStatus
    subjectId: string | null
  }[]
) {
  return mappings.reduce(
    (counts, mapping) => {
      if (mapping.matchStatus === "ambiguous") counts.ambiguous += 1
      else if (mapping.matchStatus === "unmatched" || !mapping.subjectId) {
        counts.unmatched += 1
      }
      return counts
    },
    { unmatched: 0, ambiguous: 0 }
  )
}

export interface LocalSubjectChoice {
  id: string
  name: string
  shortName: string | null
  parentId: string | null
  kind: "subject" | "category"
}

/**
 * Produces labels that remain distinguishable when the ambiguity itself comes
 * from local subjects sharing a name. Parent paths and abbreviations provide
 * useful context; a short stable id is the final discriminator for duplicate
 * roots with otherwise identical metadata.
 */
export function localSubjectSelectOptions(
  subjects: readonly LocalSubjectChoice[]
) {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]))
  const selectable = subjects.filter((subject) => subject.kind === "subject")
  const nameCounts = new Map<string, number>()
  for (const subject of selectable) {
    nameCounts.set(subject.name, (nameCounts.get(subject.name) ?? 0) + 1)
  }

  const contextual = selectable.map((subject) => {
    if ((nameCounts.get(subject.name) ?? 0) === 1) {
      return { value: subject.id, label: subject.name }
    }

    const ancestors: string[] = []
    const visited = new Set([subject.id])
    let parentId = subject.parentId
    while (parentId && ancestors.length < 10 && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      ancestors.unshift(parent.name)
      parentId = parent.parentId
    }
    const context = [
      ancestors.length > 0 ? ancestors.join(" › ") : null,
      subject.shortName,
    ].filter((value): value is string => Boolean(value))
    return {
      value: subject.id,
      label:
        context.length > 0
          ? `${subject.name} — ${context.join(" · ")}`
          : subject.name,
    }
  })
  const labelCounts = new Map<string, number>()
  for (const option of contextual) {
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1)
  }
  return contextual.map((option) =>
    (labelCounts.get(option.label) ?? 0) > 1
      ? { ...option, label: `${option.label} · ${option.value}` }
      : option
  )
}
