# Docker troubleshooting

Quick-start installations should begin with `tools/asa-lab.ps1 status` / `logs`
on Windows or `./tools/asa-lab.sh status` / `logs` on Linux and WSL2. The
lower-level commands below are for detailed operator diagnostics.

## Start with current state

```bash
docker version
docker compose version
docker compose config --quiet
docker compose ps -a
docker compose logs --tail=200 postgres migration api web
```

For an overlay, include the same files used to start it:

```bash
docker compose -f compose.yaml -f compose.dev.yaml ps -a
docker compose -f compose.yaml -f compose.test.yaml ps -a
docker compose -f compose.yaml -f compose.staging.yaml ps -a
```

## Migration does not complete

Confirm PostgreSQL is healthy, then inspect only the migration job:

```bash
docker compose ps -a
docker compose logs --tail=200 postgres migration
docker compose run --rm migration
```

The second migration run must apply zero migrations. Do not bypass the
migration dependency or edit the database manually to make API start.

## Web or API is unhealthy

```bash
bash tools/docker-healthcheck.sh
curl --fail http://127.0.0.1:4610/health/live
curl --fail http://127.0.0.1:4610/health/ready
curl --fail http://127.0.0.1:4610/
docker compose logs --tail=200 api web
```

Expected health states are `live` and `ready`; readiness also reports the
database as `up`.

## Port conflict

This stack may publish only 4610, 4611 in dev, and 4612 in test. Identify an
owner before stopping any process:

```bash
ss -ltnp | grep -E ':(4610|4611|4612)\b'
```

Do not use or stop services on ports 3000, 3100 or 5173 for this task. Do not
stop containers belonging to another Compose project.

## Test profile cannot connect

The test database must end in `_test`. Inspect the normalized configuration:

```bash
docker compose -f compose.yaml -f compose.test.yaml config
docker compose -f compose.yaml -f compose.test.yaml ps -a
docker compose -f compose.yaml -f compose.test.yaml logs --tail=200 postgres migration api web
```

Run browser and PostgreSQL tests from `test-runner`; the database intentionally
has no host port.

## WSL2 and Docker Desktop

- Ensure Docker Desktop is running with the Linux engine.
- Ensure integration is enabled for Ubuntu 24.04.
- Run `docker version` inside Ubuntu after restarting Docker Desktop.
- Keep the checkout under `/home`, not `/mnt/c`.
- If `localhost` forwarding is stale, verify the container is healthy before
  restarting WSL or Docker Desktop.

## Safe cleanup

Stop only the selected ASA Lab profile:

```bash
bash tools/docker-down.sh base
bash tools/docker-down.sh dev
bash tools/docker-down.sh test
bash tools/docker-down.sh staging
```

These commands preserve volumes. Never run `docker system prune` or
`docker volume prune` as part of this project workflow.
