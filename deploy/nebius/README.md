# Nebius deployment

Target project: `project-e00sv4bvpr00wr5e5kr9xr` (`tlv-pe-hw2`, `eu-north1`).

This package deploys the current devnet engineering build to Managed Kubernetes with a private secret, persistent application state, health checks, resource limits, a public load balancer, and a non-signing operations audit job. The application remains single-replica while its D1-compatible local state is in use. Move persistence to Managed PostgreSQL before increasing replicas.

Required operator inputs are deliberately not committed: `OPENAI_API_KEY`, a random `INDEXER_AUTH_TOKEN`, and the audited devnet program ID. Copy `secret.example.yaml` to an ignored `secret.yaml`, replace every placeholder, and run `./scripts/deploy-nebius.sh` after the Nebius resources and kubeconfig exist.

Recommended Nebius services for the production phase are Managed PostgreSQL, Object Storage for backups, SecretStash/KMS for secret delivery, Nebius Observability Agent with Grafana/Loki, and LiteLLM or Serverless AI Endpoints. Solana program execution, wallet signing, escrow, and VRF remain on-chain.
