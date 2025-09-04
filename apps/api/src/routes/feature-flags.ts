import { db } from "@/db";
import { featureFlags } from "@/db/schema";
import type { Session, User } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

const router = new Hono<{
    Variables: {
        session: {
            user: User;
            session: Session;
        } | null;
    };
}>();

router.get("/", async (c) => {
    const session = c.get("session");

    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
        return c.json(
            {
                code: "EMAIL_NOT_VERIFIED",
                message: "Email verification is required",
            },
            403
        );
    }

    const flags = await db.query.featureFlags.findFirst({
        where: eq(featureFlags.userId, session.user.id)
    });

    if (!flags) return c.json({
        flags: {}
    });

    return c.json({ flags: flags.flags });
});

export default router;