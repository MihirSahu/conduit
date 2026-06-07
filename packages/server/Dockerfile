# syntax=docker/dockerfile:1

FROM oven/bun:1.2 AS build
WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.base.json biome.json ./
COPY packages ./packages
COPY examples ./examples

RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV CONDUIT_DOCKER=1
ENV CONDUIT_HOST=0.0.0.0
ENV CONDUIT_PORT=3000

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/provider-chatgpt/package.json ./packages/provider-chatgpt/package.json
COPY --from=build /app/packages/provider-chatgpt/dist ./packages/provider-chatgpt/dist
COPY --from=build /app/packages/cli/package.json ./packages/cli/package.json
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/examples/node-script/package.json ./examples/node-script/package.json

RUN bun install --production --frozen-lockfile

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+(process.env.CONDUIT_PORT||3000)+'/health'); if(!r.ok) process.exit(1)"

ENTRYPOINT ["bun", "packages/server/dist/index.js"]
CMD ["serve"]
