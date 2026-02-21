import { env } from "@/lib/env";
import { createAuthClient } from "better-auth/react";
import { adminClient, emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_API_URL,
  fetchOptions: {
    throw: true,
  },
  plugins: [emailOTPClient(), adminClient()],
});
