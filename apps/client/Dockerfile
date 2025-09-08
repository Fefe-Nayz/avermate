# syntax=docker.io/docker/dockerfile:1

FROM oven/bun:1.2.21 AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
# RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package.json
COPY bun.lock bun.lock
COPY patches/ ./patches/
COPY ./apps/client/package.json ./apps/client/package.json

COPY . .  

RUN bun install --force
RUN bun add zod@latest

# remove @T@aad4350a3a656adb@@@1 in the bun install cache folder
RUN rm -rf /root/.bun/install/cache/@T@aad4350a3a656adb@@@1

# install 
RUN bun i https://pkg.pr.new/pingdotgg/uploadthing@1099

RUN bun run patch-package

RUN cd ./apps/client/ && bun install && bun run patch-package

# Rebuild the source code only when needed
FROM base AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY ./apps/client ./apps/client

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

ENV NEXT_PUBLIC_API_URL=https://api.avermate.fr
ENV NEXT_PUBLIC_CLIENT_URL=https://avermate.fr

RUN cd ./apps/client/ && bun run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
# COPY --from=builder --chown=nextjs:nodejs /app/apps/client/public ./apps/client/public
# COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/standalone ./apps/client/.next/standalone
# COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/static ./apps/client/.next/static

# COPY --from=builder --chown=nextjs:nodejs /app/apps/client/public ./apps/client/.next/standalone/public
# COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/static ./apps/client/.next/standalone/static

# COPY --from=builder --chown=nextjs:nodejs /app/apps/client/public ./apps/client/.next/standalone/.next/public
# COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/static ./apps/client/.next/standalone/.next/static

COPY --from=builder /app/apps/client/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/client/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
ENV HOSTNAME="0.0.0.0"
CMD ["bun", "run", "server.js"]