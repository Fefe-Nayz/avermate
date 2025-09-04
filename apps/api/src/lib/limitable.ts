import { env } from "@/lib/env";
import { Limitable, RedisAdapter } from "@limitable/ratelimit";

const adapter = new RedisAdapter({
  url: env.REDIS_URL,
});

export const limitable = new Limitable({
  appId: "avermate",
  adapter: adapter,
  rules: {
    // Default window for read operations
    default: {
      // 10 minutes
      windowMs: 10 * 60 * 1000,
      maxRequest: 500,
    },

    // Restricted window for create, update, delete operations
    restricted: {
      // 10 minutes
      windowMs: 10 * 60 * 1000,
      maxRequest: 35,
    },

    // Use preset
    preset: {
      // 10 req/1h
      windowMs: 60 * 60 * 1000,
      maxRequest: 10,
    },

    // Send email verification
    emailRestricted: {
      // 3 req/1h
      windowMs: 60 * 60 * 1000,
      maxRequest: 3,
    },

    // Sign In
    authRestricted: {
      // 10 req/10m
      windowMs: 60 * 60 * 1000,
      maxRequest: 20,
    },

    aiAutoFill: {
      // 10req/weeks
      windowMs: 7 * 24 * 60 * 60 * 1000,
      maxRequest: 10,
    }
  },
});
