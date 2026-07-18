# infra/

Local development infrastructure.

`docker-compose.yml` defines PostgreSQL 16, Redis 7 and MinIO (S3-compatible),
plus a one-shot `minio-setup` that waits for a healthy MinIO before creating the
local bucket. All images are pinned (no `:latest`); ports are published on
`127.0.0.1` only; credentials are local development placeholders.

## Structural validation (no Docker required)

```bash
pnpm compose:check
```

This verifies pinned images, loopback-only ports and persistent volumes locally,
without a Docker runtime.

## Full `docker compose config`

```bash
docker compose -f infra/docker-compose.yml config
```

Requires a Docker Compose CLI. It is **not installed** on the current developer
machine, and a daemon-free `config` still needs a Compose binary that is not
provisioned here (no Docker Desktop, no downloaded native binary). The
`TST-COMPOSE-001` gate is therefore reported `BLOCKED` with that precise reason
until the integration environment is provisioned by a dedicated task. Starting
the stack (`docker compose up`) additionally requires a running Docker daemon.
