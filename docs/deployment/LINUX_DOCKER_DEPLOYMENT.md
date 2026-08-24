# Linux Docker deployment

The same Compose model used through WSL2 is portable to a regular x86-64 Linux
Docker host. The staging profile serves the production Web build through Caddy;
it does not run the Vite development server.

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

## Deploy

```bash
export ASA_BUILD_REVISION="$(git rev-parse HEAD)"
docker compose -f compose.yaml -f compose.staging.yaml config --quiet
docker compose -f compose.yaml -f compose.staging.yaml build
docker compose -f compose.yaml -f compose.staging.yaml up -d
docker compose -f compose.yaml -f compose.staging.yaml ps
bash tools/docker-healthcheck.sh
```

Only Web is published, by default on `127.0.0.1:4610`. PostgreSQL and API stay
on private Compose networks. Put an operator-managed TLS reverse proxy in front
of 4610 when remote access is required; do not switch to host networking and do
not publish PostgreSQL.

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
ASA_COMPOSE_PROFILE=staging bash tools/docker-backup.sh backups/pre-upgrade.dump
docker compose -f compose.yaml -f compose.staging.yaml build --pull
docker compose -f compose.yaml -f compose.staging.yaml up -d
bash tools/docker-healthcheck.sh
```

Review the migration job and health output:

```bash
docker compose -f compose.yaml -f compose.staging.yaml logs --tail=200 migration api web
docker compose -f compose.yaml -f compose.staging.yaml run --rm migration
```

A repeated migration must report zero newly applied migrations.

Stop without deleting persistent data:

```bash
bash tools/docker-down.sh staging
```
