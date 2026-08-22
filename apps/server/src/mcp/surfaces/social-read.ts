import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  brokerMeta,
  id,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";

function registerSocialReadSurface({
  server,
  api,
  principal,
}: McpSurfaceContext): void {
  const readMeta = brokerMeta("avermate:social.read");
  const readOnly = { readOnlyHint: true };
  const broker = createFirstPartyToolBroker(api);
  const invokeRead = (toolId: string, input: unknown) =>
    invokeBrokerFromMcp({
      broker,
      principal,
      invocation: { toolId, toolVersion: 1, input },
    });
  const tool = <Schema extends z.ZodObject<any>>(
    name: string,
    description: string,
    inputSchema: Schema,
    handler: (input: z.infer<Schema>) => Promise<CallToolResult>,
  ) =>
    server.registerTool(
      name,
      { description, inputSchema, annotations: readOnly, _meta: readMeta },
      (async (
        input: z.infer<Schema>,
        _context: ServerContext,
      ): Promise<CallToolResult> => handler(input)) as never,
    );

  tool(
    "social.sharing",
    "Read the connected user's sharing locks and the exact view friends receive.",
    z.object({}),
    () => invokeRead("social.sharing", {}),
  );
  tool(
    "social.friends",
    "List friends and whether each shares anything.",
    z.object({}),
    () => invokeRead("social.friends", {}),
  );
  tool(
    "social.friend",
    "Read one friend and the averages they currently share.",
    z.object({ friendshipId: id }),
    (input) => invokeRead("social.friend", input),
  );
  tool(
    "social.friend_requests",
    "List incoming and outgoing friend requests.",
    z.object({}),
    () => invokeRead("social.friend_requests", {}),
  );
  tool(
    "social.blocks",
    "List accounts blocked by the connected user.",
    z.object({}),
    () => invokeRead("social.blocks", {}),
  );
  tool(
    "social.groups",
    "List the connected user's classes.",
    z.object({}),
    () => invokeRead("social.groups", {}),
  );
  tool(
    "social.group",
    "Read a class with its members and their shared averages.",
    z.object({ groupId: id }),
    (input) => invokeRead("social.group", input),
  );
  tool(
    "social.notifications",
    "Read privacy-safe social notifications.",
    z.object({ unreadOnly: z.boolean().default(false) }),
    (input) => invokeRead("social.notifications", input),
  );
  tool(
    "social.reports",
    "Read moderation reports submitted by the connected user.",
    z.object({}),
    () => invokeRead("social.reports", {}),
  );
}

export const socialReadSurface: McpSurface = {
  scopes: ["avermate:social.read"],
  register: registerSocialReadSurface,
};
