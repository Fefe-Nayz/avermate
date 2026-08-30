import { createHash } from "node:crypto";
import { canonicalCapabilityJson } from "@avermate/agent-contracts";

export function capabilityDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalCapabilityJson(value))
    .digest("hex")}`;
}

export function capabilityJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export function capabilityIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const numeric = Number(value);
  return new Date(
    Number.isFinite(numeric) && numeric < 10_000_000_000
      ? numeric * 1_000
      : numeric,
  ).toISOString();
}

export function capabilityEpoch(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}
