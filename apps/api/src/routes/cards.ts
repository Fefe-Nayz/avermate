import { db } from "@/db";
import { cardLayouts } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
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

const pageParamSchema = z.object({
  page: z.enum(["dashboard"]),
});

const cardLayoutCardSchema = z.object({
  id: z.string().min(1).max(80),
  enabled: z.boolean(),
  position: z.number().int().min(0).max(100),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

const updateLayoutSchema = z.object({
  cards: z.array(cardLayoutCardSchema).max(40),
});

function ensureVerifiedSession(session: { user: User; session: Session } | null) {
  if (!session) {
    throw new HTTPException(401);
  }

  if (!session.user.emailVerified) {
    throw new HTTPException(403, { message: "Email verification is required" });
  }
}

app.get("/layouts/:page", zValidator("param", pageParamSchema), async (c) => {
  const session = c.get("session");
  ensureVerifiedSession(session);

  const { page } = c.req.valid("param");
  const layout = await db.query.cardLayouts.findFirst({
    where: and(
      eq(cardLayouts.userId, session!.user.id),
      eq(cardLayouts.page, page)
    ),
  });

  return c.json({
    layout: layout
      ? {
          ...layout,
          cards: JSON.parse(layout.cards),
        }
      : null,
  });
});

app.put(
  "/layouts/:page",
  zValidator("param", pageParamSchema),
  zValidator("json", updateLayoutSchema),
  async (c) => {
    const session = c.get("session");
    ensureVerifiedSession(session);

    const { page } = c.req.valid("param");
    const { cards } = c.req.valid("json");
    const now = new Date();
    const values = {
      userId: session!.user.id,
      page,
      cards: JSON.stringify(cards),
      createdAt: now,
      updatedAt: now,
    };

    const layout = await db
      .insert(cardLayouts)
      .values(values)
      .onConflictDoUpdate({
        target: [cardLayouts.userId, cardLayouts.page],
        set: {
          cards: values.cards,
          updatedAt: values.updatedAt,
        },
      })
      .returning()
      .get();

    return c.json({
      layout: {
        ...layout,
        cards,
      },
    });
  }
);

export default app;
