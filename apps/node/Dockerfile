FROM oven/bun:1.4.0-alpine AS install
WORKDIR /app
COPY package.json bun.lock ./
COPY patches patches
COPY apps/node/package.json apps/node/package.json
COPY packages/agent-contracts/package.json packages/agent-contracts/package.json
RUN bun install --frozen-lockfile --production \
  --filter @avermate/node \
  --filter @avermate/agent-contracts

FROM oven/bun:1.4.0-alpine
WORKDIR /app
RUN addgroup -S -g 10001 avermate && adduser -S -D -H -u 10001 -G avermate avermate
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/node/node_modules ./apps/node/node_modules
COPY --from=install /app/packages/agent-contracts/node_modules ./packages/agent-contracts/node_modules
COPY apps/node ./apps/node
COPY packages/agent-contracts ./packages/agent-contracts
RUN mkdir -p /data/node /config && chown -R 10001:10001 /data /config
USER 10001:10001
WORKDIR /data
ENV NODE_ENV=production
EXPOSE 5188
CMD ["bun", "/app/apps/node/src/index.ts"]
