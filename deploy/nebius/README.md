# Nebius deployment

Target project: `project-e00sv4bvpr00wr5e5kr9xr` (`tlv-pe-hw2`, `eu-north1`).

## Provisioned FATE resources

- Container Registry: `registry-e00zey749styjjkd0g` (`fate-platform`)
- KMS key: `kmssymkey-e00bvmk550v2pwnfgw` (`fate-platform-data-key`, AES-256, 90-day rotation)
- Object Storage: `fate-platform-backups-e00sv4bv` (versioning enabled)
- Current CPU runtime: `oref-app` VM, isolated `fate-platform` container
- HTTPS endpoint: `https://fate.89-169-122-60.sslip.io`

The project Kubernetes cluster `mk8scluster-e00bj563eq2858w1qr` currently has
only H100 GPU workers. FATE must not be scheduled there until a dedicated CPU
node group is available. The existing `oref-postgres` cluster belongs to the
Oref workload and must not be reused; FATE needs its own cluster after the
D1/SQLite persistence adapter is migrated to PostgreSQL.

This package deploys the current devnet engineering build to Managed Kubernetes with a private secret, persistent application state, health checks, resource limits, a public load balancer, and a non-signing operations audit job. The application remains single-replica while its D1-compatible local state is in use. Move persistence to Managed PostgreSQL before increasing replicas.

Required operator inputs are deliberately not committed: `OPENAI_API_KEY`, a random `INDEXER_AUTH_TOKEN`, and the audited devnet program ID. Copy `secret.example.yaml` to an ignored `secret.yaml`, replace every placeholder, and run `./scripts/deploy-nebius.sh` after the Nebius resources and kubeconfig exist.

Recommended Nebius services for the production phase are Managed PostgreSQL, Object Storage for backups, SecretStash/KMS for secret delivery, Nebius Observability Agent with Grafana/Loki, and LiteLLM or Serverless AI Endpoints. Solana program execution, wallet signing, escrow, and VRF remain on-chain.
