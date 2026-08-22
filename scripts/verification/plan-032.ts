import { runChecked } from "./plan-032-lib";

for (const gate of [
  "verify:032:protocol",
  "verify:032:storage",
  "verify:032:configurator",
  "verify:032:selfhost",
  "verify:032:selfhost-airgap",
]) {
  await runChecked(gate, ["bun", "run", gate]);
}
