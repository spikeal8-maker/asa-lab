# Local integration environment (TASK-ENV-001)

Approved local equivalent of `infra/docker-compose.yml` for a Windows host that
**cannot run containers**. It stands up real PostgreSQL, Redis and MinIO as
native user-level processes.

## Why not Docker Compose runtime

On this machine hardware virtualization is **disabled in firmware**
(`VirtualizationFirmwareEnabled = False`) and there are no administrator rights.
Docker Desktop, WSL2, Hyper-V and every Linux-container runtime therefore cannot
start, and enabling them would require a manual BIOS change plus an
administrator — neither of which may be done here. This is a real, unremovable
system blocker for *running* containers.

`docker compose config` (the `TST-COMPOSE-001` gate) is a **client-side** render
that needs no daemon, so it runs with a standalone Docker Compose CLI. The
services themselves run as native processes, preserving the actual meaning of
the tests (real PostgreSQL, real migrations, real object storage).

## Installed runtime and versions

| Component | Version | Role |
|---|---|---|
| Docker CLI (static) | 27.3.1 | `docker compose config` only (no daemon) |
| Docker Compose plugin | v2.29.7 | compose config rendering |
| PostgreSQL (portable) | 16.4 | real database + migrations |
| Redis (native Windows) | 5.0.14.1 | cache |
| MinIO (native) | RELEASE.2025-09-07T16-13-09Z | S3-compatible object storage |
| MinIO client `mc` | latest | bucket management |

Everything is installed **user-level** under `%LOCALAPPDATA%\asa-lab-devenv`
(binaries and data volumes). Nothing is written to the repository, the registry
or system services. Ports are bound to `127.0.0.1` only.

## Usage (PowerShell 7)

```powershell
# One-time, fully automated download + install (no admin):
infra/local/setup.ps1

# Start the environment (idempotent; ensures db + bucket):
infra/local/start.ps1

# Run the environment gate:
$env:PATH = "$env:LOCALAPPDATA\asa-lab-devenv\bin;$env:PATH"
$env:COMPOSE_FILE = 'infra/docker-compose.yml'
$env:DATABASE_URL = 'postgres://asalab:local-dev-password@127.0.0.1:5433/asalab'
python tools/run_task_tests.py --task TASK-ENV-001

# Stop (data preserved) / full reset (wipe data):
infra/local/stop.ps1
infra/local/reset.ps1
```

`Use-AsaEnv` (in `env.ps1`) exports `PATH`, `COMPOSE_FILE`, `DATABASE_URL` and
the MinIO credentials for the current shell.

## Notes

- Port `5432` is already used by another local PostgreSQL on this host, so the
  integration cluster uses `5433`; `DATABASE_URL` reflects that.
- Credentials are documented local development placeholders (identical to
  `.env.example`), never production secrets. Data volumes are never committed.
- PostgreSQL detaches into an OS-managed process (`pg_ctl`) and survives shell
  exit; Redis and MinIO are long-running processes started by `start.ps1`.
