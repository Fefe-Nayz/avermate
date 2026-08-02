import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : value === "true" || value === "1",
  )
  .default(false);

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_AUTH_TOKEN: z.string().optional(),

    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    ADMIN_USER_IDS: z.string().optional(),

    CLIENT_URL: z.url(),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.email().default("noreply@avermate.fr"),

    UPLOADTHING_TOKEN: z.string().optional(),

    DISCORD_WEBHOOK_URL: z.url().optional(),

    // Escape hatches for local development, where no third party is reachable.
    DISABLE_EMAIL: bool,
    DISABLE_FEEDBACK: bool,
    DISABLE_UPLOADS: bool,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export const isProduction = env.NODE_ENV === "production";
