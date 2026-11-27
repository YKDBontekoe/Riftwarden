# Deploying Riftwarden

The backend runs on one server with Docker Compose; the static client is on Cloudflare Pages. Design and reasoning:
[docs/architecture/architecture-v2.md](../docs/architecture/architecture-v2.md), section 9.

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
   Set the `PRODUCTION_API_URL` repository secret to the HTTPS API origin used by the main-branch build and deploy jobs.
5. Cloudflare Pages: create the project `riftwarden` (custom domain `riftwarden.ykdbonte.dev`) and add the repository
   secrets `CLOUDFLARE_API_TOKEN` (Pages: edit) and `CLOUDFLARE_ACCOUNT_ID`. Until they exist the deploy job skips
   the client with a warning. Set `PRODUCTION_CLIENT_URL` in the GitHub Actions `production` environment to the
   client's HTTPS origin so the deploy job can verify the published build.

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
build by commit. The desktop release workflow creates its GitHub tag after production verification.

| Task | Command (in `~/stacks/riftwarden`) |
| --- | --- |
| Status of sim workers and rooms | `docker exec riftwarden-gateway riftwarden-gateway admin status` |
| Stop new rooms on a slot | `docker exec riftwarden-gateway riftwarden-gateway admin drain sim-blue:7201 on` (`off` to resume) |
| Logs | `docker compose --env-file .env --env-file images.env logs -f gateway sim-blue` |
| Force a retry of a failed build | `rm .failed-build` |
| Health | `curl -s 127.0.0.1:18084/health` |

Logs are JSON lines on stdout (`docker compose ... logs`). Observability (OpenTelemetry -> ClickHouse -> Grafana) is postponed; the gateway and workers export OTLP only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

### Desktop releases

The **Desktop checks** workflow builds Windows x64, macOS Intel and macOS Apple Silicon installers for each pull
request and push to `main`, and keeps them as GitHub Actions artifacts for seven days. These builds are unsigned.

After a successful production deployment, the **Desktop release** workflow builds a Windows x64 setup executable
and a universal macOS app and DMG, signs the updater artifacts, and publishes them as a GitHub release. It can also
be run manually on a deployed `main` commit. Each run adds its workflow run number to the patch component of the root
`package.json` version, giving desktop updates increasing versions without changing the browser release version.
The updater reads `latest.json` from the latest public GitHub release.

Set `TAURI_SIGNING_PRIVATE_KEY` to the complete contents of the updater private key and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to its password as GitHub Actions secrets. The public key is embedded in
`apps/client/src-tauri/tauri.conf.json`. Keep a secure backup of the private key. The macOS release uses ad-hoc
signing and is not notarized, so players must allow it in Privacy & Security. Windows installers are unsigned.
Updates on both platforms are verified with the Tauri signing key. A generated development release key is stored at
`/workspace/.riftwarden-updater.key` in the implementation environment and must be transferred to the repository
secret and backed up before that environment is removed. Do not commit the private key.
