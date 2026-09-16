# ASA Lab deployment

The supported runtime is a Linux-container Compose stack. It runs through
Docker Desktop on Windows 11 and through Docker Engine on a regular Linux host.

Start with [`QUICK_START.md`](QUICK_START.md). It provides one-command Windows
and Linux/WSL2 startup, generates private local credentials and waits for the
real application readiness endpoint.

Operator references:

- [`../delivery/AGENT_CHANGE_WORKFLOW.md`](../delivery/AGENT_CHANGE_WORKFLOW.md) —
  agent path from a focused change through GitHub, CI and an explicitly requested deploy;
- [`LINUX_DOCKER_DEPLOYMENT.md`](LINUX_DOCKER_DEPLOYMENT.md) — Linux production,
  staging and TLS boundary;
- [`WINDOWS11_WSL2_DOCKER.md`](WINDOWS11_WSL2_DOCKER.md) — WSL2 development option;
- [`DOCKER_BACKUP_RESTORE.md`](DOCKER_BACKUP_RESTORE.md) — guarded backup and restore;
- [`GUARDED_UPDATE.md`](GUARDED_UPDATE.md) — verified fast-forward update with backup,
  exact-SHA CI and readiness receipts;
- [`DOCKER_TROUBLESHOOTING.md`](DOCKER_TROUBLESHOOTING.md) — diagnostics and safe cleanup;
- [`WINDOWS_UPDATE_RECOVERY.md`](WINDOWS_UPDATE_RECOVERY.md) — Windows update failures,
  recovery, exact deployed-version checks and missing Scratch after an update.

Historical infrastructure task state remains in the delivery/governance
documents. Deployment instructions always target the current `main` branch.

Scratch is included in the base Compose stack, not hidden behind a preview flag.
The standard startup checks Web/API and the matching Scratch runtime. Read
[`SCRATCH_INSTALLATION.md`](SCRATCH_INSTALLATION.md) for local origins, reproducible
source builds, existing-overlay migration and error recovery. Server persistence
is still a separate milestone; the ready editor has no permanent lower notice.

Production uses the tracked `compose.production.yaml` overlay. Host-specific
credentials, database dumps and optional transport overlays such as
`compose.frp.yaml` stay local and must never be committed.
