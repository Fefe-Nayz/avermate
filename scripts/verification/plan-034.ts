import { run034 } from "./plan-034-lib";

const gates = [
  "accounting",
  "storage",
  "isolation",
  "deletion",
  "restore",
  "load",
  "selfhost-airgap",
] as const;
const failures: string[] = [];

for (const gate of gates) {
  try {
    await run034(gate, ["bun", "run", `verify:034:${gate}`]);
  } catch (error) {
    failures.push(`${gate}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  throw new Error(`PLAN034_REQUIRED_GATES_FAILED\n${failures.join("\n")}`);
}
