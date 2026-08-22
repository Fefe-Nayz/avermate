import {
  createHash,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export type ProtocolSigningIdentity = {
  keyId: string;
  privateKey: KeyObject;
};

export function canonicalProtocolJson(value: unknown): string {
  const seen = new Set<object>();
  const visit = (current: unknown): string => {
    if (current === null) return "null";
    if (typeof current === "string") return JSON.stringify(current);
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new TypeError("non-finite JSON number");
      return Object.is(current, -0) ? "0" : JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new TypeError(
        `value of type ${typeof current} is not canonical JSON`,
      );
    }
    if (seen.has(current)) throw new TypeError("cyclic JSON value");
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.keys(current).length !== current.length) {
          throw new TypeError(
            "sparse or decorated arrays are not canonical JSON",
          );
        }
        return `[${current.map(visit).join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("only plain JSON objects can be canonicalized");
      }
      const object = current as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(object[key])}`)
        .join(",")}}`;
    } finally {
      seen.delete(current);
    }
  };
  return visit(value);
}

export function protocolDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalProtocolJson(value))
    .digest("hex")}`;
}

export function signProtocolValue(
  identity: ProtocolSigningIdentity,
  value: unknown,
) {
  return sign(
    null,
    Buffer.from(canonicalProtocolJson(value)),
    identity.privateKey,
  ).toString("base64url");
}

export function verifyProtocolValue(
  publicKeyDer: string,
  value: unknown,
  signature: string,
) {
  try {
    return verify(
      null,
      Buffer.from(canonicalProtocolJson(value)),
      createPublicKey({
        key: Buffer.from(publicKeyDer, "base64url"),
        type: "spki",
        format: "der",
      }),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
