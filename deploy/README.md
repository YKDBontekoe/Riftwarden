# Deploying Riftwarden

The backend runs on one server with Docker Compose; the static client is on Cloudflare Pages. Design and reasoning:
[docs/architecture-v2.md](../docs/architecture-v2.md), section 9.

## One-time setup on the server

1. Copy this directory to `~/stacks/riftwarden` and create `.env` from `.env.example` (long random passwords).
2. Log Docker in to GHCR for the deploy script: `DOCKER_CONFIG=~/stacks/riftwarden/.docker docker login ghcr.io`.
3. Install the systemd user units from `systemd/` (`riftwarden-deploy.timer`, `riftwarden-deploy.service`,
   `riftwarden-tunnel.service`) and `systemctl --user enable --now riftwarden-deploy.timer riftwarden-tunnel.service`.
4. In the active tunnel config, route `riftwarden-api.ykdbonte.dev` to the gateway's local port. The
   default is `18084` (`cloudflared.example.yml`). Use `18085` if the v2 stack was staged alongside the old stack.
   Keep the existing client ingress until Pages takes over the client domain. Validate the config and restart
   `riftwarden-tunnel.service`, then create the proxied DNS record with
   `cloudflared tunnel route dns riftwarden riftwarden-api.ykdbonte.dev`. If this host has only tunnel credentials,
   create the proxied CNAME in the Cloudflare dashboard instead, targeting the existing tunnel's
   `<tunnel-uuid>.cfargotunnel.com` hostname.
   Verify `curl --fail https://riftwarden-api.ykdbonte.dev/health` returns the gateway's revision and worker count.
   The first-level hostname is covered by Cloudflare Universal SSL on a full zone.
5. Cloudflare Pages: create the project `riftwarden` (custom domain `riftwarden.ykdbonte.dev`) and add the repository
   secrets `CLOUDFLARE_API_TOKEN` (Pages: edit) and `CLOUDFLARE_ACCOUNT_ID`. Until they exist the deploy job skips
   the client with a warning.

The first run of `deploy.sh` starts everything; later runs roll the stack (below). The previous Node image and its
`profiles` volume are no longer used (everyone starts fresh; `docker volume rm riftwarden_profiles` once happy).

## What a deploy does

`deploy.sh` (every minute, one at a time) pulls `riftwarden-gateway:production` and `riftwarden-worker:production` and,
when they changed: updates the infrastructure, the rules worker, then the gateway (rolled back with the rules worker
if it is not healthy on the new build; a failed build is not retried), then drains and replaces each sim slot in turn,
so running co-op operations finish on the old version (up to `DRAIN_TIMEOUT`, 30 min by default).

## Operating

The root `package.json` is the release version source. Bump `major.minor.patch` in the release PR and use the
owner-only production workflow on `main`. Pages publishes `/version.json` with the release version and commit,
and both images carry the same OCI version and revision labels. The deploy and health checks identify the exact
build by commit. After production verification, create the GitHub release tag `v<version>` at that deployed commit.

| Task | Command (in `~/stacks/riftwarden`) |
| --- | --- |
| Status of sim workers and rooms | `docker exec riftwarden-gateway riftwarden-gateway admin status` |
| Stop new rooms on a slot | `docker exec riftwarden-gateway riftwarden-gateway admin drain sim-blue:7201 on` (`off` to resume) |
| Logs | `docker compose --env-file .env --env-file images.env logs -f gateway sim-blue` |
| Force a retry of a failed build | `rm .failed-build` |
| Health | `curl -s 127.0.0.1:18084/health` |

Logs are JSON lines on stdout (`docker compose ... logs`). Observability (OpenTelemetry -> ClickHouse -> Grafana) is postponed; the gateway and workers export OTLP only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
