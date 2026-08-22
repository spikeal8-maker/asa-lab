# Admin, durable authentication and MAX production evidence

State source: [`current.yaml`](current.yaml)

Programme source: [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)

Execution plan: [`ADMIN_AUTH_MAX_EXECUTION_PLAN.md`](ADMIN_AUTH_MAX_EXECUTION_PLAN.md)

This receipt separates code publication, database migration, process cutover and
external verification. It contains no database URL, session token, MAX token or
raw MAX launch data.

## Verified application revision

```text
revision: 9e0051176d2510551f279a00571fa1a6bcc6248f
schemaVersion: 85
expectedSchemaVersion: 85
synchronized: true
MAX_AUTH_ENABLED: false
```

This is the application-code revision on which the complete repository gate and
production cutover were verified. A later documentation-only evidence commit may
appear in `/api/version`; it does not change the application implementation.

The exposed MAX token from the owner conversation was not used. MAX stays behind
the explicit disabled flag until the owner revokes it and supplies a newly
generated secret outside chat and Git.

## Backup and restore receipt

```text
file: C:\Users\spike\AppData\Local\asa-lab-backups\asa-lab-pre-cutover-20260822-142836.dump
bytes: 1118661
sha256: C4CD2D57EA8550729063AD9A1A06D7B5249872554757F08D42AD6D1833A28D65
archive entries: 1116
restored pre-cutover counts: migrations=75 accounts=80 capability_grants=137
```

The archive was fully restored into an isolated `_test` database before the
production migration. The disposable database was dropped after verification.

## Verification receipt

- `NX_SKIP_NX_CACHE=true pnpm gate:repository`: PASS on the application
  revision above;
- full Vitest: 144 files, 939 tests passed;
- focused RLS: 15 tests passed;
- MAX admin PostgreSQL journey: 15 tests passed, including audited revocation,
  MAX-session termination and password-session preservation;
- local `/api/version`: application revision and schema 85 synchronized at
  cutover;
- independent external fetch of `https://asa-lab.ru/api/version`: the same
  revision and schema at cutover;
- independent external fetch of `/health/ready`: `ready`, database `up`;
- forced API child-process failure: supervisor recovered port 4611 on the same
  revision in about ten seconds.

Docker rendering was `SKIPPED` because Docker CLI is not installed on this
Windows host; the gate reported this explicitly and did not call it PASS.

## Local recovery wiring

```text
scheduled task: Assolab Production Supervisor
launcher: C:\frp\start-assolab-production.ps1
production checkout: C:\Users\spike\AppData\Local\asa-lab-admin-auth-main
FRP config: C:\frp\frpc.toml
FRP target: 127.0.0.1:4611
```

The older `AssolabProduction` Run value was removed after exporting
`C:\frp\AssolabProduction-run-key-backup.reg`. The independent `AssolabFRP`
Run value and the FRP process/config were not changed.
