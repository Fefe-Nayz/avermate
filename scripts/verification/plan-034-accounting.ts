import { resolve } from "node:path";
import { run034, workspaceRoot } from "./plan-034-lib";

await run034(
  "managed entitlement, usage, pricing and deletion contracts",
  ["bun", "test", "src/managed.test.ts"],
  { cwd: resolve(workspaceRoot, "packages/agent-contracts") },
);
await run034(
  "shadow accounting, costly provider paths, billing boundary and secret lifecycle",
  [
    "bun",
    "test",
    "src/usage/ledger.test.ts",
    "src/usage/pricing.test.ts",
    "src/usage/metered-execution-router.test.ts",
    "src/usage/metered-model-gateway.test.ts",
    "src/billing/shadow-billing.test.ts",
    "src/lib/ocr.test.ts",
    "src/lib/transcription.test.ts",
    "src/lib/text-to-speech.test.ts",
    "src/lib/provider-key-validation.test.ts",
    "src/routers/service-keys.test.ts",
    "src/observability/redaction.test.ts",
    "src/observability/telemetry.test.ts",
    "src/operations/cost-controls.test.ts",
    "src/operations/readiness.test.ts",
    "src/search/vector-runtime.test.ts",
    "--timeout",
    "30000",
  ],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
await run034("managed contract typecheck", ["bun", "run", "check-types"], {
  cwd: resolve(workspaceRoot, "packages/agent-contracts"),
});
await run034("managed server typecheck", ["bun", "run", "check-types"], {
  cwd: resolve(workspaceRoot, "apps/server"),
});
