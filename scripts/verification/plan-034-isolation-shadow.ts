import { resolve } from "node:path";
import { run034, workspaceRoot } from "./plan-034-lib";

await run034(
  "managed sandbox admission, tenant identity and fail-closed dispatch",
  [
    "bun",
    "test",
    "src/sandbox/managed-provider.test.ts",
    "src/sandbox/job-admission.test.ts",
    "src/sandbox/image-attestation.test.ts",
    "src/node/fail-closed-adapters.test.ts",
    "--timeout",
    "30000",
  ],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
await run034(
  "inherited sandbox policy, admission and disabled-provider audit",
  ["bun", "run", "verify:033:sandbox:repository"],
);
