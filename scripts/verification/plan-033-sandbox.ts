import { run033 } from "./plan-033-lib";

await run033("repository sandbox policy, admission and worker boundaries", [
  "bun",
  "run",
  "verify:033:sandbox:repository",
]);
await run033("live attested browser and media sandbox profiles", [
  "bun",
  "run",
  "verify:033:sandbox:live",
]);
