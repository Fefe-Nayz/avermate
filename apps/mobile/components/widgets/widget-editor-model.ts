import {
  compileWidgetDefinition,
  resolveWidgetFlow,
  type WidgetDefinitionV1,
  type WidgetFlowContext,
  type WidgetSurface,
  type WidgetValidationIssue,
} from "@avermate/core";
import {
  setWidgetDraftValue,
  widgetDraftValue,
  type WidgetDraftValue,
} from "./widget-draft";

export function preservesRawWidgetDraft(
  definition: WidgetDefinitionV1,
  surface: WidgetSurface,
): boolean {
  return compileWidgetDefinition(definition, { surface }).issues.length > 0;
}

function issueForPath(
  issues: readonly WidgetValidationIssue[],
  path: string,
): WidgetValidationIssue | undefined {
  return issues.find(
    (issue) =>
      issue.path === path ||
      issue.path.startsWith(`${path}.`) ||
      path.startsWith(`${issue.path}.`),
  );
}

/** Canonicalizes structural transitions while retaining invalid active inputs. */
export function resolveWidgetEditorChange(
  definition: WidgetDefinitionV1,
  context: WidgetFlowContext,
): WidgetDefinitionV1 {
  const issues = compileWidgetDefinition(definition, {
    surface: context.surface,
  }).issues;
  const flow = resolveWidgetFlow(definition, context);
  let next = flow.prunedDefinition as unknown as WidgetDraftValue;

  for (const path of flow.activePaths) {
    if (!issueForPath(issues, path)) continue;
    const raw = widgetDraftValue(definition, path);
    if (raw === undefined) continue;
    next = setWidgetDraftValue(next, path, raw);
  }

  return next as unknown as WidgetDefinitionV1;
}
