import { describe, expect, test } from "bun:test"
import { paneStatus, readinessDestination } from "./assistant-pane-status"

const ready = {
  deleted: false,
  modelCount: 2,
  online: true,
  error: null,
  unavailable: [],
}

describe("conversation pane status", () => {
  test("says nothing when there is nothing to say", () => {
    expect(paneStatus(ready)).toEqual({ notice: null, canSend: true })
  })

  test("says one thing at a time, most fundamental first", () => {
    // All four conditions at once. The pane used to stack three alerts and
    // fill the screen before the first message; the order is the whole point.
    const everything = {
      deleted: true,
      modelCount: 0,
      online: false,
      error: "Send failed",
      unavailable: [],
    }
    expect(paneStatus(everything).notice?.kind).toBe("deleted")
    expect(paneStatus({ ...everything, deleted: false }).notice?.kind).toBe(
      "no-model"
    )
    expect(
      paneStatus({ ...everything, deleted: false, modelCount: 1 }).notice?.kind
    ).toBe("offline")
    expect(
      paneStatus({
        ...everything,
        deleted: false,
        modelCount: 1,
        online: true,
      }).notice?.kind
    ).toBe("error")
  })

  test("does not repeat itself: offline outranks the error it caused", () => {
    const offline = { ...ready, online: false, error: "Send failed" }
    expect(paneStatus(offline).notice).toEqual({ kind: "offline" })
  })

  test("refuses sending for each blocking reason, and only those", () => {
    expect(paneStatus({ ...ready, deleted: true }).canSend).toBe(false)
    expect(paneStatus({ ...ready, modelCount: 0 }).canSend).toBe(false)
    expect(paneStatus({ ...ready, online: false }).canSend).toBe(false)
    // An error is about the last attempt, not about the next one.
    expect(paneStatus({ ...ready, error: "Send failed" }).canSend).toBe(true)
  })

  test("collects each distinct unavailability reason once", () => {
    const status = paneStatus({
      ...ready,
      modelCount: 0,
      unavailable: [
        { unavailableReason: "quota-denied" },
        { unavailableReason: "quota-denied" },
        { unavailableReason: null },
        { unavailableReason: "node-offline" },
      ],
    })
    expect(status.notice).toEqual({
      kind: "no-model",
      reasons: ["quota-denied", "node-offline"],
    })
  })
})

describe("readiness destination", () => {
  test("sends a Node problem to the Node page, not to providers", () => {
    // Ranked rather than counted: three quota reasons do not outvote one
    // offline Node, because they are different errands.
    expect(
      readinessDestination(["quota-denied", "quota-denied", "node-offline"])
        .kind
    ).toBe("node")
  })

  test("separates a managed problem from a missing key", () => {
    expect(readinessDestination(["managed-disabled"]).kind).toBe("managed")
    expect(readinessDestination([]).kind).toBe("providers")
  })
})
