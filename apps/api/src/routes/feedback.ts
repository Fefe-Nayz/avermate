import { env } from "@/lib/env";
import { zValidator } from "@hono/zod-validator";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

const app = new Hono();

// Updated schema to accept images
const feedbackSchema = z.object({
  type: z.enum(["Général", "Bug", "Suggestion"]),
  subject: z.string().min(1, "Un titre est requis"),
  content: z
    .string()
    .min(10, "La remarque doit contenir au moins 10 caractères"),
  email: z.string().email("Adresse email invalide").optional(),
  image: z
    .string()
    .optional()
    .refine(
      (data) => {
        if (!data) return true;
        const isBase64 = /^data:image\/(png|jpeg|jpg);base64,/.test(data);
        const size = Buffer.byteLength(data.split(",")[1], "base64");
        return isBase64 && size <= 2 * 1024 * 1024; // Max size 2MB
      },
      { message: "Image invalide ou trop volumineuse" }
    ),
  errorStack: z.string().optional(),
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Je pense pas que c'est nécessaire
// client.once("ready", () => {
//   if (client.user) {
//     console.log(`Discord bot logged in as ${client.user.tag}`);
//   } else {
//     console.error("Discord bot user is null");
//   }
// });

if (!env.DISABLE_FEEDBACK) {
  client.login(env.DISCORD_TOKEN);
}

app.post("/", zValidator("json", feedbackSchema), async (c) => {
  if (env.DISABLE_FEEDBACK) {
    return c.json({ code: "FEEDBACK_FEATURE_IS_DISABLED" }, 200);
  }

  const { type, subject, content, email, image, errorStack } =
    c.req.valid("json");

  const feedbackMessage: any = {
    embeds: [
      {
        title: type,
        description: `**${subject}**\n${content} `,
        fields: [
          email
            ? { name: "Email", value: email }
            : { name: "Email", value: "Anonymous" },
        ],
        color:
          type === "Bug"
            ? 0xff0000
            : type === "Suggestion"
              ? 0x00ff00
              : 0x0000ff, // Red for bugs, green for suggestions, blue for general
        image: image
          ? {
            url: `attachment://feedback-image-${Date.now()}.png`, // Referencing the uploaded image
          }
          : undefined,
      },
    ],
  };

  if (image) {
    feedbackMessage.files = [
      {
        attachment: Buffer.from(image.split(",")[1], "base64"),
        name: `feedback-image-${Date.now()}.png`,
      },
      ...(errorStack ? [{
        attachment: Buffer.from(errorStack),
        name: `error-stack-${Date.now()}.txt`,
      }] : []),
    ];
  } else if (errorStack) {
    feedbackMessage.files = [{
      attachment: Buffer.from(errorStack),
      name: `error-stack-${Date.now()}.txt`,
    }];
  }

  try {
    const channel = await client.channels.fetch(env.DISCORD_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      throw new Error("Discord channel not found or is not text-based");
    }

    await (channel as TextChannel).send(feedbackMessage);

    return c.json({ message: "Feedback submitted successfully" });
  } catch (error) {
    console.error("Failed to send feedback to Discord", error);
    throw new HTTPException(500, { message: "Failed to send feedback" });
  }
});

export default app;
