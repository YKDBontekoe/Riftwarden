#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"
exec 9>.deploy.lock
flock -n 9 || exit 0
export DOCKER_CONFIG="$PWD/.docker"

image=ghcr.io/ykdbontekoe/riftwarden:production
docker pull --quiet "$image" >/dev/null
candidate=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")
previous=$(docker container inspect --format '{{.Config.Image}}' riftwarden-web 2>/dev/null || true)
health=$(docker container inspect --format '{{.State.Health.Status}}' riftwarden-web 2>/dev/null || true)

if [[ "$candidate" == "$previous" && "$health" == healthy ]]; then
    exit 0
fi

deploy() {
    RIFTWARDEN_IMAGE="$1" docker compose -f compose.yml up --detach --wait --wait-timeout 45
}

if deploy "$candidate"; then
    printf 'Riftwarden is serving %s\n' "$candidate"
    exit 0
fi

printf 'Riftwarden could not deploy %s\n' "$candidate" >&2
if [[ -n "$previous" && "$previous" != "$candidate" ]]; then
    printf 'Restoring %s\n' "$previous" >&2
    deploy "$previous"
fi
exit 1
