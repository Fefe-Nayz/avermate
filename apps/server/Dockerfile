# The whole workspace is installed rather than just the app: the server
# consumes @avermate/core as TypeScript source, so it has to be present.
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-alpine AS release
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules node_modules
COPY packages/core packages/core
COPY apps/server apps/server

WORKDIR /app/apps/server
USER bun
EXPOSE 5000/tcp

# `push` is the fallback for a database that predates the migrations folder.
ENTRYPOINT [ "sh", "-c", "bun run db:migrate || bun run db:push --force; exec bun run start" ]
