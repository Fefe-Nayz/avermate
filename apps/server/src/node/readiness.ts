import type { NodeCapabilityId } from "@avermate/agent-contracts";

export type NodePlacementMigrationState =
  | "planned"
  | "copying"
  | "validating"
  | "verified"
  | "failed"
  | "not-required";

const durableCapabilities = new Set<NodeCapabilityId>([
  "storage",
  "conversations",
  "retrieval",
]);

/**
 * Durable ownership changes require a verified migration. Execution-only
 * capabilities have no bytes to migrate and are ready only when the registry
 * records that fact explicitly as `not-required` (or a verified migration).
 */
export function nodePlacementMigrationReady(
  capability: NodeCapabilityId,
  state: string,
) {
  return durableCapabilities.has(capability)
    ? state === "verified"
    : state === "not-required" || state === "verified";
}
