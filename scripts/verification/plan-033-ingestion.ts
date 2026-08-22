import { resolve } from "node:path";
import { run033, workspaceRoot } from "./plan-033-lib";

const server = resolve(workspaceRoot, "apps/server");
const web = resolve(workspaceRoot, "apps/web");
await run033(
  "source adapters and media boundaries",
  ["bun", "test", "src/ingestion/advanced-ingestion.test.ts"],
  { cwd: server },
);
await run033(
  "existing materials ingestion compatibility",
  ["bun", "test", "src/routers/materials.test.ts", "--timeout", "30000"],
  { cwd: server },
);
await run033(
  "Web stable reason presentation",
  ["bun", "test", "src/components/materials/link-ingestion-model.test.ts"],
  { cwd: web },
);
await run033(
  "local fixtures through the real Playwright worker and trusted normalization",
  ["bun", "scripts/verification/plan-033-browser-runtime.ts"],
);
