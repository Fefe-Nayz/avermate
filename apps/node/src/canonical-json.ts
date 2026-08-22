import { createHash } from "node:crypto";

/**
 * RFC 8785/JCS-compatible canonicalization for JSON-domain values. It rejects
 * values that JSON would silently erase so signatures cannot cover a different
 * structure than the one a peer validates.
 */
export function canonicalJson(value: unknown): string {
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
      const record = current as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(record[key])}`)
        .join(",")}}`;
    } finally {
      seen.delete(current);
    }
  };
  return visit(value);
}

export function sha256Digest(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalDigest(value: unknown): `sha256:${string}` {
  return sha256Digest(canonicalJson(value));
}
