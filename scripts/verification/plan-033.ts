import { run033 } from "./plan-033-lib";

const repositoryGates = [
  "verify:033:contracts",
  "verify:033:ingestion",
  "verify:033:artifacts",
  "verify:033:sandbox:repository",
] as const;

for (const gate of repositoryGates) {
  await run033(gate, ["bun", "run", gate]);
}

await run033("production media-studio Web E2E", [
  "bun",
  "run",
  "--cwd",
  "apps/web",
  "test:e2e",
  "--",
  "e2e/media-studio-production.spec.ts",
]);
