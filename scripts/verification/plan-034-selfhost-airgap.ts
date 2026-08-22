import { run034 } from "./plan-034-lib";

await run034(
  "strict inherited full-self-host packet/DNS air-gap proof",
  ["bun", "run", "verify:032:selfhost-airgap"],
);
