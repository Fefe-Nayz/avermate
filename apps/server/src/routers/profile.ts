import { eq } from "drizzle-orm";
import { z } from "zod";
import { UTApi } from "uploadthing/server";
import { db } from "../db";
import { users } from "../db/schema";
import { env } from "../lib/env";
import { badRequest, protectedProcedure } from "../lib/orpc";

/**
 * Avatars.
 *
 * The image goes through this server rather than straight to storage: the
 * upload token stays here, the file is already cropped and small by the time
 * it is sent, and the previous avatar can be deleted in the same request
 * instead of being orphaned.
 */

const uploads = env.UPLOADTHING_TOKEN
  ? new UTApi({ token: env.UPLOADTHING_TOKEN })
  : null;

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

/** The file key inside an UploadThing URL, for deleting the old one. */
function keyOf(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/f\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export const profileRouter = {
  uploadAvatar: protectedProcedure
    .input(z.object({ image: z.instanceof(File) }))
    .handler(async ({ context, input }) => {
      const user = context.session.user;

      if (input.image.size > MAX_BYTES) {
        badRequest("That image is too large — crop it or pick a smaller one");
      }
      if (!ALLOWED.includes(input.image.type)) {
        badRequest("Only PNG, JPEG and WebP images are supported");
      }
      if (!uploads || env.DISABLE_UPLOADS) {
        badRequest("Avatar uploads are not configured on this server");
      }

      const previous = keyOf(user.image ?? null);
      const result = await uploads.uploadFiles(
        new File([input.image], `${user.id}.png`, { type: input.image.type }),
      );

      if (result.error || !result.data) {
        badRequest("The upload failed. Try again.");
      }

      await db
        .update(users)
        .set({ avatarUrl: result.data.ufsUrl, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      // Only after the new one is safely stored.
      if (previous) await uploads.deleteFiles(previous).catch(() => undefined);

      return { url: result.data.ufsUrl };
    }),

  removeAvatar: protectedProcedure.handler(async ({ context }) => {
    const user = context.session.user;
    const key = keyOf(user.image ?? null);

    await db
      .update(users)
      .set({ avatarUrl: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    if (key && uploads) await uploads.deleteFiles(key).catch(() => undefined);
    return { ok: true };
  }),

  /** Whether the upload path is available, so the UI can hide what is off. */
  uploadsEnabled: protectedProcedure.handler(() => ({
    enabled: Boolean(uploads) && !env.DISABLE_UPLOADS,
  })),
};
