import {
  acceptedContent,
  inputRequired,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { actionLedgerService } from "../../actions/services";
import { resolveApprovalAndResume } from "../../actions/approval-execution";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { managedToolActionContinuationStore } from "../../tools/managed-action-continuation";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";
import {
  can,
  brokerMeta,
  confirmationSchema,
  failure,
  id,
  meta,
  result,
  sameState,
  sha256,
  type DestructiveState,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

const hash = z.string().regex(/^[a-f0-9]{64}$/);

async function approvalState(input: {
  userId: string;
  clientId: string;
  toolName: string;
  operation: unknown;
  idempotencyKey: string;
}): Promise<DestructiveState> {
  return {
    userId: input.userId,
    clientId: input.clientId,
    toolName: input.toolName,
    argumentsHash: await sha256(input.operation),
    idempotencyKey: input.idempotencyKey,
  };
}

async function resolveApproval(
  surface: McpSurfaceContext,
  input: { actionId: string; approvalId: string; previewHash: string },
  context: ServerContext,
): Promise<CallToolResult | InputRequiredResult> {
  try {
    const action = await actionLedgerService().get(
      surface.principal.userId,
      input.actionId,
    );
    if (
      action.approval?.id !== input.approvalId ||
      action.approval.previewHash !== input.previewHash
    ) {
      return failure("The approval does not match this exact action preview");
    }
    const expected = await approvalState({
      userId: surface.principal.userId,
      clientId: surface.principal.clientId,
      toolName: "actions.resolve_approval",
      operation: input,
      idempotencyKey: input.approvalId,
    });
    const state = context.mcpReq.requestState<DestructiveState>();
    if (!state) {
      const preview = JSON.stringify(action.preview).slice(0, 4_000);
      return inputRequired({
        requestState: await surface.codec.mint(expected, context),
        inputRequests: {
          confirmation: inputRequired.elicit({
            message: `Approve ${action.toolId}@${action.toolVersion} for this exact preview? ${preview}`,
            requestedSchema: confirmationSchema,
          }),
        },
      });
    }
    if (!sameState(expected, state)) {
      return failure("The confirmation does not match this exact action");
    }
    const confirmation = acceptedContent(
      context.mcpReq.inputResponses,
      "confirmation",
      confirmationSchema,
    );
    return result(
      await resolveApprovalAndResume({
        ledger: actionLedgerService(),
        broker: createFirstPartyToolBroker(surface.api, {
          includeMutations: true,
          continuations: managedToolActionContinuationStore,
        }),
        userId: surface.principal.userId,
        resolution: {
          ...input,
          decision: confirmation?.confirm ? "approve" : "reject",
        },
        resolutionContext: {
          channel: "mcp-elicitation",
          clientId: surface.principal.clientId,
        },
        authorizedScopes: surface.principal.scopes,
      }),
    );
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Approval failed");
  }
}

async function executeUndo(
  surface: McpSurfaceContext,
  input: { actionIds: string[] },
  context: ServerContext,
): Promise<CallToolResult | InputRequiredResult> {
  try {
    const preview = await actionLedgerService().previewUndo(
      surface.principal.userId,
      input.actionIds,
    );
    const expected = await approvalState({
      userId: surface.principal.userId,
      clientId: surface.principal.clientId,
      toolName: "actions.undo_execute",
      operation: preview,
      idempotencyKey: preview.previewHash,
    });
    const state = context.mcpReq.requestState<DestructiveState>();
    if (!state) {
      return inputRequired({
        requestState: await surface.codec.mint(expected, context),
        inputRequests: {
          confirmation: inputRequired.elicit({
            message: `Undo ${preview.eligible.length} eligible action(s) in reverse dependency order? ${preview.conflicted.length} conflicted and ${preview.nonUndoable.length} non-undoable action(s) will remain unchanged.`,
            requestedSchema: confirmationSchema,
          }),
        },
      });
    }
    if (!sameState(expected, state)) {
      return failure("The undo graph or confirmation changed; preview again");
    }
    const confirmation = acceptedContent(
      context.mcpReq.inputResponses,
      "confirmation",
      confirmationSchema,
    );
    if (!confirmation?.confirm) {
      return failure("The undo operation was cancelled", true);
    }
    return result(
      await actionLedgerService().executeUndo({
        userId: surface.principal.userId,
        preview,
      }),
    );
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Undo failed");
  }
}

function registerActionsSurface(surface: McpSurfaceContext): void {
  const { server, principal } = surface;
  const readMeta = brokerMeta("avermate:read");
  const readOnly = { readOnlyHint: true };
  const readBroker = createFirstPartyToolBroker(surface.api);
  server.registerTool(
    "actions.get",
    {
      description: "Inspect one owned durable agent action and its undo state.",
      inputSchema: z.object({ actionId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker: readBroker,
        principal,
        invocation: { toolId: "actions.get", toolVersion: 1, input },
      }),
  );
  server.registerTool(
    "actions.list",
    {
      description:
        "List the caller's durable action activity with safe filters.",
      inputSchema: z.object({
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        toolId: z.string().min(1).max(256).optional(),
        threadId: id.optional(),
        resourceKind: z.string().min(1).max(128).optional(),
        resourceId: id.optional(),
        status: z
          .enum([
            "reserved",
            "awaiting-approval",
            "executing",
            "rejected",
            "expired",
            "completed",
            "failed",
            "inspect-required",
          ])
          .optional(),
      }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker: readBroker,
        principal,
        invocation: { toolId: "actions.list", toolVersion: 1, input },
      }),
  );
  server.registerTool(
    "actions.undo_preview",
    {
      description:
        "Preview the exact causal closure and reverse order for undoing owned actions.",
      inputSchema: z.object({ actionIds: z.array(id).min(1).max(500) }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker: readBroker,
        principal,
        invocation: { toolId: "actions.undo_preview", toolVersion: 1, input },
      }),
  );

  if (!can(principal, "avermate:planner.write")) return;
  const writeMeta = meta("avermate:planner.write");
  server.registerTool(
    "actions.resolve_approval",
    {
      description:
        "Ask the human to approve or reject one exact pending action preview.",
      inputSchema: z.object({
        actionId: id,
        approvalId: id,
        previewHash: hash,
      }),
      annotations: { idempotentHint: true, destructiveHint: false },
      _meta: writeMeta,
    },
    (input, context) => resolveApproval(surface, input, context),
  );
  server.registerTool(
    "actions.undo_execute",
    {
      description:
        "Ask the human before executing the fresh undo preview through reviewed compensators.",
      inputSchema: z.object({ actionIds: z.array(id).min(1).max(500) }),
      annotations: { idempotentHint: true, destructiveHint: true },
      _meta: writeMeta,
    },
    (input, context) => executeUndo(surface, input, context),
  );
}

export const actionsSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerActionsSurface,
};
