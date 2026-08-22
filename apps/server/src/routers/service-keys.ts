import { z } from "zod";
import { protectedProcedure } from "../lib/orpc";
import {
  clearServiceKey,
  listServiceKeys,
  listProviderServiceKeyMetadata,
  revokeProviderServiceKey,
  setServiceKey,
  setProviderServiceKey,
} from "../lib/service-keys";
import {
  validateProviderCredential,
  type SupportedKeyProvider,
} from "../lib/provider-key-validation";

const kind = z.enum(["mistral", "transcription", "inference"]);
const provider = z.enum(["mistral", "openai", "openrouter", "elevenlabs"]);

export const serviceKeysRouter = {
  list: protectedProcedure.handler(({ context }) =>
    listServiceKeys(context.session.user.id),
  ),

  metadata: protectedProcedure.handler(({ context }) =>
    listProviderServiceKeyMetadata(context.session.user.id),
  ),

  set: protectedProcedure
    .input(
      z.object({
        kind,
        key: z.string().trim().min(1).max(4096),
      }),
    )
    .handler(({ context, input }) =>
      setServiceKey(context.session.user.id, input.kind, input.key),
    ),

  setValidated: protectedProcedure
    .input(
      z.strictObject({
        kind,
        provider,
        key: z.string().trim().min(1).max(4096),
        scopes: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
      }),
    )
    .handler(({ context, input }) =>
      setProviderServiceKey({
        userId: context.session.user.id,
        kind: input.kind,
        provider: input.provider,
        plaintext: input.key,
        scopes: input.scopes,
        validate: (key) =>
          validateProviderCredential(
            input.provider as SupportedKeyProvider,
            key,
          ),
        correlationId:
          context.headers.get("x-request-id") ?? crypto.randomUUID(),
      }),
    ),

  revoke: protectedProcedure
    .input(
      z.strictObject({
        kind,
        reason: z.string().trim().min(1).max(512),
      }),
    )
    .handler(({ context, input }) =>
      revokeProviderServiceKey({
        userId: context.session.user.id,
        kind: input.kind,
        reason: input.reason,
        correlationId:
          context.headers.get("x-request-id") ?? crypto.randomUUID(),
      }),
    ),

  clear: protectedProcedure
    .input(z.object({ kind }))
    .handler(({ context, input }) =>
      clearServiceKey(context.session.user.id, input.kind),
    ),
};
