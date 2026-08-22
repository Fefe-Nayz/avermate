import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  call,
  id,
  meta,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerSocialReadSurface({ server, api }: McpSurfaceContext): void {
  const readMeta = meta("avermate:social.read");
  const readOnly = { readOnlyHint: true };
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
    () => call(() => api.social.sharing.get()),
  );
  tool(
    "social.friends",
    "List friends and whether each shares anything.",
    z.object({}),
    () => call(() => api.social.friends.list()),
  );
  tool(
    "social.friend",
    "Read one friend and the averages they currently share.",
    z.object({ friendshipId: id }),
    (input) => call(() => api.social.friends.detail(input)),
  );
  tool(
    "social.friend_requests",
    "List incoming and outgoing friend requests.",
    z.object({}),
    () => call(() => api.social.friends.requests()),
  );
  tool(
    "social.blocks",
    "List accounts blocked by the connected user.",
    z.object({}),
    () => call(() => api.social.blocks.list()),
  );
  tool(
    "social.groups",
    "List the connected user's classes.",
    z.object({}),
    () => call(() => api.social.groups.list()),
  );
  tool(
    "social.group",
    "Read a class with its members and their shared averages.",
    z.object({ groupId: id }),
    (input) => call(() => api.social.groups.get(input)),
  );
  tool(
    "social.notifications",
    "Read privacy-safe social notifications.",
    z.object({ unreadOnly: z.boolean().default(false) }),
    (input) => call(() => api.social.notifications.list(input)),
  );
  tool(
    "social.reports",
    "Read moderation reports submitted by the connected user.",
    z.object({}),
    () => call(() => api.social.reports.mine()),
  );
}

export const socialReadSurface: McpSurface = {
  scopes: ["avermate:social.read"],
  register: registerSocialReadSurface,
};
