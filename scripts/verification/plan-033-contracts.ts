import { resolve } from "node:path";
import { run033, workspaceRoot } from "./plan-033-lib";

const contracts = resolve(workspaceRoot, "packages/agent-contracts");
await run033("media contract tests", ["bun", "test", "src/media.test.ts"], {
  cwd: contracts,
});
await run033(
  "versioned sandbox worker contract tests",
  ["bun", "test", "src/sandbox-workers.test.ts", "src/sandbox.test.ts"],
  { cwd: contracts },
);
await run033("media contract typecheck", ["bun", "run", "check-types"], {
  cwd: contracts,
});

const workers = resolve(workspaceRoot, "apps/sandbox-worker");
await run033(
  "structured worker fixtures and digest-pinned image plan",
  ["bun", "test", "src/workers.test.ts", "scripts/build-image.test.ts"],
  { cwd: workers },
);
await run033("sandbox worker typecheck", ["bun", "run", "check-types"], {
  cwd: workers,
});
