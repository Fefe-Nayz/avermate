import { resolve } from "node:path";
import { run034, workspaceRoot } from "./plan-034-lib";

await run034(
  "clean-target logical restore fixture with scoped timing and digest evidence",
  ["bun", "test", "src/operations/restore-drill.test.ts", "--timeout", "30000"],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
