#!/usr/bin/env bash
set -euo pipefail

: "${FATE_TLS_EMAIL:?Set FATE_TLS_EMAIL to the certificate contact address}"

command -v helm >/dev/null
command -v kubectl >/dev/null

helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm upgrade --install fate-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --values deploy/nebius/ingress-nginx-values.yaml \
  --wait --timeout 10m

helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --values deploy/nebius/cert-manager-values.yaml \
  --wait --timeout 10m

kubectl -n ingress-nginx wait \
  --for=jsonpath='{.status.loadBalancer.ingress[0].ip}' \
  service/fate-ingress-ingress-nginx-controller \
  --timeout=10m

INGRESS_IP="$(kubectl -n ingress-nginx get service fate-ingress-ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"
test -n "$INGRESS_IP"
FATE_HOST="fate.${INGRESS_IP//./-}.sslip.io"

sed \
  -e "s|FATE_TLS_EMAIL|${FATE_TLS_EMAIL}|g" \
  -e "s|FATE_HOST|${FATE_HOST}|g" \
  deploy/nebius/tls-ingress.yaml | kubectl apply -f -

kubectl -n fate wait --for=condition=Ready certificate/fate-web-tls --timeout=10m
curl --fail --show-error --silent --retry 12 --retry-delay 5 "https://${FATE_HOST}/api/health"
printf '\nKubernetes-native HTTPS is ready at https://%s\n' "$FATE_HOST"
