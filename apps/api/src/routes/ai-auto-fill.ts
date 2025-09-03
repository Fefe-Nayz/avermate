import { db } from "@/db";
import { featureFlags, usages } from "@/db/schema";
import type { Session, User } from "@/lib/auth";
import { env } from "@/lib/env";
import { limitable } from "@/lib/limitable";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { HTTPException } from "hono/http-exception";

const router = new Hono<{
    Variables: {
        session: {
            user: User;
            session: Session;
        } | null;
    };
}>();

const AI_AUTO_FILL_USAGE_LIMIT = 100;
const AI_AUTO_FILL_USAGE_RESET_INTERVAL_MS = 365 * 30 * 24 * 60 * 60 * 1000;
const AI_AUTO_FILL_ENABLED_TO_ALL_USERS = false;

router.post("/", async (c) => {
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

    // Check rate limit
    if (!env.DISABLE_RATE_LIMIT) {
        const info = getConnInfo(c);
        const forwardedFor = c.req.header("x-forwarded-for");
        const identifier =
            session?.user?.id || forwardedFor || info?.remote?.address || "anon";

        const { isExceeded, remaining, limit, resetIn } = await limitable.verify(
            identifier,
            "aiAutoFill"
        );

        c.header("RateLimit-Limit", limit.toString());
        c.header("RateLimit-Remaining", remaining.toString());
        c.header("RateLimit-Reset", resetIn.toString());

        if (isExceeded)
            return c.json(
                {
                    code: "ERR_RATE_LIMIT_EXCEEDED",
                    message: "You're being rate limited!",
                },
                429
            );
    }

    // Check feature flags
    if (!AI_AUTO_FILL_ENABLED_TO_ALL_USERS) {
        const flags = await db.query.featureFlags.findFirst({
            where: eq(featureFlags.userId, session.user.id)
        });

        if (!flags?.flags?.AI_AUTO_FILL) {
            return c.json(
                {
                    code: "ERR_FEATURE_NOT_ENABLED",
                    message: "AI Auto Fill is not enabled for your account.",
                },
                403
            );
        }
    }

    // Get usage
    const usage = await db.query.usages.findFirst({
        where: eq(usages.userId, session.user.id)
    });

    // Check usage limit
    if (usage && usage.aiAutoFillUsageCount >= AI_AUTO_FILL_USAGE_LIMIT) {
        // Check if reset date has reached else reject request
        const nextResetAt = new Date(usage.resetAt.getTime() + AI_AUTO_FILL_USAGE_RESET_INTERVAL_MS);

        if (usage.resetAt >= nextResetAt) {
            // Reset usage count
            await db.update(usages).set({
                aiAutoFillUsageCount: 1,
                resetAt: new Date(),
            }).where(eq(usages.userId, session.user.id));
        } else {
            return c.json(
                {
                    code: "ERR_USAGE_LIMIT_EXCEEDED",
                    message: "You've reached your usage limit for this feature.",
                },
                429
            );
        }
    }

    // Increment usage
    await db.insert(usages).values({
        userId: session.user.id,
        aiAutoFillUsageCount: 1,
    }).onConflictDoUpdate({
        target: usages.userId,
        set: {
            aiAutoFillUsageCount: sql`${usages.aiAutoFillUsageCount} + 1`,
        },
    });

    // Handle request
    return c.json({ success: true });
});

export default router;