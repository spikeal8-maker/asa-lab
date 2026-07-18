# infra/

Local development infrastructure.

`docker-compose.yml` defines PostgreSQL 16, Redis 7 and MinIO (S3-compatible).

Validate the configuration without starting containers:

```bash
docker compose -f infra/docker-compose.yml config
```

A Docker runtime is not installed on the current developer machine, so tests
that require a live Docker/PostgreSQL runtime are reported as `BLOCKED` until the
integration environment is provisioned by a dedicated task.
