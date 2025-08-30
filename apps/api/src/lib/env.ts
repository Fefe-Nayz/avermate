import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Database
    DATABASE_URL: z.string().url(),
    DATABASE_AUTH_TOKEN: z.string(),

    // Cache
    REDIS_URL: z.string().url(),

    // Better Auth
    BETTER_AUTH_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),

    // Client
    CLIENT_URL: z.string().url(),

    // OAuth

    // Microsoft OAuth
    MICROSOFT_CLIENT_ID: z.string(),
    MICROSOFT_CLIENT_SECRET: z.string(),

    // Google OAuth
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),

    // Resend
    RESEND_API_KEY: z.string(),
    EMAIL_FROM: z.string().email(),

    NODE_ENV: z.enum(["development", "production"]),

    DISCORD_TOKEN: z.string(),
    DISCORD_CHANNEL_ID: z.string(),

    // Dev
    DISABLE_FEEDBACK: z.coerce.boolean().optional().default(false),
    DISABLE_EMAIL: z.coerce.boolean().optional().default(false),
    DISABLE_RATE_LIMIT: z.coerce.boolean().optional().default(false),
    DISABLE_UPLOADTHING: z.coerce.boolean().optional().default(false),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
