/**
 * Promotes or demotes a site administrator.
 *
 *   bun scripts/set-admin.ts you@example.com
 *   bun scripts/set-admin.ts you@example.com --revoke
 *
 * `ADMIN_USER_IDS` already grants access without this, but it is a bootstrap
 * mechanism: it lives in the environment, not the database, so it does not
 * survive a change of host and cannot be granted to somebody else at runtime.
 * This writes the role that does.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { adminIds } from "../src/lib/admin";

const identifier = process.argv[2];
const revoke = process.argv.includes("--revoke");

if (!identifier) {
  console.error(
    "Usage: bun scripts/set-admin.ts <email or user id> [--revoke]",
  );
  process.exit(1);
}

const [user] = await db
  .select()
  .from(users)
  .where(
    identifier.includes("@")
      ? eq(users.email, identifier)
      : eq(users.id, identifier),
  )
  .limit(1);

if (!user) {
  console.error(`No account matches "${identifier}".`);
  process.exit(1);
}

await db
  .update(users)
  .set({ role: revoke ? "user" : "admin", updatedAt: new Date() })
  .where(eq(users.id, user.id));

console.info(
  `${user.email} is now ${revoke ? "a regular user" : "an administrator"} (${user.id}).`,
);

if (revoke && adminIds().includes(user.id)) {
  console.warn(
    "Note: this id is still listed in ADMIN_USER_IDS, which keeps granting access. Remove it there too.",
  );
}

process.exit(0);
