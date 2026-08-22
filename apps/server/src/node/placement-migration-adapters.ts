import type { CapabilityPlacement, NodeCapabilityId } from "@avermate/agent-contracts";

export type DurablePlacementMigrationResult = {
  itemCount: number;
  copiedBytes: number;
  sourceDigest: string;
  destinationDigest: string;
};

export type DurablePlacementMigrationAdapter = (input: {
  ownerId: string;
  source: CapabilityPlacement;
  destination: CapabilityPlacement;
}) => Promise<DurablePlacementMigrationResult>;

const adapters = new Map<NodeCapabilityId, DurablePlacementMigrationAdapter>();

export function registerPlacementMigrationAdapter(
  capability: Extract<NodeCapabilityId, "conversations" | "retrieval">,
  adapter: DurablePlacementMigrationAdapter,
) {
  adapters.set(capability, adapter);
}

export function placementMigrationAdapter(capability: NodeCapabilityId) {
  return adapters.get(capability) ?? null;
}
