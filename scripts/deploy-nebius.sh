#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${NEBIUS_PROJECT_ID:-project-e00sv4bvpr00wr5e5kr9xr}"
REGISTRY_ID="${NEBIUS_REGISTRY_ID:?Set NEBIUS_REGISTRY_ID}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
IMAGE="cr.eu-north1.nebius.cloud/${REGISTRY_ID}/fate-platform:${IMAGE_TAG}"
SECRET_FILE="deploy/nebius/secret.yaml"

test -f "$SECRET_FILE" || { echo "Missing $SECRET_FILE; copy secret.example.yaml and replace placeholders." >&2; exit 1; }
grep -q "replace-" "$SECRET_FILE" && { echo "Secret placeholders remain in $SECRET_FILE." >&2; exit 1; }
command -v docker >/dev/null
command -v kubectl >/dev/null
command -v nebius >/dev/null || test -x /Users/sapirpirski/.nebius/bin/nebius

docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"
kubectl apply -f deploy/nebius/namespace.yaml
kubectl apply -f deploy/nebius/configmap.yaml
kubectl apply -f "$SECRET_FILE"
sed -e "s|FATE_IMAGE|${IMAGE}|g" -e "s|FATE_REVISION|${IMAGE_TAG}|g" deploy/nebius/workload.yaml | kubectl apply -f -
kubectl apply -f deploy/nebius/ops-cronjob.yaml
kubectl -n fate rollout status deployment/fate-web --timeout=5m
kubectl -n fate get service fate-web
echo "Deployed FATE to Nebius project ${PROJECT_ID}."
