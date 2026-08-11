import {
  OAuthError,
  OAuthErrorCode,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  originValidationResponse,
  requireBearerAuth,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import {
  auth,
  MCP_SCOPES,
  mcpResourceUrl,
  oauthIssuer,
  type AuthSession,
  type AuthUser,
} from "../lib/auth";
import type { Context } from "../lib/context";
import { env, isProduction } from "../lib/env";
import { isSuspensionActive } from "../lib/access-policy";

const resourceClient = oauthProviderResourceClient(auth).getActions();
const resourceUrl = new URL(mcpResourceUrl);
const localJwksCacheKey = {};

export const mcpResourceMetadataUrl =
  getOAuthProtectedResourceMetadataUrl(resourceUrl);

function values(raw: string | undefined): string[] {
  return (
    raw
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? []
  );
}

function hostname(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return (
      value
        .replace(/^\[/, "")
        .replace(/\](:\d+)?$/, "")
        .split(":")[0] ?? value
    );
  }
}

const allowedHostnames = [
  resourceUrl.hostname,
  ...values(env.MCP_ALLOWED_HOSTS).map(hostname),
  ...(!isProduction ? ["localhost", "127.0.0.1", "::1"] : []),
];

const allowedOriginHostnames = [
  resourceUrl.hostname,
  new URL(env.CLIENT_URL).hostname,
  ...values(env.MCP_ALLOWED_ORIGINS).map(hostname),
  ...(!isProduction ? ["localhost", "127.0.0.1", "::1"] : []),
];

function scopesOf(payload: Record<string, unknown>): string[] {
  const scope = payload.scope;
  if (typeof scope === "string") return scope.split(/\s+/).filter(Boolean);
  return Array.isArray(scope)
    ? scope.filter((value): value is string => typeof value === "string")
    : [];
}

const verifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      // The authorization server lives in this process. Reading its public
      // keys directly avoids a fragile server-to-self HTTP request while
      // retaining asymmetric JWT, issuer and audience verification.
      const payload = await verifyJwsAccessToken(token, {
        jwksFetch: async () => auth.api.getJwks(),
        jwksCacheKey: localJwksCacheKey,
        verifyOptions: { audience: mcpResourceUrl, issuer: oauthIssuer },
      });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.azp !== "string" ||
        typeof payload.exp !== "number"
      ) {
        throw new Error("Required OAuth access-token claims are missing");
      }

      const [user] = await db
        .select({
          id: users.id,
          emailVerified: users.emailVerified,
          banned: users.banned,
          banExpires: users.banExpires,
        })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      if (!user || !user.emailVerified || isSuspensionActive(user)) {
        throw new Error("The account is unavailable");
      }

      return {
        token,
        clientId: payload.azp,
        scopes: scopesOf(payload),
        expiresAt: payload.exp,
        resource: resourceUrl,
        extra: {
          userId: payload.sub,
          ...(typeof payload.sid === "string"
            ? { sessionId: payload.sid }
            : {}),
        },
      };
    } catch (error) {
      if (OAuthError.isInstance(error)) throw error;
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "The access token is invalid or expired",
      );
    }
  },
};

const requireMcpBearer = requireBearerAuth({
  verifier,
  requiredScopes: ["avermate:read"],
  resourceMetadataUrl: mcpResourceMetadataUrl,
});

export function validateMcpRequestOrigin(
  request: Request,
): Response | undefined {
  return (
    hostHeaderValidationResponse(request, allowedHostnames) ??
    originValidationResponse(request, allowedOriginHostnames)
  );
}

export async function authenticateMcpRequest(
  request: Request,
): Promise<AuthInfo | Response> {
  return requireMcpBearer(request);
}

/** Build the exact protected-resource document from Better Auth's live config. */
export async function mcpProtectedResourceMetadata() {
  return resourceClient.getProtectedResourceMetadata({
    resource: mcpResourceUrl,
    authorization_servers: [oauthIssuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Avermate MCP",
    resource_documentation: `${env.CLIENT_URL}/settings/integrations`,
  });
}

export interface McpPrincipal {
  userId: string;
  clientId: string;
  scopes: ReadonlySet<string>;
  context: Context;
}

export async function principalFromAuth(
  request: Request,
  authInfo: AuthInfo,
): Promise<McpPrincipal> {
  const userId = authInfo.extra?.userId;
  if (typeof userId !== "string") {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Missing token subject");
  }

  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || !row.emailVerified || isSuspensionActive(row)) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Account unavailable");
  }

  const now = new Date();
  const user: AuthUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.avatarUrl,
    role: row.role,
    banned: row.banned,
    banReason: row.banReason,
    banExpires: row.banExpires,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  const session: AuthSession = {
    id:
      typeof authInfo.extra?.sessionId === "string"
        ? authInfo.extra.sessionId
        : `mcp:${authInfo.clientId}`,
    token: authInfo.token,
    userId,
    expiresAt: new Date((authInfo.expiresAt ?? 0) * 1000),
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: request.headers.get("user-agent"),
    impersonatedBy: null,
  };

  return {
    userId,
    clientId: authInfo.clientId,
    scopes: new Set(authInfo.scopes),
    context: { headers: request.headers, session: { user, session } },
  };
}
