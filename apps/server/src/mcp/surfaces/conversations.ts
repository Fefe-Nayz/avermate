import { z } from "zod";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";
import { brokerMeta, type McpSurface, type McpSurfaceContext } from "../shared";

function registerConversationsSurface({
  server,
  api,
  principal,
}: McpSurfaceContext) {
  const broker = createFirstPartyToolBroker(api);

  server.registerTool(
    "conversation.search",
    {
      description:
        "Search owned conversations using bounded lexical matching and cursor pagination.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(2_000),
        mode: z.enum(["terms", "phrase", "prefix", "exact"]).default("terms"),
        limit: z.number().int().min(1).max(20).default(10),
        cursor: z.string().max(512).nullable().default(null),
      }),
      annotations: { readOnlyHint: true },
      _meta: brokerMeta("avermate:read"),
    },
    (input) =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: {
          toolId: "conversation.search",
          toolVersion: 1,
          input,
        },
      }),
  );
}

export const conversationsSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerConversationsSurface,
};
