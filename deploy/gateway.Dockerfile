# Rust gateway: the only public backend service (docs/architecture-v2.md section 9).
FROM rust:1.97-bookworm AS build
WORKDIR /src
# The image already has the pinned toolchain (rust-toolchain.toml would make rustup download components).
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY proto/ proto/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p riftwarden-gateway && cp target/release/riftwarden-gateway /riftwarden-gateway

# No shell, no package manager: `riftwarden-gateway health` / `admin ...` replace curl.
FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/YKDBontekoe/Riftwarden"
COPY --from=build /riftwarden-gateway /usr/local/bin/riftwarden-gateway
ENV RIFT_LISTEN=0.0.0.0:8080 RIFT_ADMIN_LISTEN=127.0.0.1:9090
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=4 CMD ["/usr/local/bin/riftwarden-gateway", "health"]
ENTRYPOINT ["/usr/local/bin/riftwarden-gateway"]
