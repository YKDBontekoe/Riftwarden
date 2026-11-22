#!/usr/bin/env bash
# Pull-based deploy (systemd timer, every minute): when GHCR's :production images changed, roll the stack.
#   1. infrastructure (PostgreSQL, Redis): `up` is a no-op unless compose changed
#   2. rules worker, then the gateway (players' sockets drop and reconnect; operations keep running in the sims)
#   3. each sim slot in turn: drain (no new rooms), wait for its operations to finish (DRAIN_TIMEOUT), replace it,
#      undrain. The other slot takes new rooms meanwhile, so co-op never stops.
# A gateway that does not come up healthy on the new build is rolled back. Images are pinned by digest in
# images.env (the state of this script); secrets live in .env.
set -euo pipefail

cd -- "$(dirname -- "$0")"
exec 9>.deploy.lock
flock -n 9 || exit 0
export DOCKER_CONFIG="$PWD/.docker"

REGISTRY=${RIFT_REGISTRY:-ghcr.io/ykdbontekoe}
DRAIN_TIMEOUT=${DRAIN_TIMEOUT:-1800}
compose=(docker compose --env-file .env --env-file images.env -f compose.yml)
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Registry digest (pulled images); the image id for images built on this machine (testing).
digest() { docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$1"; }
revision() { docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1"; }
get() { sed -n "s/^$1=//p" images.env 2>/dev/null || true; }
set_image() {
    touch images.env
    if grep -q "^$1=" images.env; then sed -i "s|^$1=.*|$1=$2|" images.env; else printf '%s=%s\n' "$1" "$2" >>images.env; fi
}
admin() { docker exec riftwarden-gateway /usr/local/bin/riftwarden-gateway admin "$@"; }
build_live() { curl --fail --silent --max-time 4 http://127.0.0.1:18084/health | sed -n 's/.*"build":"\([^"]*\)".*/\1/p'; }
sim_field() { # sim_field ADDR FIELD -> value from admin status
    admin status | tr '{' '\n' | grep "\"addr\":\"$1\"" | sed -n "s/.*\"$2\":\([a-z0-9]*\).*/\1/p"
}

if [[ -z "${RIFT_SKIP_PULL:-}" ]]; then
    docker pull --quiet "$REGISTRY/riftwarden-gateway:production" >/dev/null
    docker pull --quiet "$REGISTRY/riftwarden-worker:production" >/dev/null
fi
gateway=$(digest "$REGISTRY/riftwarden-gateway:production")
worker=$(digest "$REGISTRY/riftwarden-worker:production")
build=$(revision "$gateway")
[[ -n "$build" && "$build" == "$(revision "$worker")" ]] || { log "gateway and worker images are from different builds; waiting"; exit 0; }
# A build that already failed here is not retried every minute (each try restarts the gateway).
[[ "$(cat .failed-build 2>/dev/null)" == "$build" ]] && exit 0

# First deploy: everything at once.
if [[ ! -s images.env ]]; then
    for k in RIFT_GATEWAY_IMAGE; do set_image "$k" "$gateway"; done
    for k in RIFT_RULES_IMAGE RIFT_SIM_BLUE_IMAGE RIFT_SIM_GREEN_IMAGE; do set_image "$k" "$worker"; done
    set_image RIFT_BUILD "$build"
    "${compose[@]}" up --detach --wait --wait-timeout 120
    log "Riftwarden is serving $build"
    exit 0
fi

if [[ "$(get RIFT_GATEWAY_IMAGE)" == "$gateway" && "$(get RIFT_RULES_IMAGE)" == "$worker" &&
    "$(get RIFT_SIM_BLUE_IMAGE)" == "$worker" && "$(get RIFT_SIM_GREEN_IMAGE)" == "$worker" &&
    "$(docker container inspect --format '{{.State.Health.Status}}' riftwarden-gateway 2>/dev/null)" == healthy ]]; then
    exit 0
fi
log "deploying $build"

"${compose[@]}" up --detach --wait --wait-timeout 120 db redis

previous_gateway=$(get RIFT_GATEWAY_IMAGE)
previous_rules=$(get RIFT_RULES_IMAGE)
previous_build=$(get RIFT_BUILD)
set_image RIFT_RULES_IMAGE "$worker"
set_image RIFT_BUILD "$build"
"${compose[@]}" up --detach --wait --wait-timeout 60 --no-deps rules
set_image RIFT_GATEWAY_IMAGE "$gateway"
if ! "${compose[@]}" up --detach --wait --wait-timeout 60 --no-deps gateway || [[ "$(build_live)" != "$build" ]]; then
    log "gateway $build is not healthy: restoring $previous_build" >&2
    set_image RIFT_GATEWAY_IMAGE "$previous_gateway"
    set_image RIFT_RULES_IMAGE "$previous_rules"
    set_image RIFT_BUILD "$previous_build"
    "${compose[@]}" up --detach --wait --wait-timeout 60 --no-deps rules gateway || true
    printf '%s\n' "$build" >.failed-build
    exit 1
fi

for slot in blue green; do
    key="RIFT_SIM_${slot^^}_IMAGE"
    addr="sim-$slot:7201"
    [[ "$(get "$key")" == "$worker" ]] && continue
    log "draining $addr"
    admin drain "$addr" on >/dev/null
    waited=0
    while [[ "$(sim_field "$addr" running)" != 0 && $waited -lt $DRAIN_TIMEOUT ]]; do
        sleep 10
        waited=$((waited + 10))
    done
    # Operations still running after the timeout end now (SIGTERM: secured rewards stay, the rest is lost).
    log "replacing $addr after ${waited}s"
    set_image "$key" "$worker"
    "${compose[@]}" up --detach --wait --wait-timeout 90 --no-deps "sim-$slot"
    for _ in $(seq 1 30); do [[ "$(sim_field "$addr" up)" == true ]] && break; sleep 2; done
    admin drain "$addr" off >/dev/null
done

log "Riftwarden is serving $build"
