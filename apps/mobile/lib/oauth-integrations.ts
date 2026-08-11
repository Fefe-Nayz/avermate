export const AVERMATE_OAUTH_SCOPES = [
  "avermate:read",
  "avermate:write",
  "avermate:delete",
  "avermate:admin",
] as const;

export type AvermateOAuthScope = (typeof AVERMATE_OAUTH_SCOPES)[number];

/** Identity-scoped because both lists contain private account metadata. */
export function oauthIntegrationQueryKeys(owner: string) {
  return {
    clients: ["oauth-integration-clients", owner] as const,
    consents: ["oauth-integration-consents", owner] as const,
  };
}

/**
 * Better Auth public/native registration. Deliberately has no secret field:
 * installed assistants authenticate the authorization code with PKCE S256.
 */
export function publicClientRegistration(input: {
  name: string;
  redirectUri: string;
  scopes: Iterable<string>;
}) {
  const requested = new Set(input.scopes);
  requested.add("avermate:read");
  const scopes = AVERMATE_OAUTH_SCOPES.filter((scope) => requested.has(scope));
  const grantTypes: ("authorization_code" | "refresh_token")[] = [
    "authorization_code",
    "refresh_token",
  ];
  const responseTypes: "code"[] = ["code"];

  return {
    client_name: input.name.trim(),
    redirect_uris: [input.redirectUri.trim()],
    token_endpoint_auth_method: "none" as const,
    grant_types: grantTypes,
    response_types: responseTypes,
    type: "native" as const,
    scope: ["openid", "profile", "offline_access", ...scopes].join(" "),
  };
}
