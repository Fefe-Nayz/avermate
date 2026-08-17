import { afterEach, describe, expect, it } from "bun:test"
import { randomId } from "./id"

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const realCrypto = globalThis.crypto

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: realCrypto,
    configurable: true,
    writable: true,
  })
})

function useCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  })
}

describe("randomId", () => {
  it("uses randomUUID where it exists", () => {
    expect(randomId()).toMatch(UUID_V4)
  })

  it("still works without randomUUID, which is every insecure context", () => {
    // Exactly what a phone sees at http://192.168.1.29:3000: getRandomValues is
    // there, randomUUID is not.
    useCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })

    const ids = new Set(Array.from({ length: 500 }, () => randomId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })

  it("still returns distinct ids with no Web Crypto at all", () => {
    useCrypto(undefined)

    const ids = new Set(Array.from({ length: 500 }, () => randomId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })
})
