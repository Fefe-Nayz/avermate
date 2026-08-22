import {
  McpServer,
  createRequestStateCodec,
} from "@modelcontextprotocol/server";
import { createRouterClient } from "@orpc/server";
import { isAdmin } from "../lib/admin";
import { appRouter } from "../routers";
import type { McpPrincipal } from "./auth";
import { can, requestStateSecret, type DestructiveState } from "./shared";
import { SURFACES } from "./surfaces";
import { guardMcpMutationRegistrations } from "./mutation-rollout";

export function createAvermateMcpServer(
  principal: McpPrincipal,
  options: { testOnlyAllowLegacyMutations?: boolean } = {},
): McpServer {
  const api = createRouterClient(appRouter, { context: principal.context });
  const codec = createRequestStateCodec<DestructiveState>({
    key: requestStateSecret,
    ttlSeconds: 10 * 60,
    bind: (context) =>
      `${principal.userId}\0${principal.clientId}\0${context.mcpReq.method}`,
  });
  const server = new McpServer(
    { name: "avermate", version: "2.0.0" },
    {
      instructions:
        "Avermate manages academic years, periods, subject hierarchies, grades and components, calculated averages, goals, dashboard cards, preferences and year recaps. Read current data before changing it. Never infer identifiers. Destructive tools always require an explicit multi-round-trip confirmation.",
      cacheHints: {
        "server/discover": { ttlMs: 300_000, cacheScope: "private" },
        "tools/list": { ttlMs: 300_000, cacheScope: "private" },
        "prompts/list": { ttlMs: 300_000, cacheScope: "private" },
        "resources/list": { ttlMs: 60_000, cacheScope: "private" },
        "resources/templates/list": { ttlMs: 300_000, cacheScope: "private" },
        "resources/read": { ttlMs: 10_000, cacheScope: "private" },
      },
      requestState: { verify: codec.verify },
      inputRequired: { maxRounds: 2, legacyShim: false },
    },
  );
  const registeredServer = guardMcpMutationRegistrations(server, {
    testOnlyAllowLegacyMutations: options.testOnlyAllowLegacyMutations,
  });

  for (const surface of SURFACES) {
    if (!can(principal, ...surface.scopes)) continue;
    if (surface.requiresAdminRole) {
      const user = principal.context.session?.user;
      if (!user || !isAdmin(user)) continue;
    }
    surface.register({ server: registeredServer, api, principal, codec });
  }

  return server;
}
