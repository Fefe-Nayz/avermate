export type SocialInvitationKind = "friend" | "group"

export type SocialInvitationSecret = {
  kind: SocialInvitationKind
  token: string
}

export const GUARDIAN_CONSENT_HANDOFF_KEY = "avermate:guardian-consent-handoff"

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
const HANDOFF_MAX_AGE_MS = 2 * 60 * 60 * 1_000
const HANDOFF_CLOCK_SKEW_MS = 60 * 1_000

function validHandoffTimestamp(createdAt: unknown, now: number): boolean {
  return (
    typeof createdAt === "number" &&
    Number.isFinite(createdAt) &&
    createdAt <= now + HANDOFF_CLOCK_SKEW_MS &&
    createdAt >= now - HANDOFF_MAX_AGE_MS
  )
}

export function validOpaqueSocialToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value)
}

export function validSocialInvitationSecret(
  value: unknown
): value is SocialInvitationSecret {
  if (!value || typeof value !== "object") return false
  const candidate = value as { kind?: unknown; token?: unknown }
  return Boolean(
    (candidate.kind === "friend" || candidate.kind === "group") &&
    validOpaqueSocialToken(candidate.token)
  )
}

export function parseGuardianConsentFragment(fragment: string): string | null {
  const value = fragment.startsWith("#") ? fragment.slice(1) : fragment
  const token = new URLSearchParams(value).get("token")
  return validOpaqueSocialToken(token) ? token : null
}

/** URL fragments are client-only and never enter HTTP requests or referrers. */
export function parseSocialInvitationFragment(
  fragment: string
): SocialInvitationSecret | null {
  const value = fragment.startsWith("#") ? fragment.slice(1) : fragment
  const params = new URLSearchParams(value)
  const candidate = {
    kind: params.get("kind"),
    token: params.get("token"),
  }
  return validSocialInvitationSecret(candidate) ? candidate : null
}

export function serializeSocialInvitationHandoff(
  invitation: SocialInvitationSecret,
  createdAt = Date.now()
): string {
  return JSON.stringify({ version: 1, createdAt, ...invitation })
}

export function parseSocialInvitationHandoff(
  value: string | null,
  now = Date.now()
): SocialInvitationSecret | null {
  if (!value || value.length > 512) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const candidate = parsed as {
      version?: unknown
      createdAt?: unknown
      kind?: unknown
      token?: unknown
    }
    if (
      candidate.version !== 1 ||
      !validHandoffTimestamp(candidate.createdAt, now)
    ) {
      return null
    }
    return validSocialInvitationSecret(candidate)
      ? { kind: candidate.kind, token: candidate.token }
      : null
  } catch {
    return null
  }
}

export function serializeGuardianConsentHandoff(
  token: string,
  createdAt = Date.now()
): string | null {
  if (!validOpaqueSocialToken(token)) return null
  return JSON.stringify({ version: 1, createdAt, token })
}

export function parseGuardianConsentHandoff(
  value: string | null,
  now = Date.now()
): string | null {
  if (!value || value.length > 512) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const candidate = parsed as {
      version?: unknown
      createdAt?: unknown
      token?: unknown
    }
    if (
      candidate.version !== 1 ||
      !validHandoffTimestamp(candidate.createdAt, now)
    ) {
      return null
    }
    return validOpaqueSocialToken(candidate.token) ? candidate.token : null
  } catch {
    return null
  }
}

export function socialInvitationFromLegacyPath(
  value: string | null
): SocialInvitationSecret | null {
  if (!value || value.length > 512) return null
  const friendPrefix = "/social/friends/invitations/"
  const groupPrefix = "/social/invitations/"
  const kind = value.startsWith(friendPrefix)
    ? "friend"
    : value.startsWith(groupPrefix)
      ? "group"
      : null
  if (!kind) return null
  const encoded = value.slice(
    kind === "friend" ? friendPrefix.length : groupPrefix.length
  )
  try {
    const candidate = { kind, token: decodeURIComponent(encoded) }
    return validSocialInvitationSecret(candidate) ? candidate : null
  } catch {
    return null
  }
}
