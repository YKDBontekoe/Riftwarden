# TypeScript workers (rules and sim roles, RIFT_WORKER_ROLE): one esbuild bundle, no node_modules at runtime.
FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --frozen-lockfile --filter "@riftwarden/worker..." && node apps/worker/build.mjs

FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
LABEL org.opencontainers.image.source="https://github.com/YKDBontekoe/Riftwarden"
WORKDIR /srv/worker
ENV NODE_ENV=production RIFT_WORKER_ROLE=rules RIFT_WORKER_LISTEN=0.0.0.0:7101
COPY --from=build /src/apps/worker/dist/ ./
USER node
# Liveness: the worker port accepts connections.
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=4 \
    CMD ["node", "-e", "const [h,p]=process.env.RIFT_WORKER_LISTEN.split(':');require('node:net').connect(+p,h==='0.0.0.0'?'127.0.0.1':h).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "main.mjs"]
