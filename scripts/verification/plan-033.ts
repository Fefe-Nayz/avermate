import { run033 } from "./plan-033-lib";

for (const gate of [
  "verify:033:contracts",
  "verify:033:ingestion",
  "verify:033:artifacts",
  "verify:033:sandbox",
]) {
  await run033(gate, ["bun", "run", gate]);
}

