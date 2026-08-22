import type { CallToolResult } from "@modelcontextprotocol/server";
import type { McpPrincipal } from "../../mcp/auth";
import type { ToolBroker, ToolBrokerInvocation } from "../broker";
import { durableActionLedgerWriter } from "../../actions/services";
import { noOpToolCapabilities, noOpToolEvents } from "../broker";

export async function invokeBrokerFromMcp(input: {
  broker: ToolBroker;
  principal: McpPrincipal;
  invocation: ToolBrokerInvocation;
  signal?: AbortSignal;
}): Promise<CallToolResult> {
  const result = await input.broker.invoke(
    input.broker.createContext({
      principal: {
        userId: input.principal.userId,
        clientId: input.principal.clientId,
        scopes: new Set(input.principal.scopes),
      },
      actionActorKind: "mcp",
      approvalMode: "confirm",
      approvalProof: null,
      threadId: null,
      branchId: null,
      runId: null,
      toolCallId: crypto.randomUUID(),
      signal: input.signal ?? new AbortController().signal,
      deadline: new Date(Date.now() + 30_000),
      capabilities: noOpToolCapabilities,
      events: noOpToolEvents,
      actionLedger: durableActionLedgerWriter({
        actorKind: "mcp",
        userId: input.principal.userId,
      }),
    }),
    input.invocation,
  );
  const envelope = result.model;
  return {
    ...(envelope.ok ? {} : { isError: true }),
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope as Record<string, unknown>,
  };
}
