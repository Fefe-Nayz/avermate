import { resolve } from "node:path";
import { runChecked, workspaceRoot } from "./plan-032-lib";

await runChecked(
  "storage and corpus contracts",
  ["bun", "test", "src/storage.test.ts", "src/corpus.test.ts"],
  { cwd: resolve(workspaceRoot, "packages/agent-contracts") },
);
await runChecked(
  "node filesystem storage",
  ["bun", "test", "--timeout", "30000", "src/filesystem-storage.test.ts"],
  { cwd: resolve(workspaceRoot, "apps/node") },
);
await runChecked(
  "core/node storage, conversation, retrieval, model and sandbox adapters",
  [
    "bun",
    "test",
    "--timeout",
    "30000",
    "src/node/core-object-storage-provider.test.ts",
    "src/node/node-object-storage-provider.test.ts",
    "src/node/node-provider-adapters.test.ts",
    "src/node/two-phase-object-adopter.test.ts",
    "src/node/remote-deletion.test.ts",
    "src/agent/conversation-store.test.ts",
    "src/search/core-corpus-store.test.ts",
    "src/search/conversation-adapter.test.ts",
    "src/jobs/corpus.test.ts",
    "src/assistant/citation-protocol.test.ts",
  ],
  { cwd: resolve(workspaceRoot, "apps/server") },
);

if (process.argv.includes("--contracts-only")) {
  console.log(
    "[plan-032] storage contract subset passed; provider-runtime conformance remains in verify:032:storage.",
  );
  process.exit(0);
}

await runChecked("disposable Garage provider conformance", [
  "bun",
  "scripts/verification/plan-032-garage.ts",
]);
if (process.env.PLAN032_REAL_S3_CONFORMANCE === "1") {
  await runChecked("opt-in real S3 provider conformance", [
    "bun",
    "scripts/verification/plan-032-real-s3.ts",
  ]);
}
