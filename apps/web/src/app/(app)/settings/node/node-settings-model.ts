import type { NodeCapabilityId } from "@avermate/agent-contracts"

export const NODE_CAPABILITIES = [
  "storage",
  "conversations",
  "retrieval",
  "models",
  "jobs",
  "sandbox",
  "renderers",
  "school-connectors",
] as const satisfies readonly NodeCapabilityId[]

export type NodePlacementKind = "core" | "node" | "managed" | "byok"

const PAIRING_CHARACTER = /^[A-HJ-NP-Z2-9]$/u

/**
 * Pairing codes deliberately exclude ambiguous glyphs. Formatting in the Web
 * client never broadens what the Core accepts; it only makes pasted/local input
 * match the `XXXX-XXXX` representation emitted by the loopback configurator.
 */
export function formatNodePairingCode(value: string): string {
  const compact = [...value.toUpperCase()]
    .filter((character) => PAIRING_CHARACTER.test(character))
    .slice(0, 8)
    .join("")
  return compact.length > 4
    ? `${compact.slice(0, 4)}-${compact.slice(4)}`
    : compact
}

export function isCompleteNodePairingCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u.test(value)
}

export function isDurableNodeCapability(capability: NodeCapabilityId): boolean {
  return (
    capability === "storage" ||
    capability === "conversations" ||
    capability === "retrieval"
  )
}

export function nodePlacementProviderId(
  placement: NodePlacementKind,
  nodeId?: string
): string {
  if (placement === "node") {
    if (!nodeId) throw new Error("A node placement requires a node id")
    return `node:${nodeId}`
  }
  return `${placement}-default`
}

export type NodeDisplayState =
  "online" | "offline" | "revoked" | "upgrade-required"

export function nodeDisplayState(input: {
  state: string
  online: boolean
  protocolMajor: number
  expectedProtocolMajor: number
}): NodeDisplayState {
  if (input.state === "revoked") return "revoked"
  if (input.protocolMajor !== input.expectedProtocolMajor) {
    return "upgrade-required"
  }
  return input.online ? "online" : "offline"
}

export function fullSelfHostReadinessProgress(
  diagnostics: readonly { ready: boolean }[]
): { ready: number; total: number; percent: number } {
  const ready = diagnostics.filter((diagnostic) => diagnostic.ready).length
  const total = diagnostics.length
  return {
    ready,
    total,
    percent: total === 0 ? 0 : Math.round((ready / total) * 100),
  }
}
