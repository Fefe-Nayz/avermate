import { resolve } from "node:path";
import { run033, workspaceRoot } from "./plan-033-lib";

const server = resolve(workspaceRoot, "apps/server");
await run033(
  "artifact graph and migration invariants",
  [
    "bun",
    "test",
    "src/ingestion/artifact-graph.integration.test.ts",
    "src/ingestion/workflow.test.ts",
    "scripts/migration-history.test.ts",
  ],
  { cwd: server },
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

