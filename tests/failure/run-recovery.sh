#!/usr/bin/env bash
set -euo pipefail
[[ "${FATE_RUN_FAILURE_TESTS:-}" == "1" ]] || { echo "Set FATE_RUN_FAILURE_TESTS=1 to run controlled Docker failure drills." >&2; exit 2; }
ENV_FILE="${FATE_LOCAL_ENV_FILE:-local.env}"; COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.local.yaml)
cleanup(){ "${COMPOSE[@]}" start app >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${COMPOSE[@]}" stop app
"${COMPOSE[@]}" start app
curl --fail --silent --retry 30 --retry-delay 1 --retry-all-errors http://127.0.0.1:3100/api/health >/dev/null
"${COMPOSE[@]}" restart app
curl --fail --silent --retry 30 --retry-delay 1 --retry-all-errors http://127.0.0.1:3100/api/health >/dev/null
"${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(v=>{if(v.database?.backend!=='d1'||v.database?.status!=='ok')process.exit(1)})"
echo "D1 persistence recovery drill passed."
