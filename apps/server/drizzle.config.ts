import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

/**
 * A local file and a hosted Turso database speak the same SQL but drizzle-kit
 * reaches them through different drivers, so the dialect follows the URL.
 */
export default authToken
  ? defineConfig({
      schema: "./src/db/schema/index.ts",
      out: "./drizzle",
      dialect: "turso",
      dbCredentials: { url, authToken },
    })
  : defineConfig({
      schema: "./src/db/schema/index.ts",
      out: "./drizzle",
      dialect: "sqlite",
      dbCredentials: { url },
    });
