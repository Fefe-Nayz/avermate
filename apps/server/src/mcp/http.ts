import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import {
  authenticateMcpRequest,
  mcpProtectedResourceMetadata,
  mcpResourceMetadataUrl,
  principalFromAuth,
  validateMcpRequestOrigin,
  type McpPrincipal,
} from "./auth";
import { createAvermateMcpServer } from "./server";

/** Exposed for protocol tests: one stateless handler, one authenticated principal. */
export function createAvermateMcpHandler(principal: McpPrincipal) {
  return createMcpHandler(() => createAvermateMcpServer(principal), {
    legacy: "reject",
    responseMode: "auto",
    onerror: (error) => console.error("[mcp]", error.message),
  });
}

export async function handleMcp(request: Request): Promise<Response> {
  const rejected = validateMcpRequestOrigin(request);
  if (rejected) return rejected;

  const authInfo = await authenticateMcpRequest(request);
  if (authInfo instanceof Response) return authInfo;

  let principal: McpPrincipal;
  try {
    principal = await principalFromAuth(request, authInfo);
  } catch (error) {
    return bearerAuthChallengeResponse(error, {
      requiredScopes: ["avermate:read"],
      resourceMetadataUrl: mcpResourceMetadataUrl,
    });
  }

  return createAvermateMcpHandler(principal).fetch(request, {
    authInfo: authInfo as AuthInfo,
  });
}

export async function protectedResourceMetadataResponse(): Promise<Response> {
  return Response.json(await mcpProtectedResourceMetadata(), {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  });
}
