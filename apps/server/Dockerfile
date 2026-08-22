# The whole workspace is installed rather than just the app: the server
# consumes @avermate/core as TypeScript source, so it has to be present.
FROM oven/bun:1.4.0-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY patches patches
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/agent-contracts/package.json packages/agent-contracts/package.json
# GPL-backed provider adapters are review/test-only until the project license is
# resolved. A production-only workspace install is therefore a release boundary,
# not just an image-size optimization.
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.0-alpine AS release
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY packages/core packages/core
COPY packages/agent-contracts packages/agent-contracts
COPY apps/server apps/server

WORKDIR /app/apps/server
USER bun
EXPOSE 5000/tcp

# A failed migration must stop the release. Falling back to a forced schema
# push can hide a broken migration and mutate production outside the reviewed
# migration history.
ENTRYPOINT [ "sh", "-c", "bun run db:migrate && exec bun run start" ]
