import { resolve } from "node:path";
import { runChecked, workspaceRoot } from "./plan-032-lib";

await runChecked(
  "verification harness host diagnostics",
  ["bun", "test", "scripts/verification/plan-032-lib.test.ts"],
  { cwd: workspaceRoot },
);

await runChecked("contract protocol", ["bun", "test", "src/node.test.ts"], {
  cwd: resolve(workspaceRoot, "packages/agent-contracts"),
});
await runChecked(
  "node identity/control/jobs/deletion",
  [
    "bun",
    "test",
    "src/canonical-json.test.ts",
    "src/protocol.test.ts",
    "src/control-channel.test.ts",
    "src/daemon.test.ts",
    "src/job-ledger.test.ts",
    "src/stream-lane.test.ts",
    "src/deletion.test.ts",
  ],
  { cwd: resolve(workspaceRoot, "apps/node") },
);
await runChecked(
  "core routing and deletion",
  [
    "bun",
    "test",
    "src/node/capability-execution-plane.test.ts",
    "src/node/execution-router.test.ts",
    "src/node/remote-deletion.test.ts",
    "src/node/fail-closed-adapters.test.ts",
  ],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
