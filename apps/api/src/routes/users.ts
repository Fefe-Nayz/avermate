import { db } from "@/db";
import { users } from "@/db/schema";
import { auth, type Session, type User } from "@/lib/auth";
import { ut } from "@/lib/uploadthing";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

/**
 * Delete User Avatar
 */
app.delete("/avatar", async (c) => {
  console.log("DELETE /users/avatar called");
  const session = c.get("session");

  if (!session) throw new HTTPException(401);

  // If email isn't verified
  // if (!session.user.emailVerified) {
  //   return c.json(
  //     { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
  //     403
  //   );
  // }

  const currentAvatarUrl = session.user.image;

  try {
    // Delete avatar from UploadThing if it exists and is from UploadThing
    if (currentAvatarUrl && currentAvatarUrl.startsWith("https://utfs.io")) {
      const avatarKey = currentAvatarUrl.split("/").pop();
      if (avatarKey) {
        await ut.deleteFiles(avatarKey);
      }
    }

    // Update user to remove avatar URL
    const updatedUser = await db
      .update(users)
      .set({ avatarUrl: null })
      .where(eq(users.id, session.user.id))
      .returning()
      .get();

    return c.json({ message: "Avatar deleted successfully", user: updatedUser });
  } catch (error) {
    console.error("Error deleting avatar:", error);
    throw new HTTPException(500, { message: "Failed to delete avatar" });
  }
});

const deleteUserParams = z.object({
  id: z.string().min(1).max(64),
});

app.delete("/:id", zValidator("param", deleteUserParams), async (c) => {
  const session = c.get("session");

  if (!session) throw new HTTPException(401);

  // If email isnt verified
  if (!session.user.emailVerified) {
    return c.json(
      { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
      403
    );
  }

  const { id } = c.req.valid("param");

  if (session.user.id !== id) throw new HTTPException(403);

  const user = await db
    .delete(users)
    .where(eq(users.id, session.user.id))
    .returning()
    .get();

  return c.json({ user });
});

/**
 * Reset User Account
 */
app.post("/reset", async (c) => {
  // const session = c.get("session");
  // if (!session) throw new HTTPException(401);

  // if (!session.user.emailVerified) {
  //   return c.json(
  //     { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
  //     403
  //   );
  // }

  // // reset user account (delete grades, averages, subjects and periods)
  // await db.delete(grades).where(eq(grades.userId, session.user.id));
  // await db.delete(customAverages).where(eq(customAverages.userId, session.user.id));
  // await db.delete(subjects).where(eq(subjects.userId, session.user.id));
  // await db.delete(periods).where(eq(periods.userId, session.user.id));

  // return c.json({ message: "User account reset successfully" });

  return c.json({ code: "RESET_ACCOUNT_FEATURE_HAS_BEEN_DELETED" }, 400);
});

export default app;
