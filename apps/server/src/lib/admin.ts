import { env } from "./env";

/**
 * Who counts as an administrator.
 *
 * Two sources, and both have to be honoured: the `role` column, which is what
 * the admin console writes, and `ADMIN_USER_IDS`, which is how the first
 * administrator exists at all on a fresh deployment. Checking only the column
 * would make that env var silently do nothing.
 */
const bootstrapIds = new Set(
  env.ADMIN_USER_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? [],
);

export function isAdmin(user: { id: string; role?: string | null }): boolean {
  return user.role === "admin" || bootstrapIds.has(user.id);
}

export function adminIds(): string[] {
  return [...bootstrapIds];
}
