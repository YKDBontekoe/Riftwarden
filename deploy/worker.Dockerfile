# TypeScript workers (rules and sim roles, RIFT_WORKER_ROLE): one esbuild bundle, no node_modules at runtime.
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --frozen-lockfile --filter "@riftwarden/worker..." && node apps/worker/build.mjs

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
LABEL org.opencontainers.image.source="https://github.com/YKDBontekoe/Riftwarden"
WORKDIR /srv/worker
ENV NODE_ENV=production RIFT_WORKER_ROLE=rules RIFT_WORKER_LISTEN=0.0.0.0:7101
COPY --from=build /src/apps/worker/dist/ ./
USER node
# Liveness: the worker port accepts connections.
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=4 \
    CMD ["node", "-e", "const [h,p]=process.env.RIFT_WORKER_LISTEN.split(':');require('node:net').connect(+p,h==='0.0.0.0'?'127.0.0.1':h).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "main.mjs"]
