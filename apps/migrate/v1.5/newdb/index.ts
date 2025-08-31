import * as schema from "./schema";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// Create libsql client
const newClient = createClient({
  url: process.env.NEW_DB_URL!,
  authToken: process.env.NEW_DB_AUTH_TOKEN!,
});

// Create drizzle client
export const newDb = drizzle(newClient, {
  casing: "snake_case",
  schema,
});
