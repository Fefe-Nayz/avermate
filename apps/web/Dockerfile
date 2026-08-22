# syntax=docker.io/docker/dockerfile:1

FROM oven/bun:1.4.0-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY patches patches
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/agent-contracts/package.json packages/agent-contracts/package.json
RUN bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

# The asset synchronizer intentionally addresses the workspace-root package.
# Bun keeps web-only dependencies in the app workspace, so expose that exact
# installed package at the path the verified copy step expects.
RUN ln -s /app/apps/web/node_modules/pyodide /app/node_modules/pyodide && \
    ln -s /app/apps/web/node_modules/zod /app/node_modules/zod

WORKDIR /app/apps/web
ENV PATH="/app/node_modules/.bin:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1

# Public origins are compile-time inputs in Next.js. Safe loopback defaults keep
# a standalone/self-host build from silently embedding the hosted deployment;
# hosted releases must pass their own explicit build args.
ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:5000
ARG NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Next's standalone output needs a real node binary at build time. The
# hash-pinned Pyodide subset is generated into public/ first, because invoking
# Next directly does not run package-manager prebuild hooks.
RUN apk add --no-cache nodejs && \
    bun scripts/sync-pyodide-assets.ts && \
    node ./node_modules/next/dist/bin/next build

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
