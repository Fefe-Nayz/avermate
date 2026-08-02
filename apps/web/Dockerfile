# syntax=docker.io/docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
RUN bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/apps/web
ENV PATH="/app/node_modules/.bin:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=https://api.avermate.fr
ENV NEXT_PUBLIC_APP_URL=https://avermate.fr

# Next's standalone output needs a real node binary at build time.
RUN apk add --no-cache nodejs && node ./node_modules/next/dist/bin/next build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone /app
# Static assets have to sit beside the server entrypoint the trace produced.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public /app/apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static /app/apps/web/.next/static

USER nextjs
EXPOSE 3000

WORKDIR /app/apps/web
CMD ["bun", "server.js"]
