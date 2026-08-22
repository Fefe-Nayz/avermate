import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../..", import.meta.url));

const productionServices = await Bun.file(
  join(root, "apps/server/src/assistant/services.ts"),
).text();
const productionRuntime = await Bun.file(
  join(root, "apps/server/src/agent/production-runtime.ts"),
).text();
const runtimeIntegration = await Bun.file(
  join(root, "apps/server/src/assistant/core-conversation-store.test.ts"),
).text();

if (/new\s+ReadOnlyAssistantRunService\s*\(/u.test(productionServices)) {
  throw new Error(
    "Plan 035 failed: production still instantiates the legacy assistant loop",
  );
}
if (!productionServices.includes("createProductionAgentRuntime")) {
  throw new Error(
    "Plan 035 failed: production services do not use the AgentRuntime factory",
  );
}
if (
  !productionRuntime.includes("AssistantGraphExecutor") ||
  productionRuntime.includes("new ReadOnlyAssistantRunService")
) {
  throw new Error(
    "Plan 035 failed: ProductionAgentRuntime is not the explicit Avermate executor",
  );
}
if (
  !runtimeIntegration.includes("new ProductionAgentRuntime") ||
  !runtimeIntegration.includes("assistant_provider_dispatch_claims") ||
  !runtimeIntegration.includes("assistant_run_leases")
) {
  throw new Error(
    "Plan 035 failed: the production runtime lacks a durable end-to-end test",
  );
}

const commands = [
  ["bun", "run", "verify:035:evidence-contract"],
  [
    "bun",
    "test",
    "packages/agent-contracts/src/runtime.test.ts",
    "packages/agent-contracts/src/assistant.test.ts",
    "packages/agent-contracts/src/events.test.ts",
  ],
  [
    "bun",
    "run",
    "--cwd",
    "apps/server",
    "test",
    "src/agent/model-gateways.test.ts",
    "src/agent/run-control-store.test.ts",
    "src/assistant/model-policy.test.ts",
    "src/assistant/core-conversation-store.test.ts",
    "src/assistant/checkpoint-store.test.ts",
    "src/actions/action-ledger.test.ts",
    "src/ingestion/artifact-workflow-dispatcher.test.ts",
  ],
  [
    "bun",
    "run",
    "--cwd",
    "apps/web",
    "test:e2e",
    "--",
    "e2e/assistant-production.spec.ts",
  ],
  [
    "bun",
    "test",
    "apps/web/src/components/assistant/assistant-runtime-adapter.test.ts",
    "apps/web/src/components/assistant/assistant-event-projection.test.ts",
    "apps/web/src/components/assistant/assistant-citation-navigation.test.ts",
    "apps/web/src/components/assistant/actions/action-model.test.ts",
    "apps/web/src/app/(app)/settings/integrations/integrations-sync-prefetch.test.ts",
  ],
  ["bun", "run", "verify:029:citations"],
  ["bun", "run", "--cwd", "apps/server", "check-types"],
  ["bun", "run", "--cwd", "apps/web", "check-types"],
] as const;

for (const command of commands) {
  const result = Bun.spawnSync(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

console.log(
  "Plan 035 repository verification passed (annotated live-provider/load evidence remains a separate release gate).",
);
