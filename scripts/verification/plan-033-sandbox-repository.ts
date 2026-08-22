import { resolve } from "node:path";
import { run033, workspaceRoot } from "./plan-033-lib";

const server = resolve(workspaceRoot, "apps/server");

await run033("no native browser/media/document execution in the API", [
  "bun",
  "scripts/verification/plan-033-sandbox-audit.ts",
]);
await run033(
  "exact worker admission, dispatch, manifest verification and adoption",
  [
    "bun",
    "test",
    "src/sandbox/worker-execution.test.ts",
    "src/sandbox/job-admission.test.ts",
    "src/sandbox/artifact-adoption.test.ts",
  ],
  { cwd: server },
);
await run033(
  "disabled provider is unavailable rather than fabricated live evidence",
  ["bun", "run", "sandbox:conformance"],
  { cwd: server },
);
await run033("sandbox contract typecheck", ["bun", "run", "check-types"], {
  cwd: server,
});
