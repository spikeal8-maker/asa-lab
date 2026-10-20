# Linux Docker deployment

The same Compose model used through WSL2 is portable to a regular x86-64 Linux
Docker host. The production profile serves the Web build through Caddy; it does
not run the Vite development server or publish PostgreSQL and API host ports.

## Host and checkout

Install a current Docker Engine with the Compose plugin and Git. Keep the
checkout on a local Linux filesystem. Node.js, Corepack and PostgreSQL are not
required on the host for a Docker deployment.

```bash
git clone https://github.com/spikeal8-maker/asa-lab.git
cd asa-lab
docker version
docker compose version
```

## Staging environment

Create a private `.env` from `.env.docker.example`, set
`COMPOSE_PROJECT_NAME=asa-lab-staging`, and replace all secrets. Staging
validation fails closed unless these variables are set:

```text
POSTGRES_PASSWORD
MIGRATION_DATABASE_URL
MIGRATION_EXPECT_DATABASE
MIGRATION_CONFIRM
ASA_APP_DB_PASSWORD
APP_DATABASE_URL
```

Use URL-safe passwords. `MIGRATION_DATABASE_URL` must target the exact database
named by `MIGRATION_EXPECT_DATABASE`, and `MIGRATION_CONFIRM` must equal
`APPLY:<that-name>`. The migration runner verifies the connected database before
creating its tracking table or applying SQL. The migration container does not
receive generic `DATABASE_URL`; provisioning and optional dev seed use the same
attested `MIGRATION_DATABASE_URL`. Keep runtime `APP_DATABASE_URL` consistent
with the provisioned runtime-role password. Protect the file:

```bash
cp .env.docker.example .env
chmod 600 .env
```

For a local single-computer installation, use [`QUICK_START.md`](QUICK_START.md)
instead; its helper generates consistent private credentials automatically.

## Production environment

Use the tracked `compose.production.yaml` overlay. In the private `.env`, set a
stable `COMPOSE_PROJECT_NAME` once, set `ASA_SEED_DEV=false`, and configure
`ASA_PUBLIC_WEB_ORIGINS` with the HTTPS origins accepted by the API. Never
rename an existing Compose project during an upgrade: a new name selects a new
PostgreSQL volume and can look like data loss.

The repository contains no production passwords, bot tokens, tunnel credentials
or database dumps. Keep those values in the host-owned `.env` or the deployment
platform's secret store. A local transport overlay such as `compose.frp.yaml`
is ignored by Git and is not part of the portable application stack.

## Deploy

```bash
ASA_COMPOSE_PROFILE=production ./tools/asa-lab.sh doctor
ASA_COMPOSE_PROFILE=production ./tools/asa-lab.sh up
ASA_COMPOSE_PROFILE=production ./tools/asa-lab.sh health
```

The helper records the exact Git revision in the image and derives the expected
schema from the checked-out migration files. `/health/ready` then fails closed
when the running database schema does not match that checkout.

Only Web is published by default on `127.0.0.1:4610`. PostgreSQL, API and MinIO
stay on private Compose networks. On a **fresh production server** the canonical
manager can enable HTTPS directly in the **existing Web/Caddy** with
`python tools/asa_manager.py install --profile production --public-domain asa-lab.ru`.
This selects `compose.public.yaml`, serving public Web ports 80/443 while retaining
loopback `4610` and using a named Caddy certificate volume. Do not add a second
Caddy service or publish PostgreSQL. Existing FRP-based installations are not
automatically switched; read [`PUBLIC_HTTPS_OPERATIONS.md`](PUBLIC_HTTPS_OPERATIONS.md)
before changing an existing Compose project, persistent data or domain routing.
The source-build `asa-lab.sh up` command in this section is a different operation
from the pinned-image portable manager and must not replace a release-managed install.

The lifecycle is:

1. PostgreSQL becomes healthy.
2. The one-shot migration service applies migrations and provisions the
   least-privileged runtime role.
3. API starts only after migration succeeds.
4. Web starts only after API is healthy.

All application containers are non-root, drop all Linux capabilities, enable
`no-new-privileges`, and use read-only root filesystems. PostgreSQL is non-root,
drops all capabilities, and writes only to its named data volume.

## Upgrade and rollback preparation

Before changing images or source:

```bash
ASA_COMPOSE_PROFILE=production bash tools/docker-update.sh --check
ASA_COMPOSE_PROFILE=production bash tools/docker-update.sh
```

The first command is read-only. The second is run only after an explicit update
decision; it verifies a clean checkout, fast-forward eligibility and exact-SHA
GitHub CI, creates and validates a database backup, updates the stack, and waits
for `/health/ready`. See [`GUARDED_UPDATE.md`](GUARDED_UPDATE.md). Do not replace
this sequence with a bare `git pull` plus `compose up`.

Review the migration job and health output:

```bash
docker compose -f compose.yaml -f compose.production.yaml logs --tail=200 migration api web
docker compose -f compose.yaml -f compose.production.yaml run --rm migration
```

A repeated migration must report zero newly applied migrations.

Stop without deleting persistent data:

```bash
bash tools/docker-down.sh production
```
