# Nebius deployment

Target project: `project-e00sv4bvpr00wr5e5kr9xr` (`tlv-pe-hw2`, `eu-north1`).

## Provisioned FATE resources

- Container Registry: `registry-e00zey749styjjkd0g` (`fate-platform`)
- KMS key: `kmssymkey-e00bvmk550v2pwnfgw` (`fate-platform-data-key`, AES-256, 90-day rotation)
- Object Storage: `fate-platform-backups-e00sv4bv` (versioning enabled)
- Kubernetes CPU node group: `mk8snodegroup-e00n1stcmsef1ccq6w` (`fate-cpu-ng`, 2 x 2 vCPU/8 GiB)
- Managed PostgreSQL: `postgresql-e00rdx7hqp2jy2kdrz` (`fate-postgres`, PostgreSQL 16)
- SecretStash: `mbsec-e00vv1b2pb79qj7t72` (`fate-platform-secrets`)
- Observability: `nebius-observability-agent` Helm release in namespace `observability`
- Availability: two web replicas spread across the two dedicated CPU nodes, with a PodDisruptionBudget
- Current CPU runtime: `oref-app` VM, isolated `fate-platform` container
- HTTPS endpoint: `https://fate.89-169-122-60.sslip.io`

The project Kubernetes cluster `mk8scluster-e00bj563eq2858w1qr` also contains
shared H100 GPU workers. FATE workloads select and tolerate only the dedicated
`workload=fate:NoSchedule` CPU node. The existing `oref-postgres` cluster belongs to the
Oref workload and is not reused. FATE uses its isolated three-host `fate-postgres` cluster;
Cloudflare deployments remain compatible with the D1 binding.

Nebius image URLs use the registry resource ID without its `registry-` prefix,
for example `cr.eu-north1.nebius.cloud/e00zey749styjjkd0g/fate-platform:<tag>`.

This package deploys the current devnet engineering build to Managed Kubernetes with a private secret, persistent application state, health checks, resource limits, a public load balancer, and a non-signing operations audit job. The application remains single-replica while its D1-compatible local state is in use. Move persistence to Managed PostgreSQL before increasing replicas.

Required operator inputs are deliberately not committed: `OPENAI_API_KEY`, a random `INDEXER_AUTH_TOKEN`, and the audited devnet program ID. Copy `secret.example.yaml` to an ignored `secret.yaml`, replace every placeholder, and run `./scripts/deploy-nebius.sh` after the Nebius resources and kubeconfig exist.

Recommended Nebius services for the production phase are Managed PostgreSQL, Object Storage for backups, SecretStash/KMS for secret delivery, Nebius Observability Agent with Grafana/Loki, and LiteLLM or Serverless AI Endpoints. Solana program execution, wallet signing, escrow, and VRF remain on-chain.
