FROM ghcr.io/nginx/nginx-unprivileged:1.31.8-alpine-slim@sha256:b19233c62309c8e620732244f9d0d0008678854cb9c6c47898817e8dec93a9e3

LABEL org.opencontainers.image.source="https://github.com/YKDBontekoe/Riftwarden"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /srv/riftwarden/
