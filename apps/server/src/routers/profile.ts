import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { accounts, files, users } from "../db/schema";
import { auth } from "../lib/auth";
import { badRequest, protectedProcedure } from "../lib/orpc";
import {
  deleteFile,
  deleteLegacyStorageKey,
  legacyKeyOf,
  resolveIncomingFile,
  storageEnabled,
} from "../lib/storage";

/**
 * Avatars.
 *
 * The image goes through this server rather than straight to storage: the
 * upload token stays here, the file is already cropped and small by the time
 * it is sent, and the previous avatar can be deleted in the same request
 * instead of being orphaned.
 */

async function deleteAvatarObject(userId: string, url: string | null) {
  if (!url) return;
  const [stored] = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.url, url),
        eq(files.status, "stored"),
      ),
    )
    .limit(1);
  if (stored) {
    await deleteFile(userId, stored.id);
    return;
  }
  const key = legacyKeyOf(url);
  if (key) await deleteLegacyStorageKey(key);
}

export const profileRouter = {
  /** Minimal authenticated identity needed by the server-rendered web shell. */
  viewer: protectedProcedure.handler(async ({ context }) => {
    // Read mutable profile fields from the source of truth. Better Auth's
    // signed cookie cache can legitimately contain the previous name/avatar
    // for a few minutes after an update.
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.avatarUrl,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, context.session.user.id))
      .limit(1);

    if (!user) {
      throw new ORPCError("UNAUTHORIZED", { message: "Session user missing" });
    }
    return { ...user, createdAt: user.createdAt.toISOString() };
  }),

  uploadAvatar: protectedProcedure
    .input(
      z
        .object({
          image: z.instanceof(File).optional(),
          fileId: z.string().min(1).optional(),
        })
        .refine((input) => Boolean(input.image) !== Boolean(input.fileId), {
          message: "Provide exactly one uploaded avatar",
        }),
    )
    .handler(async ({ context, input }) => {
      const user = context.session.user;
      const [current] = await db
        .select({ avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      const stored = await resolveIncomingFile({
        userId: user.id,
        purpose: "avatar",
        file: input.image,
        fileId: input.fileId,
        nameHint: `${user.id}.png`,
      });
      try {
        await db
          .update(users)
          .set({ avatarUrl: stored.url, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      } catch (error) {
        await deleteFile(user.id, stored.id).catch(() => undefined);
        throw error;
      }

      // Only after the new one is safely stored.
      await deleteAvatarObject(user.id, current?.avatarUrl ?? null);

      return { url: stored.url };
    }),

  removeAvatar: protectedProcedure.handler(async ({ context }) => {
    const user = context.session.user;
    const [current] = await db
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    await db
      .update(users)
      .set({ avatarUrl: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await deleteAvatarObject(user.id, current?.avatarUrl ?? null);
    return { ok: true };
  }),

  /** Whether the upload path is available, so the UI can hide what is off. */
  uploadsEnabled: protectedProcedure.handler(() => ({
    enabled: storageEnabled(),
  })),

  /**
   * OAuth-only accounts have no credential row. Better Auth intentionally
   * keeps `setPassword` server-only, so this narrow bridge is authenticated by
   * the same session headers and refuses to overwrite an existing password.
   */
  setPassword: protectedProcedure
    .input(
      z.object({
        newPassword: z.string().min(8).max(128),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [credential] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.providerId, "credential"),
          ),
        )
        .limit(1);
      if (credential) {
        badRequest("Use change password for an account that already has one");
      }

      try {
        await auth.api.setPassword({
          body: { newPassword: input.newPassword },
          headers: context.headers,
        });
      } catch (error) {
        console.error("[auth] set password failed", error);
        badRequest("The password could not be set");
      }

      return { ok: true };
    }),
};
