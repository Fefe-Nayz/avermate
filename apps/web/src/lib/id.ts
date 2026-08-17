/**
 * A random identifier that exists outside a secure context.
 *
 * `crypto.randomUUID()` is gated on a secure context. `localhost` counts as one,
 * so it works all day on a development machine — and then throws
 * "crypto.randomUUID is not a function" the moment the same build is opened from
 * a phone at `http://192.168.1.29:3000`, which is how every LAN test is done.
 * Creating a year or a period crashed there and nowhere else.
 *
 * `crypto.getRandomValues()` carries no such restriction, so the fallback is
 * still real randomness rather than a timestamp with a counter bolted on. The
 * shape is a v4 UUID either way, because these strings end up as React keys,
 * idempotency keys and local draft ids that are compared and logged.
 */
export function randomId(): string {
  const api = globalThis.crypto as Crypto | undefined

  if (typeof api?.randomUUID === "function") return api.randomUUID()

  if (typeof api?.getRandomValues === "function") {
    const bytes = api.getRandomValues(new Uint8Array(16))
    // Version 4, variant 1 — the two fields a v4 UUID pins.
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-")
  }

  // No Web Crypto at all: not a browser this app supports, but a key collision
  // is a worse failure than a weak key, so it still returns something unique
  // enough to tell two rows of a list apart.
  const random = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0")
  return [
    `${random()}${random()}`,
    random(),
    `4${random().slice(1)}`,
    ((Math.floor(Math.random() * 4) + 8).toString(16) +
      random().slice(1)) as string,
    `${random()}${random()}${random()}`,
  ].join("-")
}
