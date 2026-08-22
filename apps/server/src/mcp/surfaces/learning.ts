import { z } from "zod";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { managedToolActionContinuationStore } from "../../tools/managed-action-continuation";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";
import {
  brokerMeta,
  can,
  id,
  isoDate,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

const idempotencyKey = z.string().trim().min(8).max(256);
const reviewedRegion = z.object({
  regionId: id,
  objectiveIds: z.array(id).min(1).max(12),
  observedOutcome: z.number().nonnegative().nullable().default(null),
  denominator: z.number().positive().nullable().default(null),
  difficulty: z.number().min(0).max(1).nullable().default(null),
  error: z
    .object({
      taxonomy: z.enum([
        "missing-knowledge",
        "misunderstood-concept",
        "method-strategy",
        "calculation",
        "notation",
        "reading-instruction",
        "justification",
        "transfer",
        "time-management",
        "unclassified",
      ]),
      explanation: z.string().trim().min(1).max(2_000),
      severity: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
    })
    .nullable()
    .default(null),
});

function registerLearningSurface({
  server,
  api,
  principal,
}: McpSurfaceContext) {
  if (can(principal, "avermate:learning.read")) {
    const broker = createFirstPartyToolBroker(api);
    const readMeta = brokerMeta("avermate:learning.read");
    const registerRead = <I extends object>(
      name: string,
      description: string,
      inputSchema: z.ZodType<I>,
    ) =>
      server.registerTool(
        name,
        {
          description,
          inputSchema,
          annotations: { readOnlyHint: true },
          _meta: readMeta,
        },
        (input) =>
          invokeBrokerFromMcp({
            broker,
            principal,
            invocation: { toolId: name, toolVersion: 1, input },
          }),
      );
    registerRead(
      "learning.concepts.get",
      "Read one owned concept, objectives, prerequisites and versioned mapping history.",
      z.object({ conceptId: id }),
    );
    registerRead(
      "learning.concepts.list",
      "List owned learning concepts and objectives in one academic scope.",
      z.object({ yearId: id, subjectId: id.nullable().optional() }),
    );
    registerRead(
      "learning.evidence.get",
      "Read one immutable evidence item with its exact locator, latest decision and reviewed errors.",
      z.object({ evidenceId: id }),
    );
    registerRead(
      "learning.evidence.list",
      "List immutable evidence and latest inclusion decisions for one owned objective.",
      z.object({ objectiveId: id }),
    );
    registerRead(
      "learning.mastery.get",
      "Read one current owned mastery projection with its objective and concept identity.",
      z.object({ objectiveId: id }),
    );
    registerRead(
      "learning.mastery.list",
      "List current explainable mastery estimates and intervals.",
      z.object({ yearId: id, subjectId: id.nullable().optional() }),
    );
    registerRead(
      "learning.mastery.explain",
      "Explain every contribution and omission in one owned mastery projection.",
      z.object({ objectiveId: id }),
    );
    registerRead(
      "learning.plan.list",
      "List pedagogical recommendations and their authoritative task links.",
      z.object({ yearId: id }),
    );
  }

  if (can(principal, "avermate:learning.write")) {
    const broker = createFirstPartyToolBroker(api, {
      includeMutations: true,
      continuations: managedToolActionContinuationStore,
    });
    const writeMeta = brokerMeta("avermate:learning.write");
    const registerWrite = <I extends object & { idempotencyKey: string }>(
      name: string,
      description: string,
      inputSchema: z.ZodType<I>,
      options: { destructive?: boolean } = {},
    ) =>
      server.registerTool(
        name,
        {
          description,
          inputSchema,
          annotations: {
            idempotentHint: true,
            ...(options.destructive ? { destructiveHint: true } : {}),
          },
          _meta: writeMeta,
        },
        ({ idempotencyKey: requestKey, ...input }) =>
          invokeBrokerFromMcp({
            broker,
            principal,
            invocation: {
              toolId: name,
              toolVersion: 1,
              input,
              idempotencyKey: requestKey,
            },
          }),
      );
    registerWrite(
      "learning.copy.request_analysis",
      "Request reviewed OCR placement for one selected owned copy; never changes its grade.",
      z.object({ attachmentId: id, idempotencyKey }),
    );
    registerWrite(
      "learning.copy.review_analysis",
      "Confirm, correct, dismiss or undo one exact copy proposal revision.",
      z.object({
        analysisId: id,
        kind: z.enum(["confirm", "correct", "dismiss", "unconfirm"]),
        expectedRevision: z.number().int().positive(),
        regions: z.array(reviewedRegion).max(250).default([]),
        idempotencyKey,
      }),
      { destructive: true },
    );
    registerWrite(
      "learning.evidence.decide",
      "Append an include/exclude decision without deleting immutable evidence.",
      z.object({
        evidenceId: id,
        state: z.enum(["included", "excluded"]),
        reason: z.string().trim().max(1_000).nullable().default(null),
        idempotencyKey,
      }),
    );
    registerWrite(
      "learning.plan.propose",
      "Create bounded learning recommendations without scheduling tasks.",
      z.object({
        yearId: id,
        subjectId: id.nullable().optional(),
        limit: z.number().int().min(1).max(20).default(5),
        availableMinutes: z.number().int().min(5).max(240).default(30),
        idempotencyKey,
      }),
    );
    registerWrite(
      "learning.plan.apply",
      "Create the authoritative personal planning task for one recommendation.",
      z.object({
        itemId: id,
        expectedRevision: z.number().int().positive(),
        scheduledAt: isoDate.nullable().default(null),
        dueAt: isoDate.nullable().default(null),
        idempotencyKey,
      }),
    );
    registerWrite(
      "learning.quiz.generate",
      "Create a bounded, sourced quiz artifact proposal for owned objectives; questions require review before progress evidence.",
      z.object({
        projectId: id.nullable().default(null),
        title: z.string().trim().min(1).max(160),
        objectiveIds: z.array(id).min(1).max(20),
        sourceVersionIds: z.array(id).min(1).max(500),
        questionCount: z.number().int().min(1).max(100).default(10),
        difficulty: z.number().min(0).max(1).nullable().default(null),
        idempotencyKey,
      }),
    );
    registerWrite(
      "learning.quiz.start",
      "Start an owned practice or progress quiz; no evidence is created on start.",
      z.object({
        documentId: id,
        mode: z.enum(["practice", "progress"]).default("practice"),
        idempotencyKey,
      }),
    );
  }
}

export const learningSurface: McpSurface = {
  scopes: ["avermate:learning.read", "avermate:learning.write"],
  register: registerLearningSurface,
};
