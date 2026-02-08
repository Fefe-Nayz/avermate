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
COPY --from=deps /app/apps/client/node_modules ./apps/client/node_modules
COPY . .

WORKDIR /app/apps/client
ENV PATH="/app/apps/client/node_modules/.bin:/app/node_modules/.bin:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=https://api.avermate.fr
ENV NEXT_PUBLIC_CLIENT_URL=https://avermate.fr

# Capture git commit hash and build in one step
RUN apk add --no-cache git nodejs && \
    export NEXT_PUBLIC_GIT_COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown') && \
    node ./node_modules/next/dist/bin/next build

# ---------------- runner ----------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone output (keeps apps/client/server.js)
COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/standalone /app

# IMPORTANT: copy assets NEXT TO where server.js is (apps/client)
COPY --from=builder --chown=nextjs:nodejs /app/apps/client/public /app/apps/client/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/static /app/apps/client/.next/static

USER nextjs
EXPOSE 3000

WORKDIR /app/apps/client
CMD ["bun", "server.js"]
