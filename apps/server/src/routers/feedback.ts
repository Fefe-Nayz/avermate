import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { feedback } from "../db/schema";
import { env } from "../lib/env";
import { protectedProcedure } from "../lib/orpc";

const feedbackInput = z.object({
  kind: z.enum(["bug", "idea", "question", "other"]).default("other"),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4000),
  /** Route, viewport and user agent — whatever makes a bug reproducible. */
  context: z.record(z.string(), z.string()).default({}),
});

const TONE: Record<string, number> = {
  bug: 0xef4444,
  idea: 0x22c55e,
  question: 0x3b82f6,
  other: 0xa1a1aa,
};

async function notifyDiscord(input: {
  kind: string;
  subject: string;
  message: string;
  context: Record<string, string>;
  from: string;
}): Promise<void> {
  if (env.DISABLE_FEEDBACK || !env.DISCORD_WEBHOOK_URL) {
    console.info(`[feedback] ${input.kind}: ${input.subject}`);
    return;
  }

  const fields = Object.entries(input.context)
    .slice(0, 10)
    .map(([name, value]) => ({
      name,
      value: value.slice(0, 256) || "—",
      inline: true,
    }));

  try {
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: input.subject.slice(0, 256),
            description: input.message.slice(0, 4000),
            color: TONE[input.kind] ?? TONE.other,
            footer: { text: input.from },
            fields,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (error) {
    // A webhook being down must not cost the user their message: it is already
    // committed to the database by the time we get here.
    console.error("[feedback] webhook failed", error);
  }
}

export const feedbackRouter = {
  submit: protectedProcedure
    .input(feedbackInput)
    .handler(async ({ context, input }) => {
      const user = context.session.user;

      const [created] = await db
        .insert(feedback)
        .values({
          kind: input.kind,
          subject: input.subject,
          message: input.message,
          context: JSON.stringify(input.context),
          userId: user.id,
        })
        .returning();

      await notifyDiscord({
        kind: input.kind,
        subject: input.subject,
        message: input.message,
        context: input.context,
        from: `${user.name} · ${user.email} · ${user.id}`,
      });

      return created;
    }),

  mine: protectedProcedure.handler(({ context }) =>
    db
      .select()
      .from(feedback)
      .where(eq(feedback.userId, context.session.user.id))
      .orderBy(desc(feedback.createdAt))
      .limit(20),
  ),
};
