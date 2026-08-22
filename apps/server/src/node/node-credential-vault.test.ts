import { describe, expect, test } from "bun:test";
import { NodeCredentialVault } from "./node-credential-vault";

describe("NodeCredentialVault", () => {
  test("separates authentication hashes from context-bound sealed delivery", () => {
    const vault = new NodeCredentialVault("master-secret-".repeat(4));
    const credential = vault.generate();
    const hash = vault.hash(credential);
    const sealed = vault.seal(credential, "node-1:relay:1");
    expect(hash).not.toContain(credential);
    expect(sealed).not.toContain(credential);
    expect(vault.matches(credential, hash)).toBe(true);
    expect(vault.open(sealed, "node-1:relay:1")).toBe(credential);
    expect(() => vault.open(sealed, "node-2:relay:1")).toThrow(
      "NODE_CREDENTIAL_SEALED_VALUE_INVALID",
    );
  });
});
