import { db } from "@/db";
import { users } from "@/db/schema";
import { auth, type Session, type User } from "@/lib/auth";
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
