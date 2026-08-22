import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ProviderFetch, ProviderLookup } from "../sync/provider-network";
import type { ContentConnection } from "./googledrive";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:5000";
process.env.BETTER_AUTH_SECRET =
  "googledrive-test-secret-that-is-at-least-32-characters";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.GOOGLE_DRIVE_CLIENT_ID = "google-drive-client";
process.env.GOOGLE_DRIVE_CLIENT_SECRET = "google-drive-secret";
process.env.GOOGLE_DRIVE_REDIRECT_URI =
  "http://localhost:5000/api/connectors/googledrive/callback";
process.env.GOOGLE_DRIVE_WEBHOOK_URL =
  "https://api.example.test/api/webhooks/google-drive";

const publicLookup: ProviderLookup = async () => [
  { address: "8.8.8.8", family: 4 },
];

async function connection(): Promise<ContentConnection> {
  const { sealGoogleDriveCredentials } = await import("./googledrive");
  return {
    id: "connection-1",
    provider: "googledrive",
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
    sealedCredentials: sealGoogleDriveCredentials({
      version: 1,
      accessToken: "access-token",
      accessTokenExpiresAt: Date.now() + 60 * 60_000,
      refreshToken: "refresh-token",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      accountId: "permission-1",
    }),
    webhookSecretHash: null,
    yearId: "year-1",
    userId: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("Google Drive connector boundary", () => {
  test("creates a one-use state, S256 PKCE and exact read-only scope", async () => {
    const { createGoogleDriveAuthorization, googleDriveOauthStateHash } =
      await import("./googledrive");
    const authorization = createGoogleDriveAuthorization();
    const url = new URL(authorization.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("state")).toBe(authorization.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(authorization.verifier, "ascii")
        .digest("base64url"),
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toContain("consent");
    expect(authorization.url).not.toContain(authorization.verifier);
    expect(googleDriveOauthStateHash(authorization.state)).toHaveLength(64);
  });

  test("exchanges the sealed verifier and resolves a stable Drive account", async () => {
    const requests: string[] = [];
    const configuredSecretDigest = createHash("sha256")
      .update(process.env.GOOGLE_DRIVE_CLIENT_SECRET!)
      .digest("hex");
    const fetch: ProviderFetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      if (url.origin === "https://oauth2.googleapis.com") {
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
          scope: "https://www.googleapis.com/auth/drive.readonly",
        });
      }
      if (url.pathname === "/drive/v3/about") {
        return Response.json({
          user: {
            displayName: "Ada",
            emailAddress: "ada@example.test",
            permissionId: "permission-1",
          },
        });
      }
      return new Response(null, { status: 404 });
    };
    const { exchangeGoogleDriveAuthorizationCode } =
      await import("./googledrive");
    const result = await exchangeGoogleDriveAuthorizationCode(
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
      accountId: "permission-1",
      refreshToken: "refresh-token",
    });
    expect(requests).toHaveLength(2);
  });

  test("browses My Drive, shared roots and Shared with me without selecting the virtual root", async () => {
    const fetch: ProviderFetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/drive/v3/drives") {
        return Response.json({
          drives: [{ id: "shared-drive-1", name: "Classe" }],
        });
      }
      if (url.pathname === "/drive/v3/files") {
        const query = url.searchParams.get("q") ?? "";
        if (query.includes("sharedWithMe")) {
          return Response.json({
            files: [
              {
                id: "shared-folder",
                name: "Cours partagés",
                mimeType: "application/vnd.google-apps.folder",
              },
            ],
          });
        }
        return Response.json({
          files: [
            {
              id: "my-folder",
              name: "Physique",
              mimeType: "application/vnd.google-apps.folder",
            },
            {
              id: "my-file",
              name: "Cours.pdf",
              mimeType: "application/pdf",
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    };
    const { browseGoogleDrive, GOOGLE_DRIVE_SHARED_WITH_ME_ROOT } =
      await import("./googledrive");
    const source = await connection();
    const root = await browseGoogleDrive(source, undefined, {
      fetch,
      lookup: publicLookup,
    });
    expect(root).toContainEqual({
      id: GOOGLE_DRIVE_SHARED_WITH_ME_ROOT,
      name: "Shared with me",
      kind: "folder",
      selectable: false,
    });
    expect(root).toContainEqual({
      id: "shared-drive-1",
      name: "Classe",
      kind: "folder",
      selectable: true,
    });
    expect(root).toContainEqual({
      id: "my-folder",
      name: "Physique",
      kind: "folder",
    });
    expect(
      await browseGoogleDrive(source, GOOGLE_DRIVE_SHARED_WITH_ME_ROOT, {
        fetch,
        lookup: publicLookup,
      }),
    ).toEqual([
      { id: "shared-folder", name: "Cours partagés", kind: "folder" },
    ]);
  });

  test("validates folders and collapses ancestor plus descendant to an antichain", async () => {
    const parentById = new Map<string, string | null>([
      ["selected-parent", "root"],
      ["selected-grandchild", "middle"],
      ["middle", "selected-parent"],
      ["root", null],
    ]);
    const fetch: ProviderFetch = async (input) => {
      const url = new URL(String(input));
      const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const parent = parentById.get(id);
      return Response.json({
        id,
        name: id,
        mimeType: "application/vnd.google-apps.folder",
        ...(parent ? { parents: [parent] } : {}),
      });
    };
    const {
      GOOGLE_DRIVE_SHARED_WITH_ME_ROOT,
      normalizeGoogleDriveFolderScope,
    } = await import("./googledrive");
    const source = await connection();
    expect(
      await normalizeGoogleDriveFolderScope(
        source,
        ["selected-grandchild", "selected-parent", "selected-parent"],
        { fetch, lookup: publicLookup },
      ),
    ).toEqual(["selected-parent"]);
    await expect(
      normalizeGoogleDriveFolderScope(
        source,
        [GOOGLE_DRIVE_SHARED_WITH_ME_ROOT],
        { fetch, lookup: publicLookup },
      ),
    ).rejects.toThrow("navigation collection");
  });

  test("maps native Docs and never forwards bearer credentials to a redirect", async () => {
    const authorizationByHost = new Map<string, string | null>();
    const fetch: ProviderFetch = async (input, init) => {
      const url = new URL(String(input));
      authorizationByHost.set(
        url.hostname,
        new Headers(init?.headers).get("authorization"),
      );
      if (url.hostname === "www.googleapis.com") {
        expect(url.pathname).toBe("/drive/v3/files/doc-1/export");
        return new Response(null, {
          status: 302,
          headers: { location: "https://download.example.test/document" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    };
    const { exportGoogleDriveFile, googleDriveExportTarget } =
      await import("./googledrive");
    const target = googleDriveExportTarget(
      "application/vnd.google-apps.document",
    );
    expect(target).toEqual({
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: ".docx",
    });
    const download = await exportGoogleDriveFile(
      await connection(),
      "doc-1",
      target!.mimeType,
      { fetch, lookup: publicLookup },
    );
    expect(download.contentLength).toBe(3);
    expect(authorizationByHost.get("www.googleapis.com")).toBe(
      "Bearer access-token",
    );
    expect(authorizationByHost.get("download.example.test")).toBeNull();
    await download.body.cancel();
  });

  test("accepts shared-drive membership entries without a file id", async () => {
    const fetch: ProviderFetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/drive/v3/changes");
      expect(url.searchParams.get("fields")).toContain("driveId");
      return Response.json({
        changes: [
          {
            changeType: "drive",
            driveId: "shared-drive-1",
          },
          {
            changeType: "file",
            fileId: "file-1",
            file: {
              id: "file-1",
              name: "Cours.pdf",
              mimeType: "application/pdf",
            },
          },
        ],
        newStartPageToken: "cursor-2",
      });
    };
    const { readGoogleDriveChangesPage } = await import("./googledrive");
    const page = await readGoogleDriveChangesPage(
      await connection(),
      "cursor-1",
      { fetch, lookup: publicLookup },
    );
    expect(page.changes[0]).toMatchObject({
      changeType: "drive",
      driveId: "shared-drive-1",
    });
    expect(page.changes[0]?.fileId).toBeUndefined();
    expect(page.newStartPageToken).toBe("cursor-2");
  });

  test("creates a seven-day-bounded changes channel and hashes its token", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const fetch: ProviderFetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/drive/v3/changes/watch");
      expect(url.searchParams.get("pageToken")).toBe("cursor-1");
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        id: requestBody!.id,
        resourceId: "resource-1",
        expiration: String(Date.parse("2026-08-27T10:00:00.000Z")),
      });
    };
    const {
      createGoogleDriveChannel,
      googleDriveWebhookTokenHash,
      matchesGoogleDriveWebhookToken,
    } = await import("./googledrive");
    const result = await createGoogleDriveChannel(
      await connection(),
      "cursor-1",
      "webhook-token",
      {
        fetch,
        lookup: publicLookup,
        now: () => new Date("2026-08-21T10:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      id: expect.any(String),
      resourceId: "resource-1",
    });
    expect(requestBody).toMatchObject({
      type: "web_hook",
      token: "webhook-token",
      address: "https://api.example.test/api/webhooks/google-drive",
    });
    const hash = googleDriveWebhookTokenHash("webhook-token");
    expect(matchesGoogleDriveWebhookToken("webhook-token", hash)).toBeTrue();
    expect(matchesGoogleDriveWebhookToken("spoofed", hash)).toBeFalse();
  });
});
