# ASA Lab deployment

The supported runtime is a Linux-container Compose stack. It runs through
Docker Desktop on Windows 11 and through Docker Engine on a regular Linux host.

Start with [`QUICK_START.md`](QUICK_START.md). It provides one-command Windows
and Linux/WSL2 startup, generates private local credentials and waits for the
real application readiness endpoint.

Operator references:

- [`LINUX_DOCKER_DEPLOYMENT.md`](LINUX_DOCKER_DEPLOYMENT.md) — Linux production,
  staging and TLS boundary;
- [`WINDOWS11_WSL2_DOCKER.md`](WINDOWS11_WSL2_DOCKER.md) — WSL2 development option;
- [`DOCKER_BACKUP_RESTORE.md`](DOCKER_BACKUP_RESTORE.md) — guarded backup and restore;
- [`GUARDED_UPDATE.md`](GUARDED_UPDATE.md) — verified fast-forward update with backup,
  exact-SHA CI and readiness receipts;
- [`DOCKER_TROUBLESHOOTING.md`](DOCKER_TROUBLESHOOTING.md) — diagnostics and safe cleanup.

Historical infrastructure task state remains in the delivery/governance
documents. Deployment instructions always target the current `main` branch.

Production uses the tracked `compose.production.yaml` overlay. Host-specific
credentials, database dumps and optional transport overlays such as
`compose.frp.yaml` stay local and must never be committed.
