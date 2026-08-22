import {
  compileWidgetDefinition,
  resolveWidgetFlow,
  type WidgetDefinition,
  type WidgetFlowContext,
  type WidgetValidationIssue,
} from "@avermate/core"
import {
  setWidgetDraftValue,
  widgetDraftValue,
  type WidgetDraftValue,
} from "./widget-draft"

export function widgetIssueForPath(
  issues: readonly WidgetValidationIssue[],
  path: string
): WidgetValidationIssue | undefined {
  return issues.find(
    (issue) =>
      issue.path === path ||
      issue.path.startsWith(`${path}.`) ||
      path.startsWith(`${issue.path}.`)
  )
}

/** Canonicalize structural transitions while retaining invalid active inputs. */
export function resolveWidgetEditorChange(
  definition: WidgetDefinition,
  context: WidgetFlowContext
): WidgetDefinition {
  const issues = compileWidgetDefinition(definition, {
    surface: context.surface,
  }).issues
  const flow = resolveWidgetFlow(definition, context)
  let next = flow.prunedDefinition as unknown as WidgetDraftValue

  for (const path of flow.activePaths) {
    const issue = widgetIssueForPath(issues, path)
    // Only what the reader is *typing* is kept: a half-written number, a cleared
    // field. An `unsupported` issue is a combination the model refuses, and the
    // compiler has already replaced it with one that works — writing the refused
    // value back over that correction leaves the card permanently invalid.
    //
    // This used to be unreachable for the choice fields, because a field with a
    // single option was inactive and never restored. Offering a real second recipe —
    // a goal as a gauge *or* a bullet — made it reachable, and it restored the
    // incompatible one.
    if (!issue || issue.code === "unsupported") continue
    const raw = widgetDraftValue(definition, path)
    if (raw === undefined) continue
    next = setWidgetDraftValue(next, path, raw)
  }

  return next as unknown as WidgetDefinition
}
