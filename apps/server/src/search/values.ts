import { createHash } from "node:crypto";
import type { SourceLocatorV1 } from "@avermate/agent-contracts";

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function referenceKey(input: {
  sourceVersionId: string;
  chunkId: string | null;
  locatorSchemaVersion: 1;
  locator: SourceLocatorV1;
}) {
  return sha256(
    canonicalJson([
      input.sourceVersionId,
      input.chunkId ?? "",
      input.locatorSchemaVersion,
      input.locator,
    ]),
  );
}

/** Search normalization only; immutable source text remains byte-for-byte exact. */
export function normalizeForSearch(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function estimateTokens(value: string) {
  if (!value) return 0;
  // Explicit estimate, never presented as a provider/model token count.
  return Math.max(1, Math.ceil(utf8Size(value) / 4));
}

export function isoFromSqlite(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid stored timestamp");
  return new Date(number * 1_000).toISOString();
}

export function jsonValue<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}
