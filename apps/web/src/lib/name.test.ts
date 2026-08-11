import { describe, expect, test } from "bun:test"
import { initialsOf } from "./name"

describe("initialsOf", () => {
  test("uses at most the first two non-empty name parts", () => {
    expect(initialsOf("  Ada   Lovelace Byron ")).toBe("AL")
    expect(initialsOf("Avermate")).toBe("A")
    expect(initialsOf("   ")).toBe("")
  })
})
