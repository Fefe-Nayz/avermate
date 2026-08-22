import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { workspaceRoot } from "./plan-033-lib";

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.(?:ts|tsx)$/u.test(name)
        ? [path]
        : [];
  });
}

const apiRoot = resolve(workspaceRoot, "apps/server/src");
const apiFiles = files(apiRoot).filter(
  (path) => !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(path),
);
// Runtime-native execution is forbidden until it is represented by an
// attested SandboxProvider profile. Keep this explicit map empty by default;
// any future exception requires a narrowly reviewed file + pattern pair.
const nativeExecutionAllowlist = new Map<string, readonly RegExp[]>();
const forbidden = [
  /from ["']node:child_process["']/u,
  /\bBun\.spawn(?:Sync)?\s*\(/u,
  /\bexecFile(?:Sync)?\s*\(/u,
  /\bspawn(?:Sync)?\s*\(/u,
  /from ["'](?:playwright|playwright-core|youtube-dl-exec|fluent-ffmpeg|manim)["']/u,
  /\bDeno\.Command\s*\(/u,
];
for (const path of apiFiles) {
  const source = readFileSync(path, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      const projectPath = relative(workspaceRoot, path).replaceAll("\\", "/");
      const allowed = nativeExecutionAllowlist
        .get(projectPath)
        ?.some((exception) => exception.test(source));
      if (!allowed) {
        throw new Error(
          `PLAN033_ACTIVE_EXECUTION_FORBIDDEN:${projectPath}:${pattern}`,
        );
      }
    }
  }
}

const privateAssets = readFileSync(
  resolve(workspaceRoot, "apps/server/src/ingestion/private-assets.ts"),
  "utf8",
);
if (/\bawait\s+fetch\s*\(/u.test(privateAssets)) {
  throw new Error("PLAN033_NATIVE_ASSET_FETCH_FALLBACK_FORBIDDEN");
}
const migration = readFileSync(
  resolve(workspaceRoot, "apps/server/drizzle/0059_old_tigra.sql"),
  "utf8",
);
for (const invariant of [
  "generated_artifact_revisions_immutable",
  "artifact_revision_parent_cycle_guard",
  "generated_artifact_current_revision_update_guard",
  "video_timeline_manifest_owner_guard",
]) {
  if (!migration.includes(invariant)) {
    throw new Error(`PLAN033_MIGRATION_INVARIANT_MISSING:${invariant}`);
  }
}
console.log(`[plan-033] sandbox static audit passed (${apiFiles.length} files)`);
