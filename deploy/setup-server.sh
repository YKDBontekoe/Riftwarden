#!/usr/bin/env bash
# One-time (re-runnable) setup of the Riftwarden v2 backend on the server, as the user that runs the stack:
#   git clone https://github.com/YKDBontekoe/Riftwarden && bash Riftwarden/deploy/setup-server.sh
# What it does (README "One-time setup on the server"):
#   1. copies compose.yml + deploy.sh to ~/stacks/riftwarden, creates .env with a random database password
#   2. stops a previous (pre-v2) stack in that directory after asking (volumes are kept)
#   3. GHCR login for the deploy script (skipped when the images are public)
#   4. Cloudflare Tunnel `riftwarden`: api.riftwarden.ykdbonte.dev -> gateway, DNS record
#   5. systemd user units (deploy timer + tunnel), linger, first deploy, health checks
# Needs: docker (with compose), cloudflared, curl, flock, systemd user session.
set -euo pipefail

STACK=${RIFT_STACK_DIR:-$HOME/stacks/riftwarden}
API_HOST=${RIFT_API_HOST:-api.riftwarden.ykdbonte.dev}
TUNNEL=${RIFT_TUNNEL:-riftwarden}
REGISTRY=${RIFT_REGISTRY:-ghcr.io/ykdbontekoe}
SRC=$(cd -- "$(dirname -- "$0")" && pwd)
UNITS=$HOME/.config/systemd/user

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok() { printf '   \033[32mok\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!!\033[0m %s\n' "$*"; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "   $1 [y/N] " a; [[ "$a" =~ ^[Yy] ]]; }

step "Checking tools"
for t in docker curl flock systemctl; do command -v "$t" >/dev/null || die "$t is not installed"; done
docker compose version >/dev/null 2>&1 || die "docker compose (v2 plugin) is not installed"
docker info >/dev/null 2>&1 || die "this user cannot talk to Docker (add it to the docker group, then log in again)"
CLOUDFLARED=$(command -v cloudflared || true)
[[ -n "$CLOUDFLARED" ]] || die "cloudflared is not installed (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)"
ok "docker, compose, cloudflared ($CLOUDFLARED)"

step "Stack directory $STACK"
mkdir -p "$STACK"
if [[ -f "$STACK/compose.yml" ]] && ! grep -q 'riftwarden-gateway' "$STACK/compose.yml"; then
    warn "$STACK holds a previous (pre-v2) stack."
    if ask "Stop it (docker compose down, volumes are KEPT) and back up its files?"; then
        systemctl --user stop riftwarden-deploy.timer riftwarden-deploy.service 2>/dev/null || true
        (cd "$STACK" && docker compose down --remove-orphans) || warn "compose down failed; check 'docker ps'"
        backup="$STACK.pre-v2-$(date +%Y%m%d%H%M%S)"
        cp -a "$STACK" "$backup" && ok "backup in $backup"
        rm -f "$STACK/images.env" "$STACK/.failed-build"
    else
        die "stop the old stack first, then run this again"
    fi
fi
owner=$(docker ps --filter publish=18084 --format '{{.Names}}' | grep -v '^riftwarden-gateway$' || true)
[[ -z "$owner" ]] || die "port 18084 is used by container(s): $owner. Stop them first."
cp "$SRC/compose.yml" "$SRC/deploy.sh" "$STACK/"
chmod +x "$STACK/deploy.sh"
if [[ ! -f "$STACK/.env" ]] || ! grep -q '^RIFT_POSTGRES_PASSWORD=.\{16,\}' "$STACK/.env" || grep -q '=change-me' "$STACK/.env"; then
    (umask 077; printf 'RIFT_POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" >"$STACK/.env")
    ok ".env created (random database password)"
else
    ok ".env kept"
fi

step "Container registry"
export DOCKER_CONFIG="$STACK/.docker"
mkdir -p "$DOCKER_CONFIG"
if docker pull --quiet "$REGISTRY/riftwarden-gateway:production" >/dev/null 2>&1; then
    ok "images can be pulled"
else
    warn "GHCR needs a login. Create a classic token with only 'read:packages' at https://github.com/settings/tokens"
    read -r -p "   GitHub user name: " ghuser
    read -r -s -p "   Token (hidden): " ghtoken; echo
    printf '%s' "$ghtoken" | docker login ghcr.io --username "$ghuser" --password-stdin >/dev/null
    unset ghtoken
    docker pull --quiet "$REGISTRY/riftwarden-gateway:production" >/dev/null || die "pull still fails after login"
    ok "logged in, images can be pulled"
fi
docker pull --quiet "$REGISTRY/riftwarden-worker:production" >/dev/null
unset DOCKER_CONFIG

step "Cloudflare Tunnel '$TUNNEL' -> $API_HOST"
if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
    warn "cloudflared is not logged in: a browser link follows, pick the ykdbonte.dev zone."
    "$CLOUDFLARED" tunnel login
fi
tunnel_id() { "$CLOUDFLARED" tunnel list --name "$TUNNEL" --output json 2>/dev/null | grep -o '"id": *"[0-9a-f-]\{36\}"' | grep -o '[0-9a-f-]\{36\}' | head -n1 || true; }
tunnel_id=$(tunnel_id)
if [[ -z "$tunnel_id" ]]; then
    "$CLOUDFLARED" tunnel create "$TUNNEL"
    tunnel_id=$(tunnel_id)
fi
[[ -n "$tunnel_id" ]] || die "could not find or create the tunnel '$TUNNEL'"
creds="$HOME/.cloudflared/$tunnel_id.json"
[[ -f "$creds" ]] || die "tunnel credentials $creds are missing (the tunnel was created on another machine: 'cloudflared tunnel token' or recreate it)"
ok "tunnel $tunnel_id"
# Only this tunnel's own config file is touched; other tunnels (their config files, credentials, services) are not.
config="$HOME/.cloudflared/riftwarden.yml"
if [[ ! -f "$config" ]]; then
    cat >"$config" <<EOF
# Written by deploy/setup-server.sh. The client is on Cloudflare Pages; the tunnel only publishes the API.
tunnel: $tunnel_id
credentials-file: $creds
ingress:
  - hostname: $API_HOST
    service: http://127.0.0.1:18084
  - service: http_status:404
EOF
    ok "wrote $config"
elif grep -q "hostname: *$API_HOST" "$config"; then
    ok "$config already routes $API_HOST (left as is)"
else
    # Existing file: keep every rule and add the API rule just before the catch-all (the last rule without hostname).
    grep -Eq "^tunnel: *($tunnel_id|$TUNNEL) *$" "$config" ||
        die "$config belongs to another tunnel; set RIFT_TUNNEL to that tunnel's name or move the file"
    catchall=$(grep -n '^[[:space:]]*- service:' "$config" | tail -n1 | cut -d: -f1)
    [[ -n "$catchall" ]] || die "no catch-all rule in $config: add '- hostname: $API_HOST' / 'service: http://127.0.0.1:18084' by hand"
    indent=$(sed -n "${catchall}p" "$config" | sed 's/- service:.*//')
    cp "$config" "$config.bak-$(date +%Y%m%d%H%M%S)"
    sed -i "${catchall}i\\${indent}- hostname: $API_HOST\n${indent}  service: http://127.0.0.1:18084" "$config"
    ok "added $API_HOST to $config (other rules kept, backup next to it)"
fi
"$CLOUDFLARED" tunnel ingress validate --config "$config" >/dev/null || die "$config does not validate"
"$CLOUDFLARED" tunnel route dns --overwrite-dns "$TUNNEL" "$API_HOST" && ok "DNS $API_HOST -> tunnel '$TUNNEL'"

step "systemd user units"
# Another connector for THIS tunnel (e.g. an old service with another config) would answer some requests with its
# own routes. Connectors of other tunnels are fine and are never stopped.
systemctl --user stop riftwarden-tunnel.service 2>/dev/null || true
sleep 3
conns=$("$CLOUDFLARED" tunnel info --output json "$TUNNEL" 2>/dev/null | grep -o '"colo_name"' | wc -l || true)
if [[ "${conns:-0}" -gt 0 ]]; then
    warn "tunnel '$TUNNEL' still has $conns connection(s) from another cloudflared process (not this script's service)."
    warn "If that process uses a config without $API_HOST, the API answers only part of the time."
    ask "Continue anyway (and stop that other '$TUNNEL' connector afterwards)?" || die "stop the other '$TUNNEL' connector first"
fi
mkdir -p "$UNITS"
cp "$SRC/systemd/riftwarden-deploy.service" "$SRC/systemd/riftwarden-deploy.timer" "$UNITS/"
sed "s|/usr/local/bin/cloudflared|$CLOUDFLARED|" "$SRC/systemd/riftwarden-tunnel.service" >"$UNITS/riftwarden-tunnel.service"
loginctl enable-linger "$USER" 2>/dev/null || warn "could not enable linger: run 'sudo loginctl enable-linger $USER' so the units run without a login"
systemctl --user daemon-reload
systemctl --user enable riftwarden-tunnel.service riftwarden-deploy.timer >/dev/null
systemctl --user restart riftwarden-tunnel.service
ok "tunnel service running, deploy timer enabled"

step "First deploy"
systemctl --user stop riftwarden-deploy.timer
bash "$STACK/deploy.sh"
systemctl --user start riftwarden-deploy.timer
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:18084/health | grep -q '"sims":2' && break; sleep 2; done
local_health=$(curl -fs http://127.0.0.1:18084/health || true)
[[ -n "$local_health" ]] || die "the gateway does not answer on 127.0.0.1:18084 (docker compose logs gateway)"
ok "local: $local_health"
for _ in $(seq 1 20); do
    public=$(curl -fs --max-time 5 "https://$API_HOST/health" || true)
    [[ -n "$public" ]] && break
    sleep 6
done
if [[ -n "$public" ]]; then ok "public: https://$API_HOST/health -> $public"
else warn "https://$API_HOST/health does not answer yet (DNS can take a few minutes): journalctl --user -u riftwarden-tunnel"; fi

cat <<EOF

Server done. Remaining (Cloudflare + GitHub, see the chat or deploy/README.md):
  - Cloudflare Pages project 'riftwarden' + custom domain riftwarden.ykdbonte.dev (move it off the tunnel)
  - repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
  - re-run the 'Deploy to production' job
EOF
