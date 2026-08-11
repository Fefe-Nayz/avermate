import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { expo } from "@better-auth/expo";
import { oauthProvider } from "@better-auth/oauth-provider";
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

export const MCP_SCOPES = [
  "avermate:read",
  "avermate:write",
  "avermate:delete",
  "avermate:admin",
  "avermate:social.read",
  "avermate:social.manage",
  "avermate:social.moderate",
] as const;

export const mcpResourceUrl =
  env.MCP_RESOURCE_URL ?? `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/mcp`;
export const oauthIssuer = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/auth`;

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
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",

  database: drizzleAdapter(db, {
    provider: "sqlite",
    usePlural: true,
    schema,
  }),

  // better-auth rejects redirects and sign-ins from anywhere it does not
  // trust. In development that has to include the LAN address the app is
  // opened on; in production it is the configured client and nothing else.
  trustedOrigins: (request?: Request) => {
    // The mobile app redirects back through its own URL scheme, which has to
    // be trusted in every environment — it is the app, not an origin on the
    // network.
    const always = [env.CLIENT_URL, `${env.MOBILE_SCHEME}://`];
    if (isProduction || !request) return always;
    const origin = request.headers.get("origin");
    return origin && isAllowedOrigin(origin) ? [...always, origin] : always;
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
    // Email/password accounts do not receive an application session until
    // the OTP flow has proved ownership. OAuth providers keep their own
    // verified-email semantics, while the oRPC guard also protects any old
    // unverified session carried across a migration.
    requireEmailVerification: true,
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
    // The native app has no cookie jar: this hands the session back as a
    // token the client stores in the keychain and replays as a header.
    expo(),
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
    // OAuth access tokens are asymmetric JWTs. Session responses must not be
    // converted to JWTs: the plugin is present solely for OAuth signing/JWKS.
    jwt({
      disableSettingJwtHeader: true,
      jwt: { issuer: oauthIssuer, audience: mcpResourceUrl },
      jwks: { rotationInterval: 30 * 24 * 60 * 60 },
    }),
    oauthProvider({
      loginPage: `${env.CLIENT_URL}/auth/sign-in`,
      consentPage: `${env.CLIENT_URL}/auth/consent`,
      // Both discovery documents are mounted explicitly in src/index.ts.
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
      allowPublicClientPrelogin: true,
      scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      validAudiences: [mcpResourceUrl],
      grantTypes: ["authorization_code", "refresh_token"],
      clientRegistrationDefaultScopes: [
        "openid",
        "profile",
        "offline_access",
        "avermate:read",
      ],
      clientRegistrationAllowedScopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        ...MCP_SCOPES,
      ],
      // DCR was deprecated by MCP 2026-07-28 in favour of Client ID
      // Metadata Documents. Better Auth 1.6.26 has no stable CIMD endpoint,
      // so the transition is explicit and closed by default.
      allowDynamicClientRegistration: env.MCP_ENABLE_DCR,
      allowUnauthenticatedClientRegistration: env.MCP_ENABLE_DCR,
      scopeExpirations: {
        "avermate:delete": "15 minutes",
        "avermate:admin": "10 minutes",
        "avermate:social.manage": "30 minutes",
        "avermate:social.moderate": "10 minutes",
      },
    }),
  ],

  advanced: {
    // Keep in step with `COOKIE_PREFIX` in apps/mobile/lib/auth-client.ts. The
    // Expo plugin stores only the cookies whose name starts with the prefix it
    // was given, so a mismatch signs you in and then loses the session.
    cookiePrefix: "avermate",
    // In the two-service deployment the browser authenticates against the API
    // subdomain while SSR runs on the web subdomain. Opt in explicitly so the
    // same signed cookie reaches both; local development stays host-only.
    ...(env.AUTH_COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: env.AUTH_COOKIE_DOMAIN,
          },
        }
      : {}),
    database: { generateId: false },
  },
});

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session.session;
export type AuthUser = typeof auth.$Infer.Session.user;
