import { describe, expect, test } from "bun:test";
import {
  oauthIntegrationQueryKeys,
  publicClientRegistration,
} from "./oauth-integrations";

describe("native OAuth integration registration", () => {
  test("creates only a public PKCE-capable client and never a secret", () => {
    const body = publicClientRegistration({
      name: "  My assistant  ",
      redirectUri: "  http://127.0.0.1:8765/callback  ",
      scopes: ["avermate:write", "not-an-avermate-scope"],
    });

    expect(body).toEqual({
      client_name: "My assistant",
      redirect_uris: ["http://127.0.0.1:8765/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      type: "native",
      scope: "openid profile offline_access avermate:read avermate:write",
    });
    expect("client_secret" in body).toBe(false);
  });

  test("keeps private integration lists isolated by account", () => {
    expect(oauthIntegrationQueryKeys("user:a").clients).not.toEqual(
      oauthIntegrationQueryKeys("user:b").clients,
    );
    expect(oauthIntegrationQueryKeys("user:a").consents).toEqual([
      "oauth-integration-consents",
      "user:a",
    ]);
  });
});
