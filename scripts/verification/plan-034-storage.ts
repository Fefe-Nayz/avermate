import { resolve } from "node:path";
import { run034, workspaceRoot } from "./plan-034-lib";

await run034(
  "managed object reservation, isolation and crash reconciliation attacks",
  ["bun", "test", "src/storage/managed-object-storage.test.ts", "--timeout", "30000"],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
await run034(
  "inherited local, Garage and S3-subset conformance without weakening Plan 032",
  ["bun", "run", "verify:032:storage"],
);
