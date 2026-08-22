import { resolve } from "node:path";
import { run033, workspaceRoot } from "./plan-033-lib";

const server = resolve(workspaceRoot, "apps/server");
await run033(
  "artifact graph and migration invariants",
  [
    "bun",
    "test",
    "src/ingestion/artifact-graph.integration.test.ts",
    "src/ingestion/artifact-workflow-dispatcher.test.ts",
    "src/ingestion/workflow.test.ts",
    "src/jobs/export-document-artifact.test.ts",
    "src/node/artifact-stage-executor.test.ts",
    "scripts/migration-history.test.ts",
  ],
  { cwd: server },
);

await run033(
  "media studio production model",
  ["bun", "test", "src/components/media-studio/media-studio-model.test.ts"],
  { cwd: resolve(workspaceRoot, "apps/web") },
);
await run033(
  "tool registry and MCP ledger parity",
  [
    "bun",
    "test",
    "src/tools/adapters/parity.test.ts",
    "src/mcp/mutation-rollout.test.ts",
  ],
  { cwd: server },
);
