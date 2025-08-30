FROM oven/bun:1.2.21 AS build

WORKDIR /app

COPY package.json package.json
COPY bun.lockb bun.lockb
COPY ./apps/api/package.json ./apps/api/package.json

RUN cd ./apps/api/ && bun install

COPY ./apps/api ./apps/api

FROM oven/bun:alpine AS release

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api apps/api

WORKDIR /app/apps/api

USER bun

EXPOSE 5000/tcp

ENTRYPOINT [ "bun", "run", "start" ]