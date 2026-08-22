import { createRouterClient, ORPCError } from "@orpc/server";
import {
  agentActionActivityFilterSchema,
  agentActionApprovalResolutionInputSchema,
  agentActionConflictResolutionInputSchema,
  agentActionDependencyInputSchema,
  agentActionPreviewSchema,
  agentActionTaskCreateRequestSchema,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { actionHash, ActionLedgerError } from "../actions/action-ledger";
import {
  actionLedgerService,
  durableActionLedgerWriter,
} from "../actions/services";
import type { Context } from "../lib/context";
import { protectedProcedure } from "../lib/orpc";
import { noOpToolCapabilities, noOpToolEvents } from "../tools/broker";
import type { ToolBroker } from "../tools/broker";
import { createFirstPartyToolBroker } from "../tools/first-party";
import { resolveApprovalAndResume } from "../actions/approval-execution";
import { managedToolActionContinuationStore } from "../tools/managed-action-continuation";

const id = z.string().trim().min(1).max(256);

function translate(error: unknown): never {
  if (error instanceof ActionLedgerError) {
    if (error.code === "not-found") {
      throw new ORPCError("NOT_FOUND", { message: error.message });
    }
    if (error.code === "forbidden") {
      throw new ORPCError("FORBIDDEN", { message: error.message });
    }
    if (
      error.code === "conflict" ||
      error.code === "preview-stale" ||
      error.code === "dependency-cycle"
    ) {
      throw new ORPCError("CONFLICT", { message: error.message });
    }
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  }
  throw error;
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    translate(error);
  }
}

async function mutationBroker(
  context: Context & { session: NonNullable<Context["session"]> },
): Promise<ToolBroker> {
  // Deferred import prevents the actions router from evaluating appRouter while
  // the router tree is still being constructed.
  const { appRouter } = await import("./index");
  const api = createRouterClient(appRouter, { context });
  return createFirstPartyToolBroker(api as never, {
    includeMutations: true,
    continuations: managedToolActionContinuationStore,
  });
}

export const actionsRouter = {
  activity: {
    list: protectedProcedure
      .input(agentActionActivityFilterSchema)
      .handler(({ context, input }) =>
        call(() => actionLedgerService().list(context.session.user.id, input)),
      ),
    get: protectedProcedure
      .input(z.strictObject({ actionId: id }))
      .handler(({ context, input }) =>
        call(() =>
          actionLedgerService().get(context.session.user.id, input.actionId),
        ),
      ),
    events: protectedProcedure
      .input(
        z.strictObject({
          actionId: id,
          afterSequence: z.number().int().nonnegative().default(0),
          limit: z.number().int().min(1).max(250).default(100),
        }),
      )
      .handler(({ context, input }) =>
        call(async () => {
          const events = await actionLedgerService().listEvents({
            userId: context.session.user.id,
            ...input,
          });
          return {
            events,
            nextCursor: events.at(-1)?.sequence ?? input.afterSequence,
          };
        }),
      ),
  },

  approvals: {
    resolve: protectedProcedure
      .input(agentActionApprovalResolutionInputSchema)
      .handler(({ context, input }) =>
        call(async () => {
          let runtimeResult: unknown = null;
          const action = await resolveApprovalAndResume({
            ledger: actionLedgerService(),
            broker: await mutationBroker(context),
            userId: context.session.user.id,
            resolution: input,
            resolutionContext: { channel: "first-party-web" },
            onInvocationResolved: ({ result }) => {
              runtimeResult = result.model;
            },
          });
          if (action.actorKind === "embedded-agent" && action.runId) {
            const { assistantRunService } = await import(
              "../assistant/services"
            );
            await assistantRunService.resumeApproval(
              context.session.user.id,
              action.runId,
              {
                actionId: action.id,
                toolCallId: action.toolCallId,
                status:
                  action.status === "completed"
                    ? "completed"
                    : action.status === "rejected"
                      ? "rejected"
                      : action.status === "expired"
                        ? "expired"
                        : action.status === "inspect-required"
                          ? "inspect-required"
                          : "failed",
                modelResult: runtimeResult,
              },
              await mutationBroker(context),
            );
          }
          return action;
        }),
      ),
  },

  dependencies: {
    fence: protectedProcedure.handler(({ context }) =>
      actionLedgerService().dependencyFenceVersion(context.session.user.id),
    ),
    add: protectedProcedure
      .input(agentActionDependencyInputSchema)
      .handler(({ context, input }) =>
        call(() =>
          actionLedgerService().addDependency({
            userId: context.session.user.id,
            ...input,
          }),
        ),
      ),
  },

  batches: {
    create: protectedProcedure
      .input(
        z.strictObject({
          threadId: id.nullable().default(null),
          branchId: id.nullable().default(null),
          runId: id.nullable().default(null),
          label: z.string().trim().min(1).max(256).nullable().default(null),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          actionLedgerService().createBatch({
            userId: context.session.user.id,
            ...input,
          }),
        ),
      ),
    complete: protectedProcedure
      .input(
        z.strictObject({
          batchId: id,
          failed: z.boolean().default(false),
        }),
      )
      .handler(({ context, input }) =>
        call(async () => {
          await actionLedgerService().completeBatch({
            userId: context.session.user.id,
            ...input,
          });
          return { ok: true };
        }),
      ),
  },

  undo: {
    preview: protectedProcedure
      .input(z.strictObject({ actionIds: z.array(id).min(1).max(500) }))
      .handler(({ context, input }) =>
        call(() =>
          actionLedgerService().previewUndo(
            context.session.user.id,
            input.actionIds,
          ),
        ),
      ),
    execute: protectedProcedure
      .input(z.strictObject({ preview: agentActionPreviewSchema }))
      .handler(({ context, input }) =>
        call(() =>
          actionLedgerService().executeUndo({
            userId: context.session.user.id,
            preview: input.preview,
          }),
        ),
      ),
    resolveConflict: protectedProcedure
      .input(agentActionConflictResolutionInputSchema)
      .handler(({ context, input }) =>
        call(() =>
          actionLedgerService().resolveConflict({
            userId: context.session.user.id,
            ...input,
          }),
        ),
      ),
  },

  tasks: {
    create: protectedProcedure
      .input(agentActionTaskCreateRequestSchema)
      .handler(async ({ context, input }) => {
        const { idempotencyKey, ...taskInput } = input;
        const broker = await mutationBroker(context);
        const sessionBinding = await actionHash({
          sessionId: context.session.session.id,
        });
        return broker.invoke(
          broker.createContext({
            principal: {
              userId: context.session.user.id,
              clientId: `web:${sessionBinding.slice(0, 24)}`,
              scopes: new Set(["avermate:planner.write"]),
            },
            actionActorKind: "embedded-agent",
            approvalMode: "confirm-writes",
            approvalProof: null,
            threadId: null,
            branchId: null,
            runId: null,
            toolCallId: crypto.randomUUID(),
            signal: new AbortController().signal,
            deadline: new Date(Date.now() + 30_000),
            capabilities: noOpToolCapabilities,
            events: noOpToolEvents,
            actionLedger: durableActionLedgerWriter({
              actorKind: "embedded-agent",
              userId: context.session.user.id,
            }),
          }),
          {
            toolId: "planning.tasks.create",
            toolVersion: 1,
            input: taskInput,
            idempotencyKey,
          },
        );
      }),
  },
};
