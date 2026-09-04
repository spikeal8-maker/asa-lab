# Docker backup and restore

The backup helper creates a PostgreSQL custom-format dump with owner and ACL
metadata removed. Files are created with mode 0600 under `backups/` by default.

## Create and verify a backup

For the base stack:

```bash
bash tools/docker-backup.sh backups/asa-lab.dump
test -s backups/asa-lab.dump
```

Select another running profile explicitly:

```bash
ASA_COMPOSE_PROFILE=dev bash tools/docker-backup.sh backups/asa-lab-dev.dump
ASA_COMPOSE_PROFILE=staging bash tools/docker-backup.sh backups/asa-lab-staging.dump
ASA_COMPOSE_PROFILE=production bash tools/docker-backup.sh backups/asa-lab-production.dump
```

On Windows, use the native PowerShell helper; it copies the binary dump out of
the container without passing it through text redirection:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-backup.ps1 -Profile production -Output backups/asa-lab-production.dump
```

Store verified backups outside the checkout according to the operator's
retention and encryption policy. Never stage or commit files from `backups/`.

## Restore verification

The restore helper refuses every target whose name does not end in `_test`.
This guard prevents accidental replacement of the active database.

```bash
bash tools/docker-restore.sh backups/asa-lab.dump asalab_restore_test
docker compose exec -T postgres \
  psql -U asalab_admin -d asalab_restore_test \
  -c 'SELECT count(*) FROM schema_migrations'
```

For a profile other than base:

```bash
ASA_COMPOSE_PROFILE=staging \
  bash tools/docker-restore.sh backups/asa-lab-staging.dump asalab_restore_test
```

After verification, remove only the disposable restore database:

```bash
docker compose exec -T postgres \
  dropdb --if-exists --force -U asalab_admin asalab_restore_test
```

For dev or staging, include the same profile files or set
`ASA_COMPOSE_PROFILE` when running the cleanup command.

## Recovery rules

- Take a new backup before upgrades or destructive maintenance.
- Test the dump in a separate `*_test` database before relying on it.
- Never restore over the live database with the verification helper.
- Never commit dumps or `.env` files.
- Do not remove the PostgreSQL volume until a tested external backup exists.
