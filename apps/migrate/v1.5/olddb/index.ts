import * as schema from "./schema";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// Create libsql client
const oldClient = createClient({
  url: process.env.OLD_DB_URL!,
  authToken: process.env.OLD_DB_AUTH_TOKEN!,
});

// Create drizzle client
export const oldDb = drizzle(oldClient, {
  casing: "snake_case",
  schema,
});
