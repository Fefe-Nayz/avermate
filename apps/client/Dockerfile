# syntax=docker.io/docker/dockerfile:1

FROM oven/bun:1.3.4-alpine AS base
WORKDIR /app

# ---------------- deps ----------------
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/package.json
RUN bun install

# ---------------- builder ----------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/apps/client
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=https://api.avermate.fr
ENV NEXT_PUBLIC_CLIENT_URL=https://avermate.fr
RUN bun run build

# ---------------- runner ----------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# These two are REQUIRED for standalone to serve assets:
COPY --from=builder /app/apps/client/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# IMPORTANT: run the file, don't "bun run server.js"
CMD ["bun", "./server.js"]
