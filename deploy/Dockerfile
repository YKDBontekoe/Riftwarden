FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

LABEL org.opencontainers.image.source="https://github.com/YKDBontekoe/Riftwarden"

WORKDIR /srv/riftwarden
ENV NODE_ENV=production RIFT_PORT=8080 RIFT_DIST=/srv/riftwarden/dist TSX_DISABLE_CACHE=1
RUN corepack enable

# The server workspace and the packages it imports (the client app is prebuilt into dist/).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ packages/
COPY apps/server/ apps/server/
RUN pnpm install --prod --frozen-lockfile --filter "@riftwarden/server..." && rm -rf /root/.cache /root/.local/share/pnpm
COPY dist/ dist/

USER node
WORKDIR /srv/riftwarden/apps/server
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --retries=4 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.RIFT_PORT + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "tsx", "main.ts"]
