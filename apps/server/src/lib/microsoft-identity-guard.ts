import type { Client } from "@libsql/client";
import { z } from "zod";

const microsoftProviderIds = new Set(["microsoft", "microsoft-entra-id"]);
const microsoftCallbackPath =
  /^\/api\/auth\/(?:oauth2\/)?callback\/(microsoft|microsoft-entra-id)\/?$/;
const microsoftProviderWritePaths = new Set([
  "/api/auth/sign-in/social",
  "/api/auth/link-social",
  "/api/auth/sign-in/oauth2",
  "/api/auth/oauth2/link",
]);
const providerWriteBodySchema = z
  .object({
    provider: z.string().optional(),
    providerId: z.string().optional(),
  })
  .passthrough();

/**
 * Microsoft changed its Better Auth account key from the pairwise `sub` to
 * the Entra directory `oid` in 1.7. A callback is an authentication write too:
 * blocking only the initial redirect would still let an in-flight login create
 * a duplicate account during a cutover.
 */
export async function isMicrosoftIdentityWrite(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (microsoftCallbackPath.test(pathname)) return true;
  if (request.method !== "POST" || !microsoftProviderWritePaths.has(pathname)) {
    return false;
  }

  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const parsed = providerWriteBodySchema.safeParse(body);
  if (!parsed.success) return false;
  const provider = parsed.data.provider ?? parsed.data.providerId;
  return provider !== undefined && microsoftProviderIds.has(provider);
}

/**
 * Synthetic/local issuers are the signature left by the pre-1.7 backfill.
 * A valid Microsoft 1.7 account is written from a verified ID token and has
 * the configured provider's tenant-specific login.microsoftonline.com issuer
 * plus its `oid`. Email is intentionally absent from this decision: Microsoft
 * email is mutable and not an identity proof.
 */
export async function hasUnsafeMicrosoftIdentity(client: Client) {
  const result = await client.execute(`
    SELECT 1 AS unsafe
    FROM accounts
    WHERE providerId IN ('microsoft', 'microsoft-entra-id')
      AND (
        issuer IS NULL OR issuer = ''
        OR issuer NOT LIKE 'https://login.microsoftonline.com/%/v2.0'
      )
    LIMIT 1
  `);
  return result.rows.length > 0;
}

export async function guardMicrosoftIdentityWrite(
  request: Request,
  client: Client,
) {
  if (!(await isMicrosoftIdentityWrite(request))) return null;

  if (!(await hasUnsafeMicrosoftIdentity(client))) return null;

  return Response.json(
    {
      error: "microsoft_identity_migration_required",
      message:
        "Microsoft sign-in and account linking are paused until the existing account identity is migrated by an administrator.",
    },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
