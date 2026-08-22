import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ProviderFetch, ProviderLookup } from "../sync/provider-network";
import type { ContentConnection } from "./onedrive";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:5000";
process.env.BETTER_AUTH_SECRET =
  "onedrive-test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.ONEDRIVE_CLIENT_ID = "onedrive-client";
process.env.ONEDRIVE_CLIENT_SECRET = "onedrive-secret";
process.env.ONEDRIVE_TENANT_ID = "common";
process.env.ONEDRIVE_REDIRECT_URI =
  "http://localhost:5000/api/connectors/onedrive/callback";

const publicLookup: ProviderLookup = async () => [
  { address: "8.8.8.8", family: 4 },
];

describe("OneDrive connector boundary", () => {
  test("creates a one-use state and an S256 authorization URL", async () => {
    const { createOneDriveAuthorization, oneDriveOauthStateHash } =
      await import("./onedrive");
    const authorization = createOneDriveAuthorization();
    const url = new URL(authorization.url);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("state")).toBe(authorization.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(authorization.verifier, "ascii")
        .digest("base64url"),
    );
    expect(authorization.url).not.toContain(authorization.verifier);
    expect(oneDriveOauthStateHash(authorization.state)).toHaveLength(64);
  });

  test("compares webhook clientState through its digest", async () => {
    const {
      matchesOneDriveWebhookSecret,
      newOneDriveWebhookClientState,
      oneDriveWebhookSecretHash,
    } = await import("./onedrive");
    const clientState = newOneDriveWebhookClientState();
    const digest = oneDriveWebhookSecretHash(clientState);
    expect(matchesOneDriveWebhookSecret(clientState, digest)).toBeTrue();
    expect(matchesOneDriveWebhookSecret(`${clientState}x`, digest)).toBeFalse();
    expect(
      matchesOneDriveWebhookSecret(clientState, "not-a-digest"),
    ).toBeFalse();
  });

  test("exchanges the code with the sealed PKCE verifier and resolves account identity", async () => {
    const { env } = await import("./env");
    const configuredSecret =
      env.ONEDRIVE_CLIENT_SECRET ?? env.MICROSOFT_CLIENT_SECRET;
    expect(configuredSecret).toBeTruthy();
    const configuredSecretDigest = createHash("sha256")
      .update(configuredSecret!)
      .digest("hex");
    const requests: string[] = [];
    const fetch: ProviderFetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      if (url.hostname === "login.microsoftonline.com") {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBe("pkce-verifier");
        expect(
          createHash("sha256")
            .update(body.get("client_secret") ?? "")
            .digest("hex"),
        ).toBe(configuredSecretDigest);
        return Response.json({
          access_token: "access-token",
          expires_in: 3_600,
          refresh_token: "refresh-token",
          scope: "Files.Read User.Read offline_access",
        });
      }
      if (url.pathname === "/v1.0/me") {
        return Response.json({
          id: "account-1",
          displayName: "Ada",
          mail: "ada@example.test",
          userPrincipalName: "ada@example.test",
        });
      }
      if (url.pathname === "/v1.0/me/drive") {
        return Response.json({ id: "drive-1", driveType: "personal" });
      }
      return new Response(null, { status: 404 });
    };
    const { exchangeOneDriveAuthorizationCode } = await import("./onedrive");
    const result = await exchangeOneDriveAuthorizationCode(
      "authorization-code",
      "pkce-verifier",
      {
        fetch,
        lookup: publicLookup,
        now: () => new Date("2026-08-21T10:00:00.000Z"),
      },
    );
    expect(result.accountLabel).toBe("ada@example.test");
    expect(result.credentials).toMatchObject({
      accountId: "account-1",
      driveId: "drive-1",
      refreshToken: "refresh-token",
    });
    expect(requests).toHaveLength(3);
  });

  test("bounds and follows Graph browse pages without exposing credentials", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetch: ProviderFetch = async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      calls.push({
        url: url.toString(),
        authorization: headers.get("authorization"),
      });
      if (url.searchParams.get("page") === "2") {
        return Response.json({
          value: [
            {
              id: "file-1",
              name: "Cours.pdf",
              file: { mimeType: "application/pdf" },
            },
          ],
        });
      }
      return Response.json({
        value: [
          { id: "folder-1", name: "Physique", folder: { childCount: 3 } },
        ],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/drive/root/children?page=2",
      });
    };
    const {
      browseOneDrive,
      normalizeOneDriveFolderScope,
      sealOneDriveCredentials,
    } = await import("./onedrive");
    const connection: ContentConnection = {
      id: "connection-1",
      provider: "onedrive",
      accountLabel: "Ada",
      status: "connected",
      cursor: null,
      subscriptionId: null,
      subscriptionResourceId: null,
      subscriptionExpiresAt: null,
      lastSyncedAt: null,
      lastError: null,
      scopeJson: { folderIds: [] },
      syncRevision: 0,
      syncRequestedGeneration: 0,
      syncActiveJobId: null,
      sealedCredentials: sealOneDriveCredentials({
        version: 1,
        accessToken: "access-token",
        accessTokenExpiresAt: Date.now() + 60 * 60_000,
        refreshToken: "refresh-token",
        scope: "Files.Read",
        accountId: "account-1",
        driveId: "drive-1",
      }),
      webhookSecretHash: null,
      yearId: "year-1",
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const rows = await browseOneDrive(connection, undefined, {
      fetch,
      lookup: publicLookup,
    });
    expect(rows).toEqual([
      { id: "folder-1", name: "Physique", kind: "folder", childCount: 3 },
      { id: "file-1", name: "Cours.pdf", kind: "file" },
    ]);
    expect(calls).toHaveLength(2);
    expect(
      calls.every((call) => call.authorization === "Bearer access-token"),
    ).toBeTrue();

    const parentById = new Map<string, string | null>([
      ["selected-parent", "drive-root"],
      ["selected-grandchild", "middle"],
      ["middle", "selected-parent"],
      ["drive-root", null],
    ]);
    const normalized = await normalizeOneDriveFolderScope(
      connection,
      ["selected-grandchild", "selected-parent", "selected-parent"],
      {
        lookup: publicLookup,
        fetch: async (input) => {
          const match = new URL(String(input)).pathname.match(
            /\/items\/([^/]+)$/,
          );
          const id = decodeURIComponent(match?.[1] ?? "");
          const parentId = parentById.get(id);
          return Response.json({
            id,
            name: id,
            folder: { childCount: 0 },
            ...(parentId ? { parentReference: { id: parentId } } : {}),
          });
        },
      },
    );
    expect(normalized).toEqual(["selected-parent"]);
  });

  test("rejects an untrusted restart location for an expired delta cursor", async () => {
    const fetch: ProviderFetch = async () =>
      new Response(null, {
        status: 410,
        headers: {
          location: "https://attacker.example.test/stolen-delta-token",
        },
      });
    const { readOneDriveDeltaPage, sealOneDriveCredentials } =
      await import("./onedrive");
    const connection: ContentConnection = {
      id: "connection-expired-delta",
      provider: "onedrive",
      accountLabel: "Ada",
      status: "connected",
      cursor: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=old",
      subscriptionId: null,
      subscriptionResourceId: null,
      subscriptionExpiresAt: null,
      lastSyncedAt: null,
      lastError: null,
      scopeJson: { folderIds: [] },
      syncRevision: 0,
      syncRequestedGeneration: 0,
      syncActiveJobId: null,
      sealedCredentials: sealOneDriveCredentials({
        version: 1,
        accessToken: "access-token",
        accessTokenExpiresAt: Date.now() + 60 * 60_000,
        refreshToken: "refresh-token",
        scope: "Files.Read",
        accountId: "account-1",
        driveId: "drive-1",
      }),
      webhookSecretHash: null,
      yearId: "year-1",
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await expect(
      readOneDriveDeltaPage(connection, connection.cursor, {
        fetch,
        lookup: publicLookup,
      }),
    ).rejects.toThrow("unsafe continuation URL");
  });

  test("does not forward the Graph bearer token to a preauthenticated download host", async () => {
    const authorizationByHost = new Map<string, string | null>();
    const fetch: ProviderFetch = async (input, init) => {
      const url = new URL(String(input));
      authorizationByHost.set(
        url.hostname,
        new Headers(init?.headers).get("authorization"),
      );
      if (url.hostname === "graph.microsoft.com") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://download.example.test/file" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    };
    const { downloadOneDriveItem, sealOneDriveCredentials } =
      await import("./onedrive");
    const connection: ContentConnection = {
      id: "connection-1",
      provider: "onedrive",
      accountLabel: "Ada",
      status: "connected",
      cursor: null,
      subscriptionId: null,
      subscriptionResourceId: null,
      subscriptionExpiresAt: null,
      lastSyncedAt: null,
      lastError: null,
      scopeJson: { folderIds: [] },
      syncRevision: 0,
      syncRequestedGeneration: 0,
      syncActiveJobId: null,
      sealedCredentials: sealOneDriveCredentials({
        version: 1,
        accessToken: "access-token",
        accessTokenExpiresAt: Date.now() + 60 * 60_000,
        refreshToken: "refresh-token",
        scope: "Files.Read",
        accountId: "account-1",
        driveId: "drive-1",
      }),
      webhookSecretHash: null,
      yearId: "year-1",
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const download = await downloadOneDriveItem(connection, "file-1", {
      fetch,
      lookup: publicLookup,
    });
    expect(download.contentLength).toBe(3);
    expect(authorizationByHost.get("graph.microsoft.com")).toBe(
      "Bearer access-token",
    );
    expect(authorizationByHost.get("download.example.test")).toBeNull();
    await download.body.cancel();
  });
});
