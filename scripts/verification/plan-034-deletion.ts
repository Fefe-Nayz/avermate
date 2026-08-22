import { resolve } from "node:path";
import { run034, workspaceRoot } from "./plan-034-lib";

await run034(
  "placement-aware export, trash and resumable deletion",
  [
    "bun",
    "test",
    "src/privacy/operations.test.ts",
    "src/node/remote-deletion.test.ts",
    "--timeout",
    "30000",
  ],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
