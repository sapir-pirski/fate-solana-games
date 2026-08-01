#!/usr/bin/env bash
set -euo pipefail
[[ "${FATE_RUN_FAILURE_TESTS:-}" == "1" ]] || { echo "Set FATE_RUN_FAILURE_TESTS=1 to run controlled Docker failure drills." >&2; exit 2; }
ENV_FILE="${FATE_LOCAL_ENV_FILE:-local.env}"; COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.local.yaml)
cleanup(){ "${COMPOSE[@]}" start coordination-worker postgres >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${COMPOSE[@]}" stop coordination-worker
curl --fail --silent --retry 10 --retry-delay 1 http://127.0.0.1:3100/api/health >/dev/null
"${COMPOSE[@]}" start coordination-worker
sleep 3
"${COMPOSE[@]}" exec -T coordination-worker node -e "fetch('http://127.0.0.1:9465/health').then(r=>{if(!r.ok)process.exit(1)})"
"${COMPOSE[@]}" restart postgres
curl --fail --silent --retry 30 --retry-delay 1 --retry-all-errors http://127.0.0.1:3100/api/health >/dev/null
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-fate_app}" -d "${POSTGRES_DB:-fate}" -c 'SELECT 1' >/dev/null
echo "Failure-recovery drill passed."
