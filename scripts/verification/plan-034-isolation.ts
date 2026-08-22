import { run034 } from "./plan-034-lib";

await run034("managed isolation repository shadow", [
  "bun",
  "run",
  "verify:034:isolation:shadow",
]);
await run034("managed isolation live attestation", [
  "bun",
  "run",
  "verify:034:isolation:live",
]);
