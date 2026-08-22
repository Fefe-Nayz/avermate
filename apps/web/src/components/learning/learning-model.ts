export type ImportedConceptPackDraft = {
  namespace: "curriculum" | "provider"
  source: string
  sourceVersion: string
  title: string
  locale: string
  concepts: Array<{
    stableKey: string
    parentStableKey: string | null
    canonicalLabel: string
    localLabel: string | null
    description: string | null
    sortOrder: number
  }>
  objectives: Array<{
    stableKey: string
    conceptStableKey: string
    statement: string
    expectedLevel: number
    curriculumCode: string | null
    prerequisiteStableKeys: string[]
  }>
}

export type ConceptPackParseResult =
  | {
      ok: true
      value: ImportedConceptPackDraft
      summary: { concepts: number; objectives: number; prerequisites: number }
    }
  | { ok: false; errors: string[] }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(
  value: unknown,
  path: string,
  errors: string[],
  maximum: number
) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string.`)
    return ""
  }
  const result = value.trim()
  if (result.length > maximum)
    errors.push(`${path} must contain at most ${maximum} characters.`)
  return result
}

function optionalString(
  value: unknown,
  path: string,
  errors: string[],
  maximum: number
) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string") {
    errors.push(`${path} must be a string or null.`)
    return null
  }
  const result = value.trim()
  if (result.length > maximum)
    errors.push(`${path} must contain at most ${maximum} characters.`)
  return result || null
}

function hasDirectedCycle(edges: ReadonlyMap<string, readonly string[]>) {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(node: string): boolean {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const next of edges.get(node) ?? []) if (visit(next)) return true
    visiting.delete(node)
    visited.add(node)
    return false
  }
  return [...edges.keys()].some(visit)
}

/**
 * Parses the portable part of a reviewed concept pack. Year and subject are
 * deliberately injected by the caller so a JSON file cannot escape the active
 * account scope.
 */
export function parseConceptPackJson(raw: string): ConceptPackParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, errors: ["The file is not valid JSON."] }
  }
  const root = record(parsed)
  if (!root) return { ok: false, errors: ["The pack must be a JSON object."] }
  const errors: string[] = []
  const namespace = root.namespace === undefined ? "curriculum" : root.namespace
  if (namespace !== "curriculum" && namespace !== "provider")
    errors.push('namespace must be "curriculum" or "provider".')
  const source = requiredString(root.source, "source", errors, 256)
  const sourceVersion = requiredString(
    root.sourceVersion,
    "sourceVersion",
    errors,
    160
  )
  const title = requiredString(root.title, "title", errors, 160)
  const locale =
    root.locale === undefined
      ? "fr"
      : requiredString(root.locale, "locale", errors, 20)
  if (locale.length < 2)
    errors.push("locale must contain at least 2 characters.")

  if (!Array.isArray(root.concepts) || root.concepts.length === 0) {
    errors.push("concepts must contain at least one concept.")
  }
  if (Array.isArray(root.concepts) && root.concepts.length > 2_000)
    errors.push("concepts cannot contain more than 2000 entries.")
  if (root.objectives !== undefined && !Array.isArray(root.objectives))
    errors.push("objectives must be an array.")
  if (Array.isArray(root.objectives) && root.objectives.length > 10_000)
    errors.push("objectives cannot contain more than 10000 entries.")

  const concepts = (Array.isArray(root.concepts) ? root.concepts : [])
    .map((value, index) => {
      const item = record(value)
      if (!item) {
        errors.push(`concepts[${index}] must be an object.`)
        return null
      }
      const sortOrder = item.sortOrder === undefined ? 0 : item.sortOrder
      if (
        !Number.isInteger(sortOrder) ||
        Number(sortOrder) < -100_000 ||
        Number(sortOrder) > 100_000
      )
        errors.push(
          `concepts[${index}].sortOrder must be an integer between -100000 and 100000.`
        )
      return {
        stableKey: requiredString(
          item.stableKey,
          `concepts[${index}].stableKey`,
          errors,
          160
        ),
        parentStableKey: optionalString(
          item.parentStableKey,
          `concepts[${index}].parentStableKey`,
          errors,
          160
        ),
        canonicalLabel: requiredString(
          item.canonicalLabel,
          `concepts[${index}].canonicalLabel`,
          errors,
          160
        ),
        localLabel: optionalString(
          item.localLabel,
          `concepts[${index}].localLabel`,
          errors,
          160
        ),
        description: optionalString(
          item.description,
          `concepts[${index}].description`,
          errors,
          4_000
        ),
        sortOrder: Number.isInteger(sortOrder) ? Number(sortOrder) : 0,
      }
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))

  const objectives = (Array.isArray(root.objectives) ? root.objectives : [])
    .map((value, index) => {
      const item = record(value)
      if (!item) {
        errors.push(`objectives[${index}] must be an object.`)
        return null
      }
      const expectedLevel =
        item.expectedLevel === undefined ? 3 : item.expectedLevel
      if (
        !Number.isInteger(expectedLevel) ||
        Number(expectedLevel) < 1 ||
        Number(expectedLevel) > 5
      )
        errors.push(
          `objectives[${index}].expectedLevel must be an integer from 1 to 5.`
        )
      const rawPrerequisites = item.prerequisiteStableKeys ?? []
      if (!Array.isArray(rawPrerequisites))
        errors.push(
          `objectives[${index}].prerequisiteStableKeys must be an array.`
        )
      const prerequisiteStableKeys = (
        Array.isArray(rawPrerequisites) ? rawPrerequisites : []
      ).map((entry, prerequisiteIndex) =>
        requiredString(
          entry,
          `objectives[${index}].prerequisiteStableKeys[${prerequisiteIndex}]`,
          errors,
          160
        )
      )
      if (prerequisiteStableKeys.length > 50)
        errors.push(
          `objectives[${index}] cannot have more than 50 prerequisites.`
        )
      return {
        stableKey: requiredString(
          item.stableKey,
          `objectives[${index}].stableKey`,
          errors,
          160
        ),
        conceptStableKey: requiredString(
          item.conceptStableKey,
          `objectives[${index}].conceptStableKey`,
          errors,
          160
        ),
        statement: requiredString(
          item.statement,
          `objectives[${index}].statement`,
          errors,
          1_000
        ),
        expectedLevel: Number.isInteger(expectedLevel)
          ? Number(expectedLevel)
          : 3,
        curriculumCode: optionalString(
          item.curriculumCode,
          `objectives[${index}].curriculumCode`,
          errors,
          160
        ),
        prerequisiteStableKeys,
      }
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))

  const conceptKeys = new Set<string>()
  for (const concept of concepts) {
    if (conceptKeys.has(concept.stableKey))
      errors.push(`Duplicate concept stable key: ${concept.stableKey}.`)
    conceptKeys.add(concept.stableKey)
  }
  const conceptEdges = new Map<string, string[]>()
  for (const concept of concepts) {
    const parent = concept.parentStableKey
    if (parent && !conceptKeys.has(parent))
      errors.push(`Unknown parent concept: ${parent}.`)
    if (parent === concept.stableKey)
      errors.push(`Concept ${concept.stableKey} cannot be its own parent.`)
    conceptEdges.set(concept.stableKey, parent ? [parent] : [])
  }
  if (hasDirectedCycle(conceptEdges))
    errors.push("The concept hierarchy contains a cycle.")

  const objectiveKeys = new Set<string>()
  for (const objective of objectives) {
    if (objectiveKeys.has(objective.stableKey))
      errors.push(`Duplicate objective stable key: ${objective.stableKey}.`)
    objectiveKeys.add(objective.stableKey)
  }
  const objectiveEdges = new Map<string, string[]>()
  for (const objective of objectives) {
    if (!conceptKeys.has(objective.conceptStableKey))
      errors.push(
        `Objective ${objective.stableKey} references an unknown concept.`
      )
    const unique = new Set(objective.prerequisiteStableKeys)
    if (unique.size !== objective.prerequisiteStableKeys.length)
      errors.push(`Objective ${objective.stableKey} repeats a prerequisite.`)
    for (const prerequisite of unique) {
      if (!objectiveKeys.has(prerequisite))
        errors.push(`Unknown prerequisite objective: ${prerequisite}.`)
      if (prerequisite === objective.stableKey)
        errors.push(`Objective ${objective.stableKey} cannot depend on itself.`)
    }
    objectiveEdges.set(objective.stableKey, [...unique])
  }
  if (hasDirectedCycle(objectiveEdges))
    errors.push("The objective prerequisites contain a cycle.")

  if (errors.length) return { ok: false, errors: [...new Set(errors)] }
  return {
    ok: true,
    value: {
      namespace: namespace as "curriculum" | "provider",
      source,
      sourceVersion,
      title,
      locale,
      concepts,
      objectives,
    },
    summary: {
      concepts: concepts.length,
      objectives: objectives.length,
      prerequisites: objectives.reduce(
        (count, objective) => count + objective.prerequisiteStableKeys.length,
        0
      ),
    },
  }
}

export type LearningPlanGroup = "today" | "upcoming" | "objectives"

type PlanRowWithTask = {
  planningTask: {
    scheduledAt: Date | null
    dueAt: Date | null
  } | null
}

export function learningPlanGroup(
  row: PlanRowWithTask,
  now: Date
): LearningPlanGroup {
  const dates = [row.planningTask?.scheduledAt, row.planningTask?.dueAt].filter(
    (date): date is Date => Boolean(date)
  )
  if (dates.length === 0) return "objectives"
  const date = new Date(Math.min(...dates.map((value) => value.getTime())))
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  if (date < end) return "today"
  if (date >= end) return "upcoming"
  return "objectives"
}

export type LearningRationaleV2 = {
  version: 2
  score: number
  estimate: number | null
  interval: [number, number] | null
  freshnessDays: number | null
  dueAt: string | null
  dueUrgency: number
  unmetPrerequisiteIds: string[]
  neededByWeakObjectiveIds: string[]
  availableMinutes: number
  estimatedMinutes: number
  reason?: string
}

export function learningRationaleV2(
  value: unknown
): LearningRationaleV2 | null {
  const item = record(value)
  if (!item || item.version !== 2 || typeof item.score !== "number") return null
  if (
    !Array.isArray(item.unmetPrerequisiteIds) ||
    !Array.isArray(item.neededByWeakObjectiveIds) ||
    typeof item.availableMinutes !== "number" ||
    typeof item.estimatedMinutes !== "number" ||
    typeof item.dueUrgency !== "number"
  )
    return null
  return value as LearningRationaleV2
}
