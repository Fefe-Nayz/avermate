import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin as adminPlugin, emailOTP } from "better-auth/plugins";
import { db } from "../db";
import * as schema from "../db/schema";
import { env, isProduction } from "./env";
import { isAllowedOrigin } from "./origins";
import {
  sendAccountDeletionConfirmation,
  sendEmailChangeConfirmation,
  sendOtpEmail,
  type Locale,
} from "./email";

const adminUserIds =
  env.ADMIN_USER_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? [];

const socialProviders: Record<string, unknown> = {};
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    prompt: "consent",
  };
}
if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
  socialProviders.microsoft = {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  };
}

/**
 * better-auth hands hooks either a `Request` or its own endpoint context
 * depending on the plugin, and both carry the headers we want. French is the
 * default: it is what the overwhelming majority of accounts read.
 */
function localeOf(source: unknown): Locale {
  const headers =
    source && typeof source === "object" && "headers" in source
      ? (source as { headers?: Headers }).headers
      : undefined;
  const header = headers?.get?.("accept-language") ?? "";
  return header.toLowerCase().startsWith("en") ? "en" : "fr";
}

export const auth = betterAuth({
  appName: "Avermate",
  telemetry: { enabled: false },

  database: drizzleAdapter(db, {
    provider: "sqlite",
    usePlural: true,
    schema,
  }),

  // better-auth rejects redirects and sign-ins from anywhere it does not
  // trust. In development that has to include the LAN address the app is
  // opened on; in production it is the configured client and nothing else.
  trustedOrigins: (request?: Request) => {
    if (isProduction || !request) return [env.CLIENT_URL];
    const origin = request.headers.get("origin");
    return origin && isAllowedOrigin(origin)
      ? [env.CLIENT_URL, origin]
      : [env.CLIENT_URL];
  },

  session: {
    expiresIn: 30 * 24 * 60 * 60,
    updateAge: 15 * 24 * 60 * 60,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },

  account: {
    accountLinking: { enabled: true },
  },

  user: {
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }, request) => {
        await sendAccountDeletionConfirmation({
          to: user.email,
          url,
          locale: localeOf(request),
        });
      },
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async (
        data: { user: { name: string }; newEmail: string; url: string },
        request: unknown,
      ) => {
        await sendEmailChangeConfirmation({
          to: data.newEmail,
          name: data.user.name,
          url: data.url,
          locale: localeOf(request),
        });
      },
    },
    fields: { image: "avatarUrl" },
  },

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    password: {
      hash: (password) => Bun.password.hash(password, "argon2id"),
      verify: ({ hash, password }) =>
        Bun.password.verify(password, hash, "argon2id"),
    },
  },

  socialProviders,

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }, request) => {
        await sendOtpEmail({
          to: email,
          otp,
          kind: type,
          locale: localeOf(request),
        });
      },
    }),
    adminPlugin({
      defaultRole: "user",
      adminRoles: ["admin"],
      adminUserIds,
    }),
  ],

  advanced: {
    cookiePrefix: "avermate",
    database: { generateId: false },
  },
});

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session.session;
export type AuthUser = typeof auth.$Infer.Session.user;
