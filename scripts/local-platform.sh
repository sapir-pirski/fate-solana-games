#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${FATE_LOCAL_ENV_FILE:-local.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.local.yaml)

require_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE. Copy local.env.example to $ENV_FILE and replace all replace-* values." >&2
    exit 1
  fi
  if grep -q 'replace-with-' "$ENV_FILE"; then
    echo "$ENV_FILE still contains placeholder secrets." >&2
    exit 1
  fi
}

case "${1:-help}" in
  up)
    require_env
    "${COMPOSE[@]}" up -d --build
    "$0" health
    ;;
  down)
    require_env
    "${COMPOSE[@]}" down
    ;;
  status)
    require_env
    "${COMPOSE[@]}" ps
    ;;
  logs)
    require_env
    "${COMPOSE[@]}" logs -f --tail=200 "${2:-app}"
    ;;
  health)
    require_env
    port="$(awk -F= '$1 == "FATE_LOCAL_PORT" { print $2 }' "$ENV_FILE" | tail -1)"
    port="${port:-3100}"
    curl --fail --show-error --silent --retry 30 --retry-delay 2 --retry-all-errors \
      "http://127.0.0.1:${port}/api/health"
    printf '\n'
    ;;
  *)
    echo "Usage: $0 {up|down|status|logs [service]|health}"
    ;;
esac
