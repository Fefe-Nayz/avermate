import { resolve } from "node:path";
import { run034, workspaceRoot } from "./plan-034-lib";

await run034(
  "30-day/100-tenant/10,000-run and 1,000-concurrent-reservation fixture",
  ["bun", "test", "src/operations/load-fixture.test.ts", "--timeout", "120000"],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
