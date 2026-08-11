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
    /** Parent domain shared by the web and API services, for authenticated SSR. */
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    ADMIN_USER_IDS: z.string().optional(),

    /** Canonical OAuth resource identifier exposed in access-token audiences. */
    MCP_RESOURCE_URL: z.url().optional(),
    /** Separate HMAC key for multi-round-trip requestState (falls back to BETTER_AUTH_SECRET). */
    MCP_REQUEST_STATE_SECRET: z.string().min(32).optional(),
    /** Additional comma-separated HTTP Host values accepted by the MCP endpoint. */
    MCP_ALLOWED_HOSTS: z.string().optional(),
    /** Additional comma-separated browser Origins accepted by the MCP endpoint. */
    MCP_ALLOWED_ORIGINS: z.string().optional(),
    /** Temporary RFC 7591 bridge. Off unless explicitly enabled; CIMD is preferred. */
    MCP_ENABLE_DCR: bool,

    CLIENT_URL: z.url(),
    /** URL scheme the mobile app returns to after an OAuth round trip. */
    MOBILE_SCHEME: z.string().default("avermate"),
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

    // Escape hatches for local development, where no third party is reachable.
    DISABLE_EMAIL: bool,
    DISABLE_UPLOADS: bool,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export const isProduction = env.NODE_ENV === "production";
