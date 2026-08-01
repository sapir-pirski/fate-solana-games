# FATE production operations

## Deployment order

1. Generate an external kubeconfig for cluster `mk8scluster-e00bj563eq2858w1qr`.
2. Deploy the application with `scripts/deploy-nebius.sh`.
3. Set `FATE_TLS_EMAIL` and run `scripts/deploy-nebius-ingress.sh`.
4. Verify the new Kubernetes-native HTTPS endpoint before changing or removing
   the VM Caddy route. Keep the old endpoint as rollback until verification is
   complete.

The ingress script creates a separate public load balancer. After it is healthy,
convert its dynamic address into a reusable Nebius allocation and add the
`nebius.com/load-balancer-allocation-id` annotation to the ingress controller
Service. This prevents accidental IP loss when the Service is recreated.

## Health and alert policy

Scrape `GET /api/metrics`; the pod annotations explicitly advertise this path.
Create alerts for:

- `fate_up != 1` for 2 minutes: page the operator.
- No healthy `fate-web` replicas for 2 minutes: page the operator.
- PostgreSQL health failures or HTTP 5xx rate above 2% for 5 minutes: page.
- P95 request latency above 1 second for 10 minutes: warn.
- CPU above 80% or memory above 85% for 15 minutes: warn and inspect HPA.
- CronJob failure or no successful operations audit for 15 minutes: warn.

Keep application logs free of wallet signatures, tokens, database URLs, and
MysteryBox payloads. Correlate requests with generated request IDs instead.

## PostgreSQL backups and restore drills

Managed PostgreSQL backups are the authoritative database recovery mechanism.
List backups with:

```sh
nebius --profile fate-prod msp postgresql v1alpha1 backup list \
  --parent-id postgresql-e00rdx7hqp2jy2kdrz --format json
```

Perform a quarterly restore drill into a temporary, isolated cluster. Validate
schema count, row counts, `/api/health`, and a read-only history request. Never
point production traffic at the drill cluster. Record recovery point and recovery
time, then delete the temporary cluster only after validation and approval.

The versioned Object Storage bucket `fate-platform-backups-e00sv4bv` is for
exported operational artifacts and configuration backups; it is not a replacement
for database-native backups.

## MysteryBox secret delivery

Secret `mbsec-e00vv1b2pb79qj7t72` is the source of truth. Nebius documentation
currently describes payload retrieval by an authorized user or service account,
but does not document a native Managed Kubernetes SecretStore/CSI integration.
Until a supported controller is verified, retain the existing `fate-secrets`
Kubernetes Secret.

For automation, use a dedicated least-privilege service account with only the
MysteryBox payload-viewer permission needed for this secret. A deployment job may
retrieve the payload directly into memory and apply the Kubernetes Secret without
printing or persisting values. Rotate the MysteryBox version first, synchronize
the Kubernetes Secret, restart the deployment, verify health, and only then retire
the previous version.

## Rollback

Use `kubectl rollout undo deployment/fate-web -n fate` for an application rollback.
Do not delete the orphaned `fate-state` PVC until its historical D1 data has been
exported and the PostgreSQL migration has been accepted. Do not stop the VM-hosted
fallback until Kubernetes-native HTTPS has passed external health checks.
