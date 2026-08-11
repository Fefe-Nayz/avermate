export type SocialInvitationKind = "friend" | "group";

interface HeldInvitation {
  kind: SocialInvitationKind;
  token: string;
  expiresAt: number;
}

const FLOW_TTL_MS = 30 * 60 * 1_000;
const invitations = new Map<string, HeldInvitation>();

function prune(now: number): void {
  for (const [id, invitation] of invitations) {
    if (invitation.expiresAt <= now) invitations.delete(id);
  }
}

/**
 * Holds a deep-link secret only in process memory while setup is completed.
 * The returned opaque flow id is safe to place in navigation parameters; the
 * invitation token never enters SecureStore, AsyncStorage, logs or analytics.
 */
export function holdSocialInvitation(
  kind: SocialInvitationKind,
  token: string,
  now = Date.now(),
): string {
  prune(now);
  const id = `social_${now.toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  invitations.set(id, { kind, token, expiresAt: now + FLOW_TTL_MS });
  return id;
}

export function peekSocialInvitation(
  id: string | null | undefined,
  now = Date.now(),
): HeldInvitation | null {
  if (!id) return null;
  prune(now);
  return invitations.get(id) ?? null;
}

export function takeSocialInvitation(
  id: string | null | undefined,
  now = Date.now(),
): HeldInvitation | null {
  const invitation = peekSocialInvitation(id, now);
  if (id) invitations.delete(id);
  return invitation;
}

export function discardSocialInvitation(id: string | null | undefined): void {
  if (id) invitations.delete(id);
}

export function socialInvitationPath(invitation: HeldInvitation): string {
  const encoded = encodeURIComponent(invitation.token);
  return `/social/invitation#kind=${invitation.kind}&token=${encoded}`;
}

export function clearHeldSocialInvitations(): void {
  invitations.clear();
}
