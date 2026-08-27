import { ORPCError, createRouterClient } from "@orpc/server";
import { z } from "zod";
import {
  agentApprovalModeSchema,
  assistantModelFallbackSchema,
  assistantModelRouteSchema,
  conversationCheckpointRefSchema,
  assistantAttachmentKindSchema,
  historicalBranchChoiceSchema,
  historicalDataChangesReviewSchema,
  historicalBranchOperationSchema,
  lexicalSearchModeSchema,
} from "@avermate/agent-contracts";
import { REVIEWED_ASSISTANT_SKILLS } from "../assistant/catalogue";
import { coreConversationSearchService } from "../assistant/conversation-search";
import { ConversationStoreError } from "../assistant/core-conversation-store";
import {
  assistantRunService,
  assistantModelPreferenceService,
  coreConversationStore,
  coreHistoricalBranchService,
} from "../assistant/services";
import { HistoricalBranchError } from "../assistant/historical-branch-service";
import { db } from "../db";
import { CoreCitationResolver } from "../search/citations";
import { canonicalJson, sha256 } from "../search/values";
import { protectedProcedure } from "../lib/orpc";
import type { Context } from "../lib/context";
import type { Api } from "../mcp/shared";
import { createFirstPartyToolBroker } from "../tools/first-party";
import { fileHandleService } from "../routes/file-handles";
import { assistantToolSourcesRouter } from "./assistant-tool-sources";
import { createCustomMcpDescriptors } from "../assistant/custom-mcp-tools";
import { managedToolActionContinuationStore } from "../tools/managed-action-continuation";
import { actionLedgerService } from "../actions/services";
import { ActionLedgerError } from "../actions/action-ledger";

const id = z.string().min(1).max(256);
const cursor = z.string().max(512).nullable().optional();
const attachmentInput = z.strictObject({
  kind: assistantAttachmentKindSchema,
  referenceId: id,
  snapshotVersion: z.string().min(1).max(256).nullable().optional(),
  label: z.string().trim().min(1).max(256),
});

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
  if (error instanceof HistoricalBranchError) {
    if (error.code === "not_found") {
      throw new ORPCError("NOT_FOUND", { message: error.message });
    }
    if (
      error.code === "snapshot_unavailable" ||
      error.code === "snapshot_incompatible" ||
      error.code === "divergent_replay"
    ) {
      throw new ORPCError("CONFLICT", { message: error.message });
    }
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  }
  if (error instanceof ConversationStoreError) {
    if (error.code === "not_found") {
      throw new ORPCError("NOT_FOUND", { message: error.message });
    }
    if (error.code === "forbidden") {
      throw new ORPCError("FORBIDDEN", { message: error.message });
    }
    if (error.code === "head_conflict" || error.code === "active_run") {
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

async function authenticatedAssistantBroker(
  context: Context,
  approvalMode: z.infer<typeof agentApprovalModeSchema>,
) {
  // Deferred import avoids making the router module's own initialization the
  // source of a circular value. The call occurs only after appRouter is ready.
  const { appRouter } = await import("./index");
  const api = createRouterClient(appRouter, { context }) as Api;
  const broker = createFirstPartyToolBroker(api, {
    fileHandles: fileHandleService,
    ownerId: context.session!.user.id,
    includeMutations: approvalMode !== "read-only",
    ...(approvalMode === "read-only"
      ? {}
      : { continuations: managedToolActionContinuationStore }),
  });
  try {
    for (const descriptor of await createCustomMcpDescriptors(
      context.session!.user.id,
    )) {
      if (descriptor.effect !== "read") continue;
      broker.registry.register(descriptor);
    }
  } catch (error) {
    // A broken/unavailable optional custom source must never prevent the
    // first-party conversation history and read tools from opening.
    console.error(
      "[assistant] custom MCP catalogue unavailable",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
  return broker;
}

const listInput = z.strictObject({
  projectId: id.optional(),
  cursor,
  limit: z.number().int().min(1).max(100).default(30),
  includeArchived: z.boolean().default(false),
  includeDeleted: z.boolean().default(false),
  starredOnly: z.boolean().default(false),
});

export const assistantRouter = {
  toolSources: assistantToolSourcesRouter,

  conversations: {
    search: protectedProcedure
      .input(
        z.strictObject({
          query: z.string().trim().min(1).max(2_000),
          mode: lexicalSearchModeSchema.default("terms"),
          limit: z.number().int().min(1).max(20).default(10),
          cursor: z.string().max(512).nullable().default(null),
        }),
      )
      .handler(({ context, input }) =>
        coreConversationSearchService.run({
          ownerId: context.session.user.id,
          ...input,
        }),
      ),
  },

  threads: {
    list: protectedProcedure.input(listInput).handler(({ context, input }) =>
      call(() =>
        coreConversationStore.listThreads({
          ownerId: context.session.user.id,
          ...input,
        }),
      ),
    ),

    search: protectedProcedure
      .input(
        listInput.extend({
          query: z.string().trim().min(1).max(2_000),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.listThreads({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),

    create: protectedProcedure
      .input(
        z.strictObject({
          title: z.string().trim().min(1).max(256).optional(),
          projectId: id.nullable().optional(),
          placement: z.enum(["core", "node"]).optional(),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.createThread({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),

    get: protectedProcedure
      .input(
        z.strictObject({
          threadId: id,
          branchId: id.nullable().optional(),
          expectedProjectId: id.optional(),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.getThreadDetail(
            context.session.user.id,
            input.threadId,
            input.branchId,
            input.expectedProjectId,
          ),
        ),
      ),

    update: protectedProcedure
      .input(
        z.strictObject({
          threadId: id,
          expectedRevision: z.number().int().positive(),
          title: z.string().trim().min(1).max(256).optional(),
          starred: z.boolean().optional(),
          archived: z.boolean().optional(),
          activeBranchId: id.optional(),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.updateThread({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),

    trash: protectedProcedure
      .input(
        z.strictObject({
          threadId: id,
          expectedRevision: z.number().int().positive(),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.trashThread({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),

    restore: protectedProcedure
      .input(
        z.strictObject({
          threadId: id,
          expectedRevision: z.number().int().positive(),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.restoreThread({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),

    export: protectedProcedure
      .input(
        z.strictObject({
          threadId: id,
          branchId: id.nullable().optional(),
          mode: z.enum(["active-branch", "whole-dag"]).default("active-branch"),
          format: z.enum(["json", "markdown"]),
        }),
      )
      .handler(async ({ context, input }) => {
        const content =
          input.format === "json"
            ? canonicalJson(
                await call(() =>
                  coreConversationStore.exportThread({
                    ownerId: context.session.user.id,
                    threadId: input.threadId,
                    branchId: input.branchId,
                    mode: input.mode,
                  }),
                ),
              )
            : await call(() =>
                coreConversationStore.exportMarkdown({
                  ownerId: context.session.user.id,
                  threadId: input.threadId,
                  branchId: input.branchId,
                }),
              );
        return {
          format: input.format,
          fileName: `conversation-${input.threadId}.${input.format === "json" ? "json" : "md"}`,
          mimeType:
            input.format === "json"
              ? "application/json"
              : "text/markdown; charset=utf-8",
          content,
          digest: sha256(content),
        };
      }),

    saveToProject: protectedProcedure
      .input(
        z.strictObject({
          threadId: id,
          projectId: id,
          mode: z.enum(["reference", "markdown"]),
          branchId: id.nullable().optional(),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.saveConversationToProject({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),
  },

  messages: {
    send: protectedProcedure
      .input(
        z.strictObject({
          threadId: id,
          branchId: id,
          expectedHeadMessageId: id.nullable(),
          clientRequestId: id,
          markdown: z.string().trim().min(1).max(200_000),
          modelKey: id.optional(),
          approvalMode: agentApprovalModeSchema.default("read-only"),
          skillId: id.nullable().optional(),
          planMode: z.boolean().default(false),
          forkOnConflict: z.boolean().default(false),
          attachments: z.array(attachmentInput).max(50).default([]),
        }),
      )
      .handler(async ({ context, input }) => {
        const selection = await assistantRunService
          .resolveModelForNewRun(context.session.user.id, input.modelKey)
          .catch(() => null);
        if (!selection) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Model placement is unavailable",
          });
        }
        if (
          input.skillId &&
          !REVIEWED_ASSISTANT_SKILLS.some((skill) => skill.id === input.skillId)
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Skill is unavailable",
          });
        }
        const reservation = await call(() =>
          coreConversationStore.reserveTurn({
            ownerId: context.session.user.id,
            threadId: input.threadId,
            branchId: input.branchId,
            expectedHeadMessageId: input.expectedHeadMessageId,
            clientRequestId: input.clientRequestId,
            markdown: input.markdown,
            modelKey: selection.capability.modelKey,
            providerKey: selection.capability.providerKey,
            modelPolicy: selection.runPolicy,
            approvalMode: input.approvalMode,
            forkOnConflict: input.forkOnConflict,
            attachments: input.attachments,
            skillId: input.skillId,
            planMode: input.planMode,
          }),
        );
        assistantRunService.launch(
          context.session.user.id,
          reservation.runId,
          await authenticatedAssistantBroker(context, input.approvalMode),
        );
        return reservation;
      }),

    branchPreview: protectedProcedure
      .input(
        z.strictObject({
          messageId: id,
          sourceBranchId: id,
          operation: historicalBranchOperationSchema,
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          coreHistoricalBranchService.preview({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),

    dataChangesReview: protectedProcedure
      .input(
        z.strictObject({
          messageId: id,
          sourceBranchId: id,
          operation: historicalBranchOperationSchema,
        }),
      )
      .handler(({ context, input }) =>
        call(async () => {
          const boundary =
            await coreHistoricalBranchService.resolveDataChangesBoundary({
              ownerId: context.session.user.id,
              ...input,
            });
          const review = await actionLedgerService().reviewBranchSince({
            userId: context.session.user.id,
            branchId: boundary.sourceBranchId,
            domainCursorRef: boundary.domainCursorRef,
          });
          return historicalDataChangesReviewSchema.parse({
            operation: boundary.operation,
            threadId: boundary.threadId,
            sourceBranchId: boundary.sourceBranchId,
            messageId: boundary.messageId,
            domainCursorRef: boundary.domainCursorRef,
            ...review,
          });
        }),
      ),

    edit: protectedProcedure
      .input(
        z.strictObject({
          messageId: id,
          clientRequestId: id,
          markdown: z.string().trim().min(1).max(200_000),
          modelKey: id,
          approvalMode: agentApprovalModeSchema.default("read-only"),
          historicalBranch: historicalBranchChoiceSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        const { historicalBranch, ...edit } = input;
        const selection = await assistantRunService
          .resolveModelForNewRun(context.session.user.id, edit.modelKey)
          .catch(() => null);
        if (!selection) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Model placement is unavailable",
          });
        }
        const resolvedEdit = {
          ...edit,
          modelKey: selection.capability.modelKey,
          providerKey: selection.capability.providerKey,
          modelPolicy: selection.runPolicy,
        };
        const result =
          historicalBranch.mode === "conversation-only"
            ? await call(async () => {
                await coreHistoricalBranchService.assertConversationOnly({
                  ownerId: context.session.user.id,
                  sourceBranchId: historicalBranch.sourceBranchId,
                  messageId: edit.messageId,
                  operation: "edit",
                });
                const edited = await coreConversationStore.editMessage({
                  ownerId: context.session.user.id,
                  ...resolvedEdit,
                });
                return {
                  ...edited,
                  historicalBranch: {
                    mode: "conversation-only" as const,
                    sourceBranchId: historicalBranch.sourceBranchId,
                    destinationBranchId:
                      edited.kind === "run-reserved"
                        ? edited.reservation.branchId
                        : edited.branchId,
                  },
                };
              })
            : await call(async () => {
                const copied =
                  await coreHistoricalBranchService.branchWithWorkspaceCopy({
                    ownerId: context.session.user.id,
                    sourceBranchId: historicalBranch.sourceBranchId,
                    messageId: edit.messageId,
                    operation: "edit",
                    clientRequestId: edit.clientRequestId,
                    snapshotId: historicalBranch.snapshotId,
                    expectedPortableManifestDigest:
                      historicalBranch.expectedPortableManifestDigest,
                    createDestination: async ({
                      destinationBranchId,
                      workspaceSnapshotRef,
                    }) => {
                      const edited = await coreConversationStore.editMessage({
                        ownerId: context.session.user.id,
                        ...resolvedEdit,
                        destinationBranchId,
                        workspaceSnapshotRef,
                      });
                      if (edited.kind !== "run-reserved") {
                        throw new HistoricalBranchError(
                          "invalid_target",
                          "Workspace copy requires an edited user message that starts a run.",
                        );
                      }
                      return edited.reservation;
                    },
                  });
                return {
                  kind: "run-reserved" as const,
                  reservation: copied.reservation,
                  historicalBranch: copied.historicalBranch,
                };
              });
        if (result.kind === "run-reserved") {
          assistantRunService.launch(
            context.session.user.id,
            result.reservation.runId,
            await authenticatedAssistantBroker(context, input.approvalMode),
          );
        }
        return result;
      }),

    retry: protectedProcedure
      .input(
        z.strictObject({
          messageId: id,
          clientRequestId: id,
          modelKey: id.optional(),
          approvalMode: agentApprovalModeSchema.default("read-only"),
          historicalBranch: historicalBranchChoiceSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        const { historicalBranch, ...retry } = input;
        const selection = await assistantRunService
          .resolveModelForNewRun(context.session.user.id, retry.modelKey)
          .catch(() => null);
        if (!selection) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Model placement is unavailable",
          });
        }
        const resolvedRetry = {
          ...retry,
          modelKey: selection.capability.modelKey,
          providerKey: selection.capability.providerKey,
          modelPolicy: selection.runPolicy,
        };
        const result =
          historicalBranch.mode === "conversation-only"
            ? await call(async () => {
                await coreHistoricalBranchService.assertConversationOnly({
                  ownerId: context.session.user.id,
                  sourceBranchId: historicalBranch.sourceBranchId,
                  messageId: retry.messageId,
                  operation: "retry",
                });
                const reservation = await coreConversationStore.reserveRetry({
                  ownerId: context.session.user.id,
                  ...resolvedRetry,
                });
                return {
                  reservation,
                  historicalBranch: {
                    mode: "conversation-only" as const,
                    sourceBranchId: historicalBranch.sourceBranchId,
                    destinationBranchId: reservation.branchId,
                  },
                };
              })
            : await call(() =>
                coreHistoricalBranchService.branchWithWorkspaceCopy({
                  ownerId: context.session.user.id,
                  sourceBranchId: historicalBranch.sourceBranchId,
                  messageId: retry.messageId,
                  operation: "retry",
                  clientRequestId: retry.clientRequestId,
                  snapshotId: historicalBranch.snapshotId,
                  expectedPortableManifestDigest:
                    historicalBranch.expectedPortableManifestDigest,
                  createDestination: ({
                    destinationBranchId,
                    workspaceSnapshotRef,
                  }) =>
                    coreConversationStore.reserveRetry({
                      ownerId: context.session.user.id,
                      ...resolvedRetry,
                      destinationBranchId,
                      workspaceSnapshotRef,
                    }),
                }),
              );
        assistantRunService.launch(
          context.session.user.id,
          result.reservation.runId,
          await authenticatedAssistantBroker(context, input.approvalMode),
        );
        return {
          ...result.reservation,
          historicalBranch: result.historicalBranch,
        };
      }),
  },

  runs: {
    inspect: protectedProcedure
      .input(z.strictObject({ runId: id }))
      .handler(async ({ context, input }) => {
        const ownerId = context.session.user.id;
        const [runtime, run, usageResult, claimsResult, checkpointResult] =
          await Promise.all([
            assistantRunService.inspect({ ownerId, runId: input.runId }),
            coreConversationStore.run(ownerId, input.runId),
            db.$client.execute({
              sql: `SELECT u.* FROM assistant_usage u
                    JOIN assistant_runs r ON r.id = u.runId
                    WHERE u.runId = ? AND r.userId = ? LIMIT 1`,
              args: [input.runId, ownerId],
            }),
            db.$client.execute({
              sql: `SELECT c.id, c.dispatchKey, c.requestDigest, c.providerKey,
                      c.providerRevision, c.modelKey, c.modelRevision,
                      c.placementJson, c.providerSupportsStableRequestKey,
                      c.state, c.inspectReason, c.claimedAt, c.updatedAt
                    FROM assistant_provider_dispatch_claims c
                    WHERE c.runId = ? AND c.userId = ?
                    ORDER BY c.claimedAt, c.id`,
              args: [input.runId, ownerId],
            }),
            db.$client.execute({
              sql: `SELECT c.id, c.afterEventSequence, c.runtimeId,
                      c.runtimeVersion, c.graphSchemaVersion, c.stateDigest,
                      c.stateByteLength, c.status, c.committedAt
                    FROM assistant_conversation_checkpoints c
                    JOIN assistant_runs r ON r.id = c.runId
                    WHERE c.id = r.conversationCheckpointRef
                      AND c.runId = ? AND c.userId = ? AND r.userId = ?
                    LIMIT 1`,
              args: [input.runId, ownerId, ownerId],
            }),
          ]);
        return {
          runtime,
          run,
          usage: usageResult.rows[0] ?? null,
          dispatchClaims: claimsResult.rows.map((row) => ({
            ...row,
            placement:
              typeof row.placementJson === "string"
                ? JSON.parse(row.placementJson)
                : row.placementJson,
            placementJson: undefined,
            providerSupportsStableRequestKey: Boolean(
              row.providerSupportsStableRequestKey,
            ),
          })),
          checkpoint: checkpointResult.rows[0] ?? null,
        };
      }),

    cancel: protectedProcedure
      .input(z.strictObject({ runId: id }))
      .handler(({ context, input }) =>
        call(() =>
          assistantRunService.cancelRun(context.session.user.id, input.runId),
        ),
      ),
    respond: protectedProcedure
      .input(
        z.strictObject({
          runId: id,
          questionId: id,
          answer: z.string().trim().min(1).max(20_000),
        }),
      )
      .handler(async ({ context, input }) => {
        const run = await coreConversationStore.run(
          context.session.user.id,
          input.runId,
        );
        await assistantRunService.respondToQuestion({
          ownerId: context.session.user.id,
          ...input,
          broker: await authenticatedAssistantBroker(context, run.approvalMode),
        });
        return coreConversationStore.run(context.session.user.id, input.runId);
      }),

    resume: protectedProcedure
      .input(
        z.strictObject({
          runId: id,
          conversationCheckpointRef: conversationCheckpointRefSchema,
          resumeValue: z.unknown(),
        }),
      )
      .handler(async ({ context, input }) => {
        const handle = await assistantRunService.resume({
          ownerId: context.session.user.id,
          ...input,
        });
        return {
          runId: handle.runId,
          conversationCheckpointRef: handle.conversationCheckpointRef,
        };
      }),
  },

  models: {
    list: protectedProcedure.handler(async ({ context }) => ({
      items: await assistantRunService.listModels(context.session.user.id),
    })),
    catalogue: protectedProcedure.handler(async ({ context }) => ({
      items: await assistantRunService.modelCatalogue(context.session.user.id),
    })),
    preference: {
      get: protectedProcedure.handler(({ context }) =>
        assistantModelPreferenceService.get(context.session.user.id),
      ),
      update: protectedProcedure
        .input(
          z.strictObject({
            defaultModelKey: id.nullable(),
            route: assistantModelRouteSchema,
            fallback: assistantModelFallbackSchema,
            maximumInputTokens: z.number().int().positive().nullable(),
            maximumOutputTokens: z.number().int().positive().nullable(),
            maximumEstimatedCostMinor: z
              .number()
              .int()
              .nonnegative()
              .nullable(),
            currency: z.string().length(3).nullable(),
            expectedRevision: z.number().int().positive(),
          }),
        )
        .handler(async ({ context, input }) => {
          if (input.defaultModelKey) {
            const catalogue = await assistantRunService.modelCatalogue(
              context.session.user.id,
            );
            if (
              !catalogue.some(
                (entry) =>
                  entry.available &&
                  entry.capability.modelKey === input.defaultModelKey,
              )
            ) {
              throw new ORPCError("BAD_REQUEST", {
                message: "Default model placement is unavailable",
              });
            }
          }
          try {
            return await assistantModelPreferenceService.update(
              context.session.user.id,
              input,
            );
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("revision changed")
            ) {
              throw new ORPCError("CONFLICT", { message: error.message });
            }
            throw error;
          }
        }),
    },
  },

  skills: {
    list: protectedProcedure.handler(() => ({
      items: REVIEWED_ASSISTANT_SKILLS,
    })),
  },

  attachments: {
    create: protectedProcedure
      .input(attachmentInput.extend({ messageId: id }))
      .handler(({ context, input }) =>
        call(() =>
          coreConversationStore.createAttachment({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),
  },

  citations: {
    open: protectedProcedure
      .input(z.strictObject({ citationId: id }))
      .handler(async ({ context, input }) => {
        const result = await db.$client.execute({
          sql: `SELECT c.*, p.contentVersionReferenceId
            FROM assistant_citations c
            JOIN assistant_context_proof_handles p ON p.id = c.proofHandleId
            JOIN assistant_runs r ON r.id = c.runId
            WHERE c.id = ? AND r.userId = ? LIMIT 1`,
          args: [input.citationId, context.session.user.id],
        });
        const citation = result.rows[0];
        if (!citation)
          throw new ORPCError("NOT_FOUND", { message: "Citation not found" });
        const opened = await new CoreCitationResolver(db.$client).readChunk({
          ownerId: context.session.user.id,
          referenceId: String(citation.contentVersionReferenceId),
        });
        return {
          citationId: input.citationId,
          resolved: opened.citation,
          text: opened.text,
        };
      }),
  },

  events: {
    poll: protectedProcedure
      .input(
        z.strictObject({
          runId: id,
          afterSequence: z.number().int().nonnegative().default(0),
          limit: z.number().int().min(1).max(1_000).default(250),
        }),
      )
      .handler(async ({ context, input }) => {
        const events = await call(() =>
          coreConversationStore.replayEvents({
            ownerId: context.session.user.id,
            ...input,
          }),
        );
        const run = await call(() =>
          coreConversationStore.run(context.session.user.id, input.runId),
        );
        const nextCursor = events.at(-1)?.sequence ?? input.afterSequence;
        return {
          events,
          nextCursor,
          terminal:
            ["complete", "failed", "cancelled"].includes(run.status) &&
            Boolean(events.at(-1)?.terminal || events.length === 0),
        };
      }),
  },
};
