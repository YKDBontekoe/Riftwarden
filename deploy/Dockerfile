FROM ghcr.io/nginx/nginx-unprivileged:1.30.6-alpine-slim@sha256:30b5b66412019e6860fb900420758f664f770082d142b614db0d9afadfede1d3

LABEL org.opencontainers.image.source="https://github.com/YKDBontekoe/Riftwarden"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /srv/riftwarden/
