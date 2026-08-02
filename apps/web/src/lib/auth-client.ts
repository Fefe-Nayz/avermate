"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, emailOTPClient } from "better-auth/client/plugins";
import { env } from "./env";

export const authClient = createAuthClient({
  baseURL: env.apiUrl,
  basePath: "/api/auth",
  plugins: [emailOTPClient(), adminClient()],
  fetchOptions: { credentials: "include" },
});

export const { useSession, signIn, signOut, signUp } = authClient;
export type User = typeof authClient.$Infer.Session.user;
export type Session = typeof authClient.$Infer.Session.session;
