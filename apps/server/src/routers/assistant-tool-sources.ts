import { ORPCError } from "@orpc/server"
import {
  customMcpAuthKindSchema,
  customMcpDataCategorySchema,
  customMcpPlacementSchema,
} from "@avermate/agent-contracts"
import { z } from "zod"
import { customMcpService } from "../assistant/custom-mcp-service"
import { protectedProcedure } from "../lib/orpc"

const id = z.string().min(1).max(256)
const digest = z.string().regex(/^[a-f0-9]{64}$/)

async function call<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "The MCP connection request failed"
    throw new ORPCError(
      /not found/i.test(message)
        ? "NOT_FOUND"
        : /^NODE_MCP_CAPABILITY_OFFLINE$/u.test(message)
          ? "SERVICE_UNAVAILABLE"
          : /^NODE_MCP_TIMEOUT$/u.test(message)
            ? "GATEWAY_TIMEOUT"
            : "BAD_REQUEST",
      { message }
    )
  }
}

export const assistantToolSourcesRouter = {
  list: protectedProcedure.handler(({ context }) =>
    customMcpService.list(context.session.user.id)
  ),

  create: protectedProcedure
    .input(
      z.strictObject({
        name: z.string().trim().min(1).max(120),
        endpointUrl: z.string().trim().min(1).max(2_048),
        placement: customMcpPlacementSchema.default("hosted-core"),
        nodeId: id.nullable().optional(),
        authKind: customMcpAuthKindSchema.default("none"),
        credential: z.string().trim().min(1).max(8_192).nullable().optional(),
      })
    )
    .handler(({ context, input }) =>
      call(() =>
        customMcpService.create({
          ownerId: context.session.user.id,
          ...input,
        })
      )
    ),

  refresh: protectedProcedure
    .input(z.strictObject({ sourceId: id }))
    .handler(({ context, input }) =>
      call(() =>
        customMcpService.refresh({
          ownerId: context.session.user.id,
          sourceId: input.sourceId,
        })
      )
    ),

  review: protectedProcedure
    .input(
      z.strictObject({
        sourceId: id,
        expectedCatalogDigest: digest,
        tools: z
          .array(
            z.strictObject({
              remoteToolId: id,
              classification: z.enum(["read-only", "blocked"]),
              enabled: z.boolean(),
              allowedDataCategories: z
                .array(customMcpDataCategorySchema)
                .max(5),
            })
          )
          .max(500),
      })
    )
    .handler(({ context, input }) =>
      call(() =>
        customMcpService.review({
          ownerId: context.session.user.id,
          ...input,
        })
      )
    ),

  remove: protectedProcedure
    .input(z.strictObject({ sourceId: id }))
    .handler(({ context, input }) =>
      call(() =>
        customMcpService.remove(context.session.user.id, input.sourceId)
      )
    ),
}
