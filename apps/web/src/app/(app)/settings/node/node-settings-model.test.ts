import { describe, expect, test } from "bun:test"
import {
  formatNodePairingCode,
  fullSelfHostReadinessProgress,
  isCompleteNodePairingCode,
  isDurableNodeCapability,
  nodeDisplayState,
  nodePlacementProviderId,
} from "./node-settings-model"

describe("Avermate Node Web model", () => {
  test("formats only unambiguous pairing glyphs without creating authority", () => {
    expect(formatNodePairingCode("abci 12o9-z7xy")).toBe("ABC2-9Z7X")
    expect(formatNodePairingCode("abcd2345more")).toBe("ABCD-2345")
    expect(isCompleteNodePairingCode("ABCD-2345")).toBe(true)
    expect(isCompleteNodePairingCode("ABCD-234")).toBe(false)
  })

  test("keeps durable migration lanes explicit", () => {
    expect(isDurableNodeCapability("storage")).toBe(true)
    expect(isDurableNodeCapability("conversations")).toBe(true)
    expect(isDurableNodeCapability("retrieval")).toBe(true)
    expect(isDurableNodeCapability("models")).toBe(false)
  })

  test("derives bounded provider ids and rejects an unbound node placement", () => {
    expect(nodePlacementProviderId("core")).toBe("core-default")
    expect(nodePlacementProviderId("managed")).toBe("managed-default")
    expect(nodePlacementProviderId("node", "node_01")).toBe("node:node_01")
    expect(() => nodePlacementProviderId("node")).toThrow()
  })

  test("gives revocation and protocol mismatch priority over heartbeat state", () => {
    expect(
      nodeDisplayState({
        state: "revoked",
        online: true,
        protocolMajor: 1,
        expectedProtocolMajor: 2,
      })
    ).toBe("revoked")
    expect(
      nodeDisplayState({
        state: "active",
        online: true,
        protocolMajor: 1,
        expectedProtocolMajor: 2,
      })
    ).toBe("upgrade-required")
    expect(
      nodeDisplayState({
        state: "active",
        online: false,
        protocolMajor: 2,
        expectedProtocolMajor: 2,
      })
    ).toBe("offline")
  })

  test("computes readiness from verified diagnostics instead of container presence", () => {
    expect(
      fullSelfHostReadinessProgress([
        { ready: true },
        { ready: false },
        { ready: true },
      ])
    ).toEqual({ ready: 2, total: 3, percent: 67 })
    expect(fullSelfHostReadinessProgress([])).toEqual({
      ready: 0,
      total: 0,
      percent: 0,
    })
  })
})
