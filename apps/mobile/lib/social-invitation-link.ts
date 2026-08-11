import type { SocialInvitationKind } from "./social-invitation-session";

export interface SocialInvitationSecret {
  kind: SocialInvitationKind;
  token: string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export function parseSocialInvitationFragment(
  fragment: string,
): SocialInvitationSecret | null {
  const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(value);
  const kind = params.get("kind");
  const token = params.get("token");
  if (
    (kind !== "friend" && kind !== "group") ||
    !token ||
    !TOKEN_PATTERN.test(token)
  ) {
    return null;
  }
  return { kind, token };
}

export function socialInvitationFragment(
  invitation: SocialInvitationSecret,
): string {
  if (!TOKEN_PATTERN.test(invitation.token)) {
    throw new Error("Invalid opaque invitation token");
  }
  return `#kind=${invitation.kind}&token=${encodeURIComponent(invitation.token)}`;
}

export function fragmentFromInvitationUrl(url: string | null): string {
  if (!url) return "";
  const index = url.indexOf("#");
  return index >= 0 ? url.slice(index) : "";
}
