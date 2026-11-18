FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

LABEL org.opencontainers.image.source="https://github.com/YKDBontekoe/Riftwarden"

WORKDIR /srv/riftwarden
ENV NODE_ENV=production RIFT_PORT=8080 RIFT_DATA=/var/lib/riftwarden TSX_DISABLE_CACHE=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
    && install -d -m 0750 -o node -g node "$RIFT_DATA"
COPY tsconfig.json ./
COPY server/ server/
COPY src/ src/
COPY dist/ dist/

USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --retries=4 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.RIFT_PORT + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "tsx", "server/main.ts"]
