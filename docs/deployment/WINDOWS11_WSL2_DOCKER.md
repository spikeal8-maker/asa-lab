# Windows 11, WSL2 and Docker Desktop

All containers are Linux containers. The shortest Windows path runs directly
from PowerShell and is documented in [`QUICK_START.md`](QUICK_START.md). For
frequent development inside Ubuntu, keep the repository in the WSL filesystem,
for example `/home/<user>/work/asa-lab`; do not use `/mnt/c`, OneDrive or
another synchronized Windows directory.

## Prerequisites

- Windows 11 with WSL2 enabled.
- Ubuntu 24.04 installed in WSL.
- Docker Desktop using the Linux container engine, with WSL integration enabled
  for the Ubuntu distribution.
- Git available inside Ubuntu. Node.js 22 and Corepack are needed only for
  development and tests outside Docker.

From PowerShell, confirm the distribution and Docker engine:

```powershell
wsl --status
wsl --list --verbose
wsl -d Ubuntu-24.04 -- docker version
wsl -d Ubuntu-24.04 -- docker compose version
```

Run all repository commands from an Ubuntu shell:

```bash
mkdir -p ~/work
cd ~/work
git clone https://github.com/spikeal8-maker/asa-lab.git
cd asa-lab
./tools/asa-lab.sh doctor
```

## Private local configuration

The `doctor` command above creates an ignored `.env` with consistent generated
credentials. To manage credentials manually instead, remove the generated file,
copy the template and replace every placeholder secret:

```bash
cp .env.docker.example .env
chmod 600 .env
```

Set `ASA_TEST_UID` and `ASA_TEST_GID` in `.env` to the values printed by
`id -u` and `id -g`. This keeps the non-root test container able to write
screenshots and reports into the WSL checkout.

Keep both database URLs consistent with the passwords in the same file.
Passwords must be URL-safe because they are also embedded in PostgreSQL URLs.
Never commit `.env`.

## Start the development profile

```bash
./tools/asa-lab.sh up
./tools/asa-lab.sh status
```

Open <http://localhost:4610> in a Windows browser. Web forwards `/api` and
`/health` to the API over the private application network. The dev-only direct
API endpoint is bound to `127.0.0.1:4611`; normal browser traffic should use the
same-origin Web endpoint.

Inspect logs without exposing secrets:

```bash
docker compose -f compose.yaml -f compose.dev.yaml logs --tail=200 postgres migration api web
```

Stop the profile while preserving PostgreSQL data:

```bash
bash tools/docker-down.sh dev
```

Do not add `--volumes` unless the project volume is intentionally being
discarded and a verified backup exists.

## Isolated test profile

The test profile uses the `asalab_test` database and port 4612. PostgreSQL is
not published to Windows.

```bash
docker compose -f compose.yaml -f compose.test.yaml --profile test build test-runner
docker compose -f compose.yaml -f compose.test.yaml up -d postgres migration api web
docker compose -f compose.yaml -f compose.test.yaml --profile test run --rm test-runner pnpm test
docker compose -f compose.yaml -f compose.test.yaml --profile test run --rm test-runner pnpm test:rls
docker compose -f compose.yaml -f compose.test.yaml --profile test run --rm test-runner pnpm e2e:chess
docker compose -f compose.yaml -f compose.test.yaml --profile test run --rm test-runner pnpm e2e:chess-live
bash tools/docker-down.sh test
```

The Playwright container reaches Web and PostgreSQL only through Compose
networks. Browser output is written to `reports/playwright`, and required
screenshots are written to `e2e/artifacts`.

## Windows/WSL checks

- If `localhost:4610` is unavailable, verify that Web is healthy and that no
  other process owns port 4610.
- Do not start Vite on port 5173 for this task.
- If Docker commands fail after a Docker Desktop restart, run `docker version`
  inside Ubuntu before recreating containers.
- Keep LF line endings and executable bits for `docker/*.sh` and
  `tools/docker-*.sh`.
