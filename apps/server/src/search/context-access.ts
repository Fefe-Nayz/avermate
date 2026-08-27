import type { InValue } from "@libsql/client";
import type {
  CorpusContextAccess,
  OwnedLexicalQuery,
} from "@avermate/agent-contracts";

export function corpusContextAccess(
  input: Pick<OwnedLexicalQuery, "contextAccess">,
): CorpusContextAccess {
  return input.contextAccess ?? "agent-request";
}

export function projectContextModeSql(
  input: Pick<OwnedLexicalQuery, "contextAccess">,
  alias = "project_items",
) {
  switch (corpusContextAccess(input)) {
    case "automatic":
      return `${alias}.contextMode = 'include'`;
    case "agent-request":
      return `${alias}.contextMode != 'exclude'`;
    case "explicit-attachment":
      return null;
  }
}

/**
 * Build one source-scope clause. Direct attachments and project membership are
 * a union, never an intersection: attaching one file to a project chat should
 * prioritise that file without silently hiding the rest of the project.
 */
export function sourceOrProjectScopeSql(input: {
  sourceIds?: readonly string[];
  projectIds: readonly string[];
  contextAccess?: CorpusContextAccess;
  args: InValue[];
  sourceSql: (placeholders: string) => string;
  projectSql: (contextModeSql: string) => { sql: string; args: InValue[] };
}) {
  const alternatives: string[] = [];
  const sourceIds = input.sourceIds ?? [];
  if (sourceIds.length > 0) {
    alternatives.push(input.sourceSql(sourceIds.map(() => "?").join(", ")));
    input.args.push(...sourceIds);
  }
  const contextModeSql = projectContextModeSql(input);
  if (input.projectIds.length > 0 && contextModeSql) {
    const project = input.projectSql(contextModeSql);
    alternatives.push(project.sql);
    input.args.push(...project.args);
  }
  if (alternatives.length > 0) {
    return `(${alternatives.join(" OR ")})`;
  }
  return corpusContextAccess(input) === "explicit-attachment" ? "0 = 1" : null;
}
