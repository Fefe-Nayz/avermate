import { createHmac, randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { env } from "./env";

/**
 * The few invariants the social feature still enforces.
 *
 * The first iteration of this file was a privacy rulebook — age bands,
 * consent ledgers, policy digests, k-anonymity thresholds. The feature it
 * protected was unusable, so the rulebook went with it. What remains is the
 * arithmetic of identity: pair canonicalisation, handle normalisation, and
 * opaque invitation tokens of which only a hash is ever stored.
 */

export const FRIEND_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const GROUP_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function canonicalPair(left: string, right: string): [string, string] {
  if (left === right) {
    throw new ORPCError("BAD_REQUEST", {
      message: "An account cannot target itself",
    });
  }
  return left < right ? [left, right] : [right, left];
}

export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function hashOpaque(value: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(value.trim().toLowerCase(), "utf8")
    .digest("hex");
}

export function issueOpaqueToken(bytes = 32): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = randomBytes(bytes).toString("base64url");
  return {
    token,
    tokenHash: hashOpaque(token),
    tokenPrefix: token.slice(0, 8),
  };
}
