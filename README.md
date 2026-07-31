# ASA Lab

Модульная образовательная платформа для аккаунтов, рабочих пространств, проектов, виртуальных лабораторий и будущего учебного цикла.

## Текущее состояние

```text
canonical branch:        main
active task:             TASK-CREATOR-PORTAL-001
active issue:            #62
active branch:           agent/r2-creator-portal
status:                  ready
product merge SHA:       e01ac85095ddaabef19ed618964deac3aa5b2406
verified Account SHA:    35c06c42012672b9b4cb2626b85ba1f21b973bc0
```

Account C1 завершён и объединён через PR №70. R2 Creator Portal активирован. R3 Project Lifecycle и R4 Electronics parity остаются blocked.

## Что уже работает

- public entry, регистрация и login по email/username;
- Account, Profile, Principal, Personal Workspace и sessions_v2;
- educator self-attestation, capability и AuditEvent;
- workspace list и ActiveContext;
- Account profile и session management;
- Teacher Portal baseline;
- Project Hub;
- Electronics, Chess и Chess Online;
- PostgreSQL, RLS, additive migrations;
- Docker, persistence и backup/restore.

## Что строится сейчас

```text
Account login
→ Creator Home
→ recent projects
→ Projects / Learning / Collections / Challenges
→ capability-aware Classes
→ Help
→ Account and workspace switcher
```

Цель R2 — цельный полезный кабинет вместо разреженной технической Account-панели. Точный scope и acceptance находятся в Issue №62.

## Ветка разработки

```bash
git fetch --all --prune
git switch agent/r2-creator-portal
git pull --ff-only origin agent/r2-creator-portal
```

Новая параллельная product branch не создаётся. Старые PR и ветки не закрываются в рамках R2.

## Порты

```text
Web  http://127.0.0.1:4610
API  http://127.0.0.1:4611
E2E  http://127.0.0.1:4612
```

## Запуск

```bash
cp .env.docker.example .env
./tools/docker-up.sh dev
./tools/docker-healthcheck.sh dev
```

Backup хранится отдельно от Git.

## Источники истины

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/project-map/infrastructure-focus.yaml`](docs/project-map/infrastructure-focus.yaml)
3. [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml)
4. [`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml)
5. Issue №62
6. [`docs/testing/test-catalog.yaml`](docs/testing/test-catalog.yaml)
7. [`docs/testing/active-task-tests.yaml`](docs/testing/active-task-tests.yaml)
