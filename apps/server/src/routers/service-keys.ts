import { z } from "zod";
import { protectedProcedure } from "../lib/orpc";
import {
  clearServiceKey,
  listServiceKeys,
  setServiceKey,
} from "../lib/service-keys";

const kind = z.enum(["mistral", "transcription", "inference"]);

export const serviceKeysRouter = {
  list: protectedProcedure.handler(({ context }) =>
    listServiceKeys(context.session.user.id),
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

  clear: protectedProcedure
    .input(z.object({ kind }))
    .handler(({ context, input }) =>
      clearServiceKey(context.session.user.id, input.kind),
    ),
};
