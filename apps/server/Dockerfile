# The whole workspace is installed rather than just the app: the server
# consumes @avermate/core as TypeScript source, so it has to be present.
FROM oven/bun:1.4.0-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY patches patches
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
# GPL-backed provider adapters are review/test-only until the project license is
# resolved. A production-only workspace install is therefore a release boundary,
# not just an image-size optimization.
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.0-alpine AS release
WORKDIR /app

# Preview and LaTeX workers use bounded child processes. Keeping the binaries
# in the runtime image makes production deterministic while local development
# remains zero-config (unsupported/failed is reported when a binary is absent).
RUN apk add --no-cache \
  ffmpeg \
  imagemagick \
  imagemagick-jpeg \
  imagemagick-webp \
  poppler-utils \
  tectonic

RUN mkdir -p /var/cache/avermate/tectonic \
  && chown -R bun:bun /var/cache/avermate/tectonic

ENV NODE_ENV=production \
  TECTONIC_CACHE_DIR=/var/cache/avermate/tectonic \
  TECTONIC_UNTRUSTED_MODE=1

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY packages/core packages/core
COPY apps/server apps/server

WORKDIR /app/apps/server
USER bun
EXPOSE 5000/tcp

# A failed migration must stop the release. Falling back to a forced schema
# push can hide a broken migration and mutate production outside the reviewed
# migration history.
ENTRYPOINT [ "sh", "-c", "bun run db:migrate && exec bun run start" ]
